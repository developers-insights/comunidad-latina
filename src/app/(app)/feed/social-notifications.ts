import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { summarizeActors } from "@/lib/notifications/group";
import type { Database } from "@/lib/types/database.types";

/**
 * =============================================================================
 * AVISOS DE "ME GUSTA" Y DE COMENTARIOS
 * =============================================================================
 *
 * LAS CUATRO REGLAS VIVEN EN SQL Y ACÁ NO SE REPITEN.
 *
 * `public.emit_social_notification` (envoltorio de la 0070 sobre la función de
 * la 0068) resuelve de una sola vez lo que es fácil olvidar:
 *   1. no auto-notificar;
 *   2. respetar bloqueos en las dos direcciones (`app.pair_blocked`);
 *   3. respetar `notification_prefs` entendiendo que la AUSENCIA de fila
 *      significa "todo prendido";
 *   4. agrupar por `group_key` con el protocolo de 0045 — buscar la fila VIVA y
 *      actualizarla, porque el índice no es único a propósito y ON CONFLICT no
 *      sirve contra un índice parcial.
 *
 * Este archivo NO reimplementa ninguna de las cuatro. Lo único que hace del lado
 * de la app es lo que la base no puede hacer: armar el TEXTO del aviso ("A María
 * y 3 personas más les gustó tu publicación"), que necesita el nombre de quien
 * actuó y el contador real del post.
 *
 * El auto-chequeo de la regla 1 se repite acá igual, y no es duplicación: es un
 * corte ANTES de tocar la red. La base ya lo garantiza; esto evita tres viajes
 * (perfil, post, RPC) para terminar en un `return null`.
 *
 * BEST-EFFORT ABSOLUTO: nada de esto puede desarmar un me gusta o un comentario
 * que ya está guardado. Todo va adentro de un try y ninguna función lanza.
 */

interface EmitInput {
  tenantId: string;
  recipientId: string;
  actorId: string;
  kind: "reaction" | "comment";
  subjectKind: string;
  subjectId: string;
  title: string;
  body?: string | null;
  href?: string | null;
}

async function emitSocial(admin: SupabaseClient<Database>, input: EmitInput): Promise<void> {
  try {
    // `emit_social_notification` llegó con la 0070 y `database.types.ts` se
    // regenera aparte: el cast es por el TIPO generado, no por el contrato.
    const open = admin as unknown as SupabaseClient;
    const { error } = await open.rpc("emit_social_notification", {
      p_tenant: input.tenantId,
      p_recipient: input.recipientId,
      p_actor: input.actorId,
      p_kind: input.kind,
      p_subject_kind: input.subjectKind,
      p_subject_id: input.subjectId,
      p_title: input.title,
      p_body: input.body ?? null,
      p_href: input.href ?? null,
    });

    // Un NULL de vuelta NO es un error: es la función diciendo "decidí no
    // emitir" (bloqueo, preferencia apagada, auto-aviso). Sólo se loguea el
    // error de verdad, y sin contenido.
    if (error) {
      console.warn("[feed] emit_social_notification falló", {
        kind: input.kind,
        code: error.code,
      });
    }
  } catch (error) {
    console.warn("[feed] aviso social no emitido", {
      kind: input.kind,
      message: error instanceof Error ? error.message : "error desconocido",
    });
  }
}

/**
 * Nombre para mostrar de quien actuó + total real de interacciones del post.
 *
 * El total sale del CONTADOR DEL POST, no de una columna de la notificación:
 * ese número tiene que seguir siendo verdad cuando alguien saca su me gusta, y
 * un contador copiado en la notificación se desincroniza el primer día.
 */
/**
 * `firmadoComo` es el nombre del NEGOCIO cuando la acción salió firmada por una
 * ficha (0116/0117). Reemplaza al nombre de la persona, no lo acompaña: el aviso
 * tiene que decir lo mismo que ve quien abre la publicación, y ahí el comentario
 * y el me gusta figuran a nombre del local. Decir "A Manuel le gustó" cuando en
 * la publicación dice "desarrollo" es filtrar quién está detrás del negocio, que
 * es justo lo que el interruptor de perfil promete no hacer.
 */
