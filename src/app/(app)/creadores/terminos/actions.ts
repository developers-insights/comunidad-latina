"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CREATOR_TERMS } from "@/lib/creators/terms";
import { requireTenantMatch } from "@/lib/tenant/guard";

/**
 * =============================================================================
 * ACEPTAR LOS TÉRMINOS DE CREADOR
 * =============================================================================
 *
 * Escribe las dos columnas que 0064 agregó a `creator_profiles`:
 * `creator_terms_accepted_at` y `creator_terms_version`. Las dos JUNTAS y
 * siempre: una fecha sin versión no dice qué se aceptó, y es exactamente el
 * agujero que el versionado vino a tapar.
 *
 * POR QUÉ VIAJA LA VERSIÓN EN EL FORMULARIO Y SE VALIDA CONTRA LA VIGENTE:
 * alguien puede tener esta pantalla abierta cuando los términos cambian. Sin la
 * comparación, el submit guardaría "aceptó la versión de hoy" para un texto que
 * ya no es el de hoy — o sea, una firma sobre un documento que la persona nunca
 * leyó. Si no coinciden, no se guarda nada: se recarga la pantalla con el texto
 * nuevo y se pide la aceptación otra vez.
 *
 * SIN PRIVILEGIOS: es la propia fila de quien acepta, y la policy
 * `creator_profiles_update` (0024) ya autoriza `profile_id = auth.uid()`. La
 * guarda `protect_creator_reputation` solo bloquea `status` y la reputación, que
 * acá no se tocan. Cliente del usuario, RLS aplica.
 * =============================================================================
 */

const COPY = {
  needLogin: "Para aceptar los términos necesitás entrar a tu cuenta.",
  needProfile:
    "Primero armá tu perfil de creador. Los términos se aceptan sobre ese perfil, así queda claro quién firmó.",
  stale:
    "Los términos cambiaron mientras tenías esta pantalla abierta. Ya cargamos la versión nueva: leela y aceptala.",
  generic: "No pudimos guardar tu aceptación — no es tu culpa. Probá otra vez en un momento.",
  accepted: "Listo, quedó registrado. Gracias por leerlos.",
} as const;

export type CreatorTermsActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

const acceptSchema = z.object({
  version: z.string().trim().min(1).max(40),
});

export async function acceptCreatorTerms(
  _prev: CreatorTermsActionState,
  formData: FormData,
): Promise<CreatorTermsActionState> {
  const parsed = acceptSchema.safeParse({ version: formData.get("version") });
  if (!parsed.success) return { status: "error", message: COPY.generic };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { status: "error", message: COPY.needLogin };
    return { status: "error", message: guard.message };
  }
  const { supabase, user } = guard;

  if (parsed.data.version !== CREATOR_TERMS.version) {
    revalidatePath("/creadores/terminos");
    return { status: "error", message: COPY.stale };
  }

  const { data: updated, error } = await supabase
    .from("creator_profiles")
    .update({
      creator_terms_accepted_at: new Date().toISOString(),
      // Se guarda la versión VIGENTE del servidor, no la que mandó el cliente:
      // aunque sean iguales por la comparación de arriba, la fuente de verdad
      // de lo que se firmó nunca puede ser el formulario.
      creator_terms_version: CREATOR_TERMS.version,
    })
    .eq("profile_id", user.id)
    .select("profile_id")
    .maybeSingle();

  if (error) {
    console.error("[creadores] no se pudo guardar la aceptación de términos:", error.message);
    return { status: "error", message: COPY.generic };
  }
  if (!updated) return { status: "error", message: COPY.needProfile };

  revalidatePath("/creadores/terminos");
  revalidatePath("/creadores/solicitud");
  return { status: "success", message: COPY.accepted };
}
