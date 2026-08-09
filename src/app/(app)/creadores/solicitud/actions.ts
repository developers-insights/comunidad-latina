"use server";

import { revalidatePath } from "next/cache";
import { DAY_MS, limit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTenantMatch } from "@/lib/tenant/guard";

/**
 * =============================================================================
 * ENVIAR LA SOLICITUD PARA SER CREADOR
 * =============================================================================
 *
 * Esta action NO decide nada. Quien decide es la base: `request_creator_activation`
 * (0032) llama a `app.creator_activation_eligible()`, que evalúa los umbrales
 * configurados en `creator_eligibility_config` (0064) y aborta si falta algo.
 *
 * El checklist que ve la persona es un ESPEJO de esa evaluación, no un permiso.
 * Si alguien mandara el POST a mano con la pantalla en verde por caché, la base
 * lo frena igual — y esta action traduce ese "NOT_ELIGIBLE" a una frase humana,
 * nunca a la lista de códigos crudos que devuelve el SQL.
 *
 * POR QUÉ EL ADMIN CLIENT: la RPC transiciona `creator_profiles.status`, y la
 * guarda `protect_creator_reputation` (0032) solo deja moverlo a `service_role`
 * o a staff — justamente para que nadie se auto-apruebe. Es la doctrina de
 * escritura privilegiada del repo (ARQUITECTURA §6, igual que el escrow o el
 * signup): se verifica la sesión PRIMERO y recién entonces se usa el cliente de
 * servicio, y el id del perfil sale de la sesión verificada, nunca del cliente.
 * =============================================================================
 */

const COPY = {
  needLogin: "Para mandar tu solicitud necesitás entrar a tu cuenta.",
  needProfile:
    "Primero armá tu perfil de creador: es lo que ve el negocio que te va a contratar. Se hace en un minuto.",
  alreadySent: "Tu solicitud ya está en revisión. Te avisamos apenas haya novedades.",
  alreadyCreator: "Ya sos creador en esta comunidad.",
  notEligible:
    "Todavía te falta algún requisito. Fijate en la lista de arriba, que se acaba de actualizar.",
  tooMany: "Ya mandaste varias solicitudes hoy. Probá de nuevo mañana.",
  generic: "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo en un ratito.",
  sent: "¡Listo! Tu solicitud quedó enviada y la está mirando el equipo de tu comunidad.",
} as const;

export type CreatorRequestState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

/** Estados en los que la solicitud ya está en curso o resuelta a favor. */
const IN_PROGRESS = new Set([
  "documents_pending",
  "stripe_review_pending",
  "platform_review_pending",
]);

export async function submitCreatorActivationRequest(
  _prev: CreatorRequestState,
  _formData: FormData,
): Promise<CreatorRequestState> {
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { status: "error", message: COPY.needLogin };
    return { status: "error", message: guard.message };
  }
  const { supabase, user } = guard;

  // El rate limit va DESPUÉS del guard y ANTES de cualquier efecto: un intento
  // rechazado por sesión no debería gastarle el cupo a nadie.
  if (!limit(`creator-activation:${user.id}`, 5, DAY_MS).ok) {
    return { status: "error", message: COPY.tooMany };
  }

  const { data: creator, error: readError } = await supabase
    .from("creator_profiles")
    .select("status")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (readError) return { status: "error", message: COPY.generic };
  if (!creator) return { status: "error", message: COPY.needProfile };
  if (creator.status === "approved") return { status: "error", message: COPY.alreadyCreator };
  if (IN_PROGRESS.has(creator.status)) return { status: "error", message: COPY.alreadySent };

  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc("request_creator_activation", { p_profile_id: user.id });

    if (error) {
      // El SQL levanta 'NOT_ELIGIBLE: faltan requisitos: seguidores, videos'.
      // Esos códigos NO se muestran: la lista de arriba ya los explica, en
      // castellano y con los números exactos.
      if (error.message.includes("NOT_ELIGIBLE")) {
        revalidatePath("/creadores/solicitud");
        return { status: "error", message: COPY.notEligible };
      }
      if (error.message.includes("NO_CREATOR_PROFILE")) {
        return { status: "error", message: COPY.needProfile };
      }
      console.error("[creadores] la solicitud de activación falló:", error.message);
      return { status: "error", message: COPY.generic };
    }
  } catch (thrown) {
    console.error(
      "[creadores] no se pudo procesar la solicitud de activación:",
      thrown instanceof Error ? thrown.message : "error desconocido",
    );
    return { status: "error", message: COPY.generic };
  }

  revalidatePath("/creadores/solicitud");
  revalidatePath("/creadores/perfil");
  return { status: "success", message: COPY.sent };
}