async function readActorAndTotal(
  admin: SupabaseClient<Database>,
  actorId: string,
  postId: string,
  column: "like_count" | "comment_count",
  firmadoComo?: string | null,
): Promise<{ name: string | null; total: number }> {
  const [{ data: actor }, { data: post }] = await Promise.all([
    admin.from("profiles").select("display_name").eq("id", actorId).maybeSingle(),
    // Se traen los dos contadores en vez de armar el `select` con la variable:
    // el string del select es parte del TIPO en supabase-js, así que una columna
    // dinámica se lleva puesta la inferencia entera.
    admin.from("posts").select("like_count, comment_count").eq("id", postId).maybeSingle(),
  ]);

  const raw = post ? post[column] : null;
  return {
    name: firmadoComo?.trim() || actor?.display_name?.trim() || null,
    total: typeof raw === "number" && raw > 0 ? raw : 1,
  };
}

/**
 * "A María y 3 personas más les gustó tu publicación" — UNA fila, no cuatro.
 *
 * Nunca lanza. Si no se puede resolver el nombre de quien reaccionó, no se
 * emite: un aviso que dice "Alguien" es peor que no avisar.
 */
export async function notifyPostReaction(input: {
  tenantId: string;
  postId: string;
  authorId: string;
  actorId: string;
  /** Nombre de la ficha que firmó el me gusta, si salió a nombre de un negocio. */
  firmadoComo?: string | null;
}): Promise<void> {
  // Corte barato antes de la red. La base lo vuelve a garantizar.
  if (input.authorId === input.actorId) return;

  try {
    const admin = createAdminClient();
    const { name, total } = await readActorAndTotal(
      admin,
      input.actorId,
      input.postId,
      "like_count",
      input.firmadoComo,
    );
    if (!name) return;

    const actors = summarizeActors([name], { total });
    const verb = total > 1 ? "les gustó" : "le gustó";

    await emitSocial(admin, {
      tenantId: input.tenantId,
      recipientId: input.authorId,
      actorId: input.actorId,
      kind: "reaction",
      subjectKind: "post",
      subjectId: input.postId,
      title: `A ${actors} ${verb} tu publicación`,
      href: `/feed/${input.postId}`,
    });
  } catch (error) {
    console.warn("[feed] aviso de me gusta no emitido", {
      message: error instanceof Error ? error.message : "error desconocido",
    });
  }
}

/**
 * "María comentó tu publicación", con el arranque del comentario como cuerpo.
 *
 * El extracto se recorta corto a propósito: la notificación es una invitación a
 * abrir la publicación, no el lugar donde se lee la conversación.
 */
const COMMENT_EXCERPT_MAX = 120;

export async function notifyPostComment(input: {
  tenantId: string;
  postId: string;
  authorId: string;
  actorId: string;
  body: string;
  /** Nombre de la ficha que firmó el comentario, si salió a nombre de un negocio. */
  firmadoComo?: string | null;
}): Promise<void> {
  if (input.authorId === input.actorId) return;

  try {
    const admin = createAdminClient();
    const { name, total } = await readActorAndTotal(
      admin,
      input.actorId,
      input.postId,
      "comment_count",
      input.firmadoComo,
    );
    if (!name) return;

    const actors = summarizeActors([name], { total });
    const verb = total > 1 ? "comentaron" : "comentó";
    const excerpt = input.body.trim().slice(0, COMMENT_EXCERPT_MAX);

    await emitSocial(admin, {
      tenantId: input.tenantId,
      recipientId: input.authorId,
      actorId: input.actorId,
      kind: "comment",
      subjectKind: "post",
      subjectId: input.postId,
      title: `${actors} ${verb} tu publicación`,
      body: excerpt.length > 0 ? excerpt : null,
      href: `/feed/${input.postId}`,
    });
  } catch (error) {
    console.warn("[feed] aviso de comentario no emitido", {
      message: error instanceof Error ? error.message : "error desconocido",
    });
  }
}
