"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { formatDate } from "@/lib/utils";

/**
 * Verificador de profesionales (Escudo §3.3) — DETERMINÍSTICO:
 * busca en verification_checks (checks reales contra registros oficiales,
 * escritos solo por el pipeline server-side) y muestra el resultado LITERAL.
 * NUNCA inventa un resultado: si no tenemos el registro conectado, lo decimos.
 */

export type ProfessionalKind = "notario" | "abogado";

export type VerificarState =
  | { status: "idle" }
  | { status: "invalid"; message: string }
  | { status: "error"; message: string }
  | {
      /** Hay un check real en la tabla — se muestra tal cual (§11). */
      status: "found_active" | "not_found" | "expired" | "mismatch";
      license: string;
      registry: string;
      registryUrl: string | null;
      /** Fecha del check ya formateada en largo ("6 de julio de 2026"). */
      date: string;
    }
  | {
      /** No tenemos ese registro para consulta en vivo — estado honesto. */
      status: "unknown";
      license: string;
      kind: ProfessionalKind;
    };

const verificarSchema = z.object({
  kind: z.enum(["notario", "abogado"]),
  license: z
    .string()
    .transform((value) => value.trim().toUpperCase().replace(/[\s.-]/g, ""))
    .pipe(
      z
        .string()
        .min(4, "too_short")
        .max(24, "too_long")
        .regex(/^[A-Z0-9]+$/, "bad_chars"),
    ),
});

const COPY = {
  invalidLicense:
    "Revisá el número: usá solo letras y números, tal como figura en el documento (entre 4 y 24 caracteres).",
  invalidForm: "Elegí el tipo de profesional y escribí el número de matrícula.",
  queryError:
    "No pudimos consultar el registro en este momento — no es tu culpa. Probá de nuevo en unos minutos.",
} as const;

export async function verificarLicenciaAction(
  _prevState: VerificarState,
  formData: FormData,
): Promise<VerificarState> {
  const parsed = verificarSchema.safeParse({
    kind: formData.get("kind"),
    license: formData.get("license"),
  });

  if (!parsed.success) {
    const licenseIssue = parsed.error.issues.some(
      (issue) => issue.path[0] === "license",
    );
    return {
      status: "invalid",
      message: licenseIssue ? COPY.invalidLicense : COPY.invalidForm,
    };
  }

  const { kind, license } = parsed.data;

  const tenant = await getTenant();
  const supabase = await createClient();

  const { data: check, error } = await supabase
    .from("verification_checks")
    .select("result, registry, registry_url, checked_at, license_number")
    .eq("tenant_id", tenant.id)
    .eq("license_number", license)
    .order("checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[escudo] verificador: falló la consulta:", error.message);
    return { status: "error", message: COPY.queryError };
  }

  if (check) {
    const result = check.result;
    if (
      result === "found_active" ||
      result === "not_found" ||
      result === "expired" ||
      result === "mismatch"
    ) {
      return {
        status: result,
        license,
        registry: check.registry,
        registryUrl: check.registry_url,
        date: formatDate(check.checked_at, { style: "long" }),
      };
    }
    // Resultado fuera del contrato conocido: jamás adivinar.
    console.error("[escudo] verificador: result inesperado en check:", result);
    return { status: "error", message: COPY.queryError };
  }

  // Sin check en la tabla → registro no conectado todavía. Dejamos la señal
  // para priorizar la conexión. La policy de moderation_queue solo permite
  // insertar al pipeline server-side (with check false para JWT de usuario):
  // si rechaza, degradamos a log (§5.6) — nunca rompemos ni inventamos.
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { error: queueError } = await supabase
        .from("moderation_queue")
        .insert({
          tenant_id: tenant.id,
          subject_kind: "profile",
          subject_id: user.id,
          tier: 1,
          reasons: [
            { type: "verifier_registry_miss", kind, license_query: license },
          ],
        });
      if (queueError) {
        // Sin PII del usuario: el número de matrícula es un dato público
        // de registro profesional, no un dato personal del que consulta.
        console.info(
          `[escudo] verificador: registro no conectado (kind=${kind}, license=${license}) — señal degradada a log`,
        );
      }
    } else {
      console.info(
        `[escudo] verificador: registro no conectado (kind=${kind}, license=${license}) — consulta anónima`,
      );
    }
  } catch {
    // La señal es best-effort: nunca bloquea la respuesta honesta al usuario.
  }

  return { status: "unknown", license, kind };
}
