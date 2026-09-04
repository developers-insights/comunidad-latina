import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { summarizeActors } from "@/lib/notifications/group";

/**
 * =============================================================================
 * "TE RESPONDIERON EL PEDIDO"
 * =============================================================================
 *
 * Es la contracara de que el tablón sea vivo: si alguien escribe «¿dónde
 * consigo una silla de ruedas?» y no se entera de que le contestaron, la
 * respuesta no existe. El aviso es lo que cierra el circuito que el cliente
 * describió — «la gente pone lo que necesita y la gente le contesta».
 *
 * ── NO REIMPLEMENTA NINGUNA REGLA ───────────────────────────────────────────
 * `public.emit_social_notification` (envoltorio de la 0070 sobre la función de
 * la 0068) resuelve de una sola vez lo que es fácil olvidar:
 *   1. no auto-notificar;
 *   2. respetar bloqueos en las dos direcciones (`app.pair_blocked`);
 *   3. respetar `notification_prefs` entendiendo que la AUSENCIA de fila
 *      significa "todo prendido";
 *   4. agrupar por `group_key` con el protocolo de 0045 — buscar la fila VIVA y
 *      actualizarla.
 *
 * Este archivo es un calco de `feed/social-notifications.ts` con el sujeto
 * cambiado, y eso es a propósito: un segundo camino de notificación con reglas
 * propias sería un segundo lugar donde olvidarse de los bloqueos.
 *
 * ── POR QUÉ `kind = 'comment'` Y NO UNO NUEVO ───────────────────────────────
 * `subject_kind` es texto libre, así que `'help_notice'` alcanza para que el
 * `group_key` (`comment:help_notice:<id>`) no choque con el de los comentarios
 * del feed (`comment:post:<id>`). Estrenar un `kind` obligaría a sumarlo a
 * `KIND_CATEGORY` (`src/lib/notifications/categories.ts`) para que no caiga en
 * la categoría por default, y el resultado sería idéntico: la categoría la
 * escribe la función en SQL y siempre es `social`. Una fila de registro para no
 * cambiar nada no vale una migración ni un archivo compartido tocado.
 *
 * BEST-EFFORT ABSOLUTO: nada de esto puede desarmar una respuesta que ya está
 * guardada. Todo va adentro de un try y esta función nunca lanza.
 * =============================================================================
 */

/** El extracto se recorta corto: la notificación invita a abrir, no reemplaza. */
const EXCERPT_MAX = 120;

export async function notifyHelpReply(input: {
  tenantId: string;
  noticeId: string;
  noticeAuthorId: string;
  actorId: string;
  body: string;
  /** Respuestas visibles del pedido DESPUÉS de esta. Arma el "y 3 más". */
  replyCount: number;
}): Promise<void> {
  // Corte barato antes de la red. La base lo vuelve a garantizar.
  if (input.noticeAuthorId === input.actorId) return;

  try {
    const admin = createAdminClient();

    const { data: actor } = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", input.actorId)
      .maybeSingle();

    const name = actor?.display_name?.trim();
    // Un aviso que dice "Alguien" es peor que no avisar.
    if (!name) return;

    const total = input.replyCount > 0 ? input.replyCount : 1;
    const actors = summarizeActors([name], { total });
    const verb = total > 1 ? "respondieron" : "respondió";
    const excerpt = input.body.trim().slice(0, EXCERPT_MAX);

    // `emit_social_notification` llegó con la 0070 y `database.types.ts` se
    // regenera aparte: el cast es por el TIPO generado, no por el contrato.
    const open = admin as unknown as import("@supabase/supabase-js").SupabaseClient;
    const { error } = await open.rpc("emit_social_notification", {
      p_tenant: input.tenantId,
      p_recipient: input.noticeAuthorId,
      p_actor: input.actorId,
      p_kind: "comment",
      p_subject_kind: "help_notice",
      p_subject_id: input.noticeId,
      p_title: `${actors} ${verb} tu pedido`,
      p_body: excerpt.length > 0 ? excerpt : null,
      p_href: `/comunidad/pedir-ayuda/${input.noticeId}`,
    });

    // Un NULL de vuelta NO es un error: es la función diciendo "decidí no
    // emitir" (bloqueo, preferencia apagada, auto-aviso). Sólo se loguea el
    // error de verdad, y sin contenido.
    if (error) {
      console.warn("[comunidad] emit_social_notification falló", { code: error.code });
    }
  } catch (error) {
    console.warn("[comunidad] aviso de respuesta no emitido", {
      message: error instanceof Error ? error.message : "error desconocido",
    });
  }
}
