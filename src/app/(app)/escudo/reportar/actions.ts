"use server";

import { z } from "zod";
import { limit, DAY_MS } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/**
 * Server action del flujo de reporte del Escudo (§3.3).
 * Todo pasa por la RPC report_scam con el cliente del usuario: la función
 * valida tenant, existencia del objetivo y membresía (si es un mensaje),
 * y el peso del reporte sale del Trust Score vía trigger — nada forjable.
 */

export type ReporteState =
  | { status: "idle" }
  | { status: "invalid" | "error"; message: string }
  | { status: "success" };

// Razones canónicas — espejo de REPORT_REASONS en
// src/components/escudo/report-reasons.ts (un archivo "use server" solo
// puede exportar funciones async, por eso la lista vive allá).
const REASON_VALUES = [
  "Pidió dinero por adelantado",
  "La dirección no existe",
  "Se hace pasar por otra persona",
  "El precio es irreal",
  "Otro",
] as const;

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const COPY = {
  invalidKind: "Elegí qué querés reportar: un aviso, un perfil o un mensaje.",
  invalidLink:
    "No encontramos un aviso o perfil en ese link. Abrí la publicación en la app, tocá compartir y pegá el link completo.",
  invalidConversation: "Elegí la conversación que querés reportar.",
  invalidReason: "Elegí qué pasó — nos ayuda a revisarlo más rápido.",
  detailsRequired:
    "Contanos brevemente qué pasó, así el equipo puede revisarlo bien.",
  unauthenticated:
    "Necesitás una cuenta para reportar. Entrá y volvé a intentarlo — te toma un minuto.",
  notFound:
    "No encontramos esa publicación en tu comunidad. Revisá que el link sea de esta app y esté completo.",
  genericError:
    "No pudimos enviar el reporte en este momento — no es tu culpa. Probá de nuevo en unos minutos.",
  tooManyReports:
    "Ya enviaste varios reportes hoy — gracias por cuidar la comunidad. Para que el equipo pueda revisarlos bien, esperá hasta mañana para enviar otro.",
} as const;

const baseSchema = z.object({
  targetKind: z.enum(["listing", "profile", "message"]),
  reason: z.enum(REASON_VALUES),
  details: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(1000))
    .optional(),
});

function extractUuid(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string") return null;
  const match = raw.match(UUID_RE);
  return match ? match[0].toLowerCase() : null;
}

export async function reportarEstafaAction(
  _prevState: ReporteState,
  formData: FormData,
): Promise<ReporteState> {
  const parsedBase = baseSchema.safeParse({
    targetKind: formData.get("targetKind"),
    reason: formData.get("reason"),
    details: formData.get("details") ?? undefined,
  });

  if (!parsedBase.success) {
    const paths = new Set(
      parsedBase.error.issues.map((issue) => String(issue.path[0])),
    );
    if (paths.has("targetKind")) {
      return { status: "invalid", message: COPY.invalidKind };
    }
    if (paths.has("reason")) {
      return { status: "invalid", message: COPY.invalidReason };
    }
    return { status: "invalid", message: COPY.genericError };
  }

  const { targetKind, reason, details } = parsedBase.data;

  if (reason === "Otro" && !details) {
    return { status: "invalid", message: COPY.detailsRequired };
  }

  // El objetivo llega como link pegado (aviso/perfil) o como la conversación
  // elegida (mensaje concreto de la contraparte, resuelto server-side al
  // armar las opciones). En ambos casos extraemos el UUID y la RPC valida
  // existencia + tenant + membresía — acá no confiamos en nada del cliente.
  let targetId: string | null = null;
  if (targetKind === "message") {
    targetId = extractUuid(formData.get("messageId"));
    if (!targetId) {
      return { status: "invalid", message: COPY.invalidConversation };
    }
  } else {
    targetId = extractUuid(formData.get("link"));
    if (!targetId) {
      return { status: "invalid", message: COPY.invalidLink };
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: COPY.unauthenticated };

  // Rate limit: 10 reportes/día por usuario (anti-spam de reportes; el peso
  // real del reporte igual lo decide el Trust Score en la DB).
  if (!limit(`reporte:${user.id}`, 10, DAY_MS).ok) {
    return { status: "error", message: COPY.tooManyReports };
  }

  const { error } = await supabase.rpc("report_scam", {
    p_target_kind: targetKind,
    p_target_id: targetId,
    p_reason: reason,
    ...(details ? { p_details: details } : {}),
  });

  if (error) {
    if (error.message.includes("TARGET_NOT_FOUND")) {
      return { status: "invalid", message: COPY.notFound };
    }
    if (error.message.includes("AUTH_REQUIRED")) {
      return { status: "error", message: COPY.unauthenticated };
    }
    console.error("[escudo] reporte: falló report_scam:", error.message);
    return { status: "error", message: COPY.genericError };
  }

  return { status: "success" };
}
