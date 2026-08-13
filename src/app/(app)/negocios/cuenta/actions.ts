"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { BUSINESS_CATEGORIES } from "../categories";
import { COPY, MAX_NOMBRE_NEGOCIO } from "./copy";
import type { AltaState } from "./estado";

/**
 * =============================================================================
 * ALTA DE LA CUENTA DE NEGOCIO
 * =============================================================================
 *
 * ── QUÉ SE ESCRIBE ──────────────────────────────────────────────────────────
 * Una fila de `business_accounts`, que desde 0008 es «el ancla estable de
 * identidad+billing» del negocio. No se crea una tabla nueva ni un usuario
 * nuevo: es un segundo perfil DENTRO de la misma cuenta (ver el encabezado de
 * la 0103).
 *
 * ── QUÉ NO SE ESCRIBE ───────────────────────────────────────────────────────
 * Ni `plan`, ni `plan_status`, ni `verified_presence`, ni los ids de Stripe. La
 * policy de INSERT (0008) exige que vengan en su valor inicial, así que un alta
 * NO puede nacer con presencia verificada aunque este archivo se equivoque. La
 * verificación se compra en /negocios/presencia y la escribe el webhook.
 *
 * ── EL DUEÑO NO SE PASA, SE DEDUCE ──────────────────────────────────────────
 * `owner_id` sale del guard (JWT), nunca de un campo del formulario — y la
 * policy lo vuelve a exigir contra `auth.uid()`. `tenant_id`, igual.
 *
 * ── CREAR NO TE CAMBIA DE PERFIL ────────────────────────────────────────────
 * A propósito. Cambiar la identidad con la que alguien publica es una decisión
 * suya, y hacerlo de callado como efecto secundario de un alta es justo la clase
 * de sorpresa que hace que la persona publique algo con el nombre equivocado. Se
 * crea, se avisa, y el cambio es un botón aparte.
 */

const RUBROS = BUSINESS_CATEGORIES.map((categoria) => categoria.value);

const altaSchema = z.object({
  nombre: z
    .string()
    .transform((valor) => valor.trim().replace(/\s+/g, " "))
    .pipe(
      z
        .string()
        .min(2, COPY.errors.nombreCorto)
        .max(MAX_NOMBRE_NEGOCIO, COPY.errors.nombreLargo),
    ),
  rubro: z
    .string()
    .transform((valor) => (valor.length > 0 ? valor : null))
    .refine((valor) => valor === null || RUBROS.includes(valor as never), {
      message: COPY.errors.generico,
    }),
});

export async function crearCuentaDeNegocio(
  _previo: AltaState,
  formData: FormData,
): Promise<AltaState> {
  const parsed = altaSchema.safeParse({
    nombre: String(formData.get("nombre") ?? ""),
    rubro: String(formData.get("rubro") ?? ""),
  });

  if (!parsed.success) {
    return {
      estado: "error",
      mensaje: parsed.error.issues[0]?.message ?? COPY.errors.generico,
    };
  }

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return {
      estado: "error",
      mensaje:
        guard.reason === "unauthenticated" ? COPY.errors.signedOut : guard.message,
    };
  }
  const { supabase, user, tenant } = guard;
  const { nombre, rubro } = parsed.data;

  const { error } = await supabase.from("business_accounts").insert({
    tenant_id: tenant.id,
    owner_id: user.id,
    name: nombre,
    category: rubro,
  });

  if (error) {
    // 23505 = el índice único de la 0103 (una cuenta de negocio por persona y
    // por comunidad). No es un error del sistema: es que ya la tiene.
    if (error.code === "23505") {
      return { estado: "error", mensaje: COPY.errors.yaExiste };
    }
    // Log sin PII: solo el código y la comunidad.
    console.error("[cuenta-de-negocio] no se pudo crear", {
      code: error.code,
      tenant: tenant.slug,
    });
    return { estado: "error", mensaje: COPY.errors.generico };
  }

  // Toda la app: el trigger de la 0031 acaba de darle la capacidad "business" a
  // la cuenta y el cambiador del header tiene que verla en la próxima pantalla.
  revalidatePath("/", "layout");
  return { estado: "ok", mensaje: COPY.ok.created(nombre) };
}
