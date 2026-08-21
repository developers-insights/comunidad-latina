"use server";

import { decodeCursor, encodeCursor } from "@/components/listings";
import type { AuthorView } from "@/components/feed/helpers";
import {
  COMMENT_THREAD_PAGE_SIZE,
  fetchCommentThreadPage,
  filterBlockedComments,
} from "@/components/feed/comment-thread";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { timeAgo } from "@/lib/utils";
import { authorViewOf, fetchAuthorViews, fetchBlockedIds } from "../queries";

/**
 * Módulo FLUIDEZ del hilo — la tanda ANTERIOR de comentarios, como server
 * action.
 *
 * ANTES esto era una recarga: "Ver comentarios anteriores" era un
 * `<Link href="?antes=…">` y cada tanda repintaba la ruta entera y te devolvía
 * arriba de todo. Leer un hilo largo costaba una navegación por tanda, y cada
 * una te sacaba justo del punto donde estabas siguiendo la conversación
 * (cliente 2026-08-20: "ahí nomás dentro de pantalla se tiene que fluir; si no
 * es como que te corta el mambo. Mientras menos pasos mejor").
 *
 * Es el mismo patrón que `feed/load-more.ts` usa para el scroll infinito del
 * feed, y por la misma razón: la lógica de "armar una tanda" pelada de JSX, que
 * llaman TANTO el server component de la página (primera tanda, server→server,
 * sin red) COMO la isla cliente (las siguientes). El keyset en sí vive una sola
 * vez todavía más adentro, en `components/feed/comment-thread.ts`, compartido
 * también con la hoja del feed.
 *
 * SEGURIDAD (guía server-actions.md): esto es un POST alcanzable por cualquiera,
 * no sólo por el botón de la UI. Por eso:
 *  · NUNCA acepta `tenantId` ni `viewerId` del caller — los resuelve acá adentro
 *    (getTenant / JWT);
 *  · el `cursor` pasa por `decodeCursor`, que valida forma (ISO + uuid) antes de
 *    que nada se interpole en un filtro de PostgREST;
 *  · confirma que el POST sea visible para quien pregunta antes de devolver su
 *    hilo. La policy `comments_select` (0091) deja leer todo comentario
 *    `published` sin mirar el estado de su publicación, así que sin este chequeo
 *    la action sería más laxa que la página —que hace `notFound()` cuando la RLS
 *    esconde el post— y el hilo de una publicación en revisión se leería con
 *    sólo tener el id.
 *
 * Es una LECTURA: nunca muta ni revalida cache, y no exige sesión (la RLS ya
 * decide qué ve cada quien).
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un comentario de la tanda, ya con su autor y su tiempo resueltos. */
export interface OlderCommentItem {
  id: string;
  body: string;
  /**
   * "hace 3 min" ya formateado en el servidor. Va resuelto y no crudo porque la
   * primera tanda —la que renderiza la página— lo hace igual: si la isla lo
   * calculara por su cuenta, dos comentarios de la misma hora podrían decir
   * cosas distintas según de qué tanda vinieron.
   */
  timeAgoLabel: string;
  /**
   * Sólo para decidir qué OFRECER (el menú de borrar). El permiso lo tiene la
   * policy `comments_delete`, y la server action del borrado lee cuántas filas
   * volvieron.
   */
  authorId: string | null;
  author: AuthorView;
}

export interface OlderCommentsPage {
  ok: true;
  items: OlderCommentItem[];
  /** Cursor de la tanda siguiente hacia atrás. `null` = se terminó el hilo. */
  olderCursor: string | null;
}

export interface OlderCommentsUnavailable {
  ok: false;
}

export type OlderCommentsResult = OlderCommentsPage | OlderCommentsUnavailable;

/**
 * La tanda anterior a `cursor` del hilo de `postId`.
 *
 * Devuelve `{ ok: false }` ante lo esperable (cursor inválido, post que ya no se
 * ve, hilo que no se pudo leer) y LANZA ante lo que no debería pasar — en
 * particular si no se pueden leer los bloqueos del viewer, que es fail-closed a
 * propósito: devolver un set vacío convertiría "no pude leer tus bloqueos" en
 * "no bloqueaste a nadie". Las dos cosas terminan en el mismo lugar para quien
 * lee: el bloque de error con "Reintentar", sin tocar el hilo que ya está en
 * pantalla.
 */
export async function fetchOlderCommentsAction(input: {
  postId: string;
  cursor: string;
}): Promise<OlderCommentsResult> {
  if (!UUID_RE.test(input.postId)) return { ok: false };

  const olderThan = decodeCursor(input.cursor);
  if (!olderThan) return { ok: false };

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewerId = user?.id ?? null;

  // Una fila por su clave primaria, con la MISMA RLS que usa la página para
  // decidir entre renderizar o notFound(). Es el chequeo de visibilidad del
  // docblock de arriba.
  const { data: postRow } = await supabase
    .from("posts")
    .select("id")
    .eq("id", input.postId)
    .maybeSingle();
  if (!postRow) return { ok: false };

  const result = await fetchCommentThreadPage(supabase, {
    postId: input.postId,
    tenantId: tenant.id,
    olderThan,
    pageSize: COMMENT_THREAD_PAGE_SIZE.detail,
  });
  if (!result.ok) return { ok: false };

  const blocked = await fetchBlockedIds(supabase, viewerId);
  const rows = filterBlockedComments(result.page.rows, blocked);

  const authors = await fetchAuthorViews(
    supabase,
    rows.map((row) => row.authorId).filter((id): id is string => Boolean(id)),
  );

  const now = new Date();
  return {
    ok: true,
    items: rows.map((row) => ({
      id: row.id,
      body: row.body,
      timeAgoLabel: timeAgo(row.createdAt, now),
      authorId: row.authorId,
      author: authorViewOf(authors, row.authorId),
    })),
    // El cursor sale de la última fila LEÍDA, no de la última visible: si el
    // filtro de bloqueados se comió la más vieja, la tanda siguiente tiene que
    // arrancar igual donde terminó ésta.
    olderCursor:
      result.page.hasOlder && result.page.olderCursor
        ? encodeCursor(
            result.page.olderCursor.createdAt,
            result.page.olderCursor.id,
          )
        : null,
  };
}
