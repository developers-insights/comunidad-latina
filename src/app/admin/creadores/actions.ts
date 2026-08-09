"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getStaffContext, logAdminAction } from "../guard";
import { THRESHOLD_FIELDS, type EligibilityConfigRow } from "@/lib/creators/eligibility";
import type { Json } from "@/lib/types/database.types";

/**
 * =============================================================================
 * GUARDAR LOS UMBRALES DE ELEGIBILIDAD DE CREADOR
 * =============================================================================
 *
 * El pliego lo pide con todas las letras: "los números deben ser configurables
 * desde el panel, no colocados permanentemente en el código". Esta action es
 * ese panel del lado del servidor.
 *
 * TRES CANDADOS, NINGUNO EN LA UI
 *
 *  1. ROL. `getStaffContext("domain_admin")` revalida el token contra Supabase
 *     (`getUser()`, no la cookie) y lee el rol del JWT — la misma fuente que
 *     usan las policies. Un `member` que arme el POST a mano no llega ni a
 *     construir la consulta. Esconder el botón no es un permiso.
 *
 *  2. TENANT. El `tenant_id` sale SIEMPRE del JWT del admin y JAMÁS del
 *     formulario. Aunque alguien inyecte un `tenantId` en el FormData, no se
 *     mira: no existe forma de que un domain_admin escriba la configuración de
 *     otra comunidad desde acá.
 *
 *  3. RLS. Se escribe con el cliente del propio admin, así que la base vuelve a
 *     verificar rol y tenant por su cuenta (policies de 0064). Si los dos
 *     primeros candados fallaran, este todavía sostiene.
 *
 * VALIDACIÓN: Zod al borde (ARQUITECTURA §9), con los MISMOS rangos que los
 * CHECK de la migración. Que la base los tenga no vuelve opcional validarlos
 * acá: un 23514 crudo de Postgres es un error técnico en la cara del operador,
 * y lo que corresponde es un mensaje que diga qué número está mal.
 * =============================================================================
 */

const COPY = {
  notAllowed: "Tu sesión no tiene permisos para cambiar los requisitos de creador.",
  noTenant: "No pudimos identificar tu comunidad. Cerrá sesión y volvé a entrar.",
  invalid:
    "Revisá los números: hay alguno fuera de rango. La edad va de 13 a 99 y el User Score de 0 a 100.",
  genericError: "No pudimos guardar los cambios — no es tu culpa. Probá otra vez en un momento.",
  saved: "Listo. Los requisitos nuevos ya rigen para toda solicitud de creador.",
} as const;

export type CreatorConfigActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

/**
 * Un booleano del formulario llega como "si" | "no" y NUNCA como ausencia.
 *
 * Es a propósito y no es cosmético: con un checkbox HTML, "no tildado" viaja
 * como campo ausente, y un campo ausente es indistinguible de un campo que se
 * perdió. Ahí un guardado a medias APAGA requisitos que nadie quiso apagar —
 * exactamente el tipo de accidente que este panel no puede permitirse, porque
 * del otro lado hay gente que cobra. Con dos opciones explícitas, la ausencia
 * es un error y se rechaza el guardado entero.
 */
const toggleSchema = z.enum(["si", "no"]).transform((value) => value === "si");

const configSchema = z.object({
  min_age: z.coerce.number().int().min(13).max(99),
  require_profile_complete: toggleSchema,
  require_phone_verified: toggleSchema,
  require_email_verified: toggleSchema,
  min_user_score: z.coerce.number().int().min(0).max(100),
  require_identity_verified: toggleSchema,
  require_stripe_connect: toggleSchema,
  min_followers: z.coerce.number().int().min(0).max(1_000_000),
  min_videos: z.coerce.number().int().min(0).max(10_000),
  min_views: z.coerce.number().int().min(0).max(100_000_000),
  min_portfolio_items: z.coerce.number().int().min(0).max(100),
  require_no_active_suspension: toggleSchema,
  require_creator_terms: toggleSchema,
});

export async function updateCreatorEligibilityConfig(
  _prev: CreatorConfigActionState,
  formData: FormData,
): Promise<CreatorConfigActionState> {
  // Candado 1: rol verificado contra el servidor de auth, antes que nada.
  const ctx = await getStaffContext("domain_admin");
  if (!ctx) return { status: "error", message: COPY.notAllowed };
  const { supabase, user, tenantId } = ctx;

  // Candado 2: la comunidad es la del JWT. El formulario no opina.
  if (!tenantId) return { status: "error", message: COPY.noTenant };

  /**
   * Se recorren las columnas CANÓNICAS, no las claves del FormData: así un
   * cliente no puede colar una columna que no le corresponde (`tenant_id`,
   * `updated_by`) ni omitir una para dejarla en un estado indefinido.
   */
  const raw: Record<string, FormDataEntryValue | null> = {};
  for (const field of THRESHOLD_FIELDS) {
    raw[field.column] = formData.get(field.column);
  }

  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: COPY.invalid };
  const row: EligibilityConfigRow = parsed.data;

  // Candado 3: cliente del admin → la RLS de 0064 vuelve a verificar rol+tenant.
  const { error } = await supabase.from("creator_eligibility_config").upsert(
    {
      tenant_id: tenantId,
      ...row,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );

  if (error) {
    console.error("[admin/creadores] no se pudieron guardar los umbrales:", error.message);
    return { status: "error", message: COPY.genericError };
  }

  // Cambiar quién puede cobrar en la plataforma es una decisión que tiene que
  // tener nombre y fecha (0064 ya guarda `updated_by`; esto lo deja además en
  // la bitácora, con los valores exactos).
  await logAdminAction({
    actorId: user.id,
    action: "creator_eligibility.updated",
    tenantId,
    subjectKind: "tenant",
    subjectId: tenantId,
    // El row son números y booleanos: encaja en Json, solo le falta la index
    // signature que pide `meta`.
    meta: { ...row } as Record<string, Json>,
  });

  revalidatePath("/admin/creadores");
  // La pantalla del aspirante lee los mismos umbrales: si no se invalida, sigue
  // mostrando los requisitos viejos como si estuvieran vigentes.
  revalidatePath("/creadores/solicitud");
  return { status: "success", message: COPY.saved };
}
