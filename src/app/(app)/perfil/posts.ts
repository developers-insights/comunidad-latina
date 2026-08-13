import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import { encodeCursor } from "@/components/listings";
import { toPostTile, type PostTile } from "./post-tiles";


/**
 * Lectura server-only de las publicaciones de un autor para el grid del perfil.
 * Espeja el patrón keyset del feed (created_at desc, id desc) y usa el cliente
 * server del usuario — RLS aplica: solo se ven los posts published del tenant
 * (el propio autor ve los suyos igual por RLS, pero acá filtramos a published
 * para que el grid muestre lo mismo que ve la comunidad).
 */

/**
 * `pinned_at` llega con la 0097 y `database.types.ts` se regenera aparte, así
 * que el parser del select la marcaría como inexistente: el valor se le pide a
 * PostgREST y el TIPO se queda en las columnas que los tipos generados ya
 * conocen. Mismo patrón —y mismo `as`— que `POST_COLUMNS` en `feed/queries.ts`.
 * Al regenerar los tipos con la 0097, borrar el cast y el alias.
 */
type ParsableTileColumns = "id, body, kind, media, created_at";
const TILE_COLUMNS =
  "id, body, kind, media, created_at, pinned_at" as ParsableTileColumns;

/** 12 = 4 filas de 3 en el primer pantallazo; el resto llega con "Ver más". */
export const PROFILE_POSTS_PAGE_SIZE = 12;

interface PostTileRow {
  id: string;
  body: string;
  kind: string;
  media: string[] | null;
  created_at: string;
  /** `posts.pinned_at` (0097). null = no está fijada. */
  pinned_at?: string | null;
}

export interface AuthorPostsPage {
  tiles: PostTile[];
  /** Cursor keyset del siguiente pantallazo, ya codificado, o null si no hay más. */
  nextCursor: string | null;
}

export async function fetchAuthorPostTiles(
  supabase: SupabaseClient<Database>,
  args: {
    tenantId: string;
    authorId: string;
    cursor: { createdAt: string; id: string } | null;
  },
): Promise<AuthorPostsPage> {
  /**
   * LA FIJADA VA PRIMERA, y sólo en la primera pantalla (0097).
   *
   * Se trae en una consulta APARTE en vez de ordenar por `pinned_at desc nulls
   * last` porque el grid pagina por KEYSET sobre (created_at, id): un orden que
   * mezcle el pin rompe el cursor —la fila fijada dejaría de estar donde el
   * cursor la busca— y "Ver más" empezaría a saltear publicaciones. Con la
   * consulta aparte, el keyset sigue siendo exactamente el de siempre y el pin
   * es un agregado que vive sólo arriba de todo.
   *
   * La consulta usa el índice único parcial `posts_pin_unico_por_autor_idx`, que
   * la 0097 crea justamente sobre (tenant_id, author_id) where pinned_at is not
   * null: es una lectura de una fila por su índice.
   */
  const pinned = args.cursor
    ? null
    : await fetchPinnedTile(supabase, args.tenantId, args.authorId);

  let query = supabase
    .from("posts")
    .select(TILE_COLUMNS)
    .eq("tenant_id", args.tenantId)
    .eq("author_id", args.authorId)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PROFILE_POSTS_PAGE_SIZE + 1);

  // Sin la fijada, que ya viaja arriba: si no, aparecería dos veces en la misma
  // pantalla.
  if (pinned) query = query.neq("id", pinned.id);

  // Keyset (mismo contrato que el feed): trae la página siguiente al cursor.
  if (args.cursor) {
    query = query.or(
      `created_at.lt."${args.cursor.createdAt}",and(created_at.eq."${args.cursor.createdAt}",id.lt."${args.cursor.id}")`,
    );
  }

  const { data, error } = await query;
  if (error) {
    // Nunca romper el perfil por el grid: sin publicaciones antes que un error.
    console.warn("[perfil] query de publicaciones falló", { code: error.code });
    return { tiles: pinned ? [pinned] : [], nextCursor: null };
  }

  const rows = (data ?? []) as PostTileRow[];
  // Un lugar menos cuando la fijada ya ocupa el primero: la pantalla mantiene su
  // tamaño (12 = 4 filas de 3) en vez de mostrar 13 y romper la última fila.
  const size = pinned ? PROFILE_POSTS_PAGE_SIZE - 1 : PROFILE_POSTS_PAGE_SIZE;
  const page = rows.slice(0, size);
  const hasMore = rows.length > size;
  const last = page[page.length - 1];

  return {
    tiles: [...(pinned ? [pinned] : []), ...page.map((row) => toPostTile(row))],
    nextCursor:
      hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

/**
 * La publicación fijada de esta persona en esta comunidad, o null.
 *
 * Nunca lanza ni rompe el grid: si la 0097 todavía no está aplicada, o la query
 * falla por lo que sea, el perfil se dibuja sin la fijada —que es exactamente
 * como se dibujaba antes— en vez de quedarse en blanco.
 */
async function fetchPinnedTile(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  authorId: string,
): Promise<PostTile | null> {
  const { data, error } = await supabase
    .from("posts")
    .select(TILE_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("author_id", authorId)
    .eq("status", "published")
    .not("pinned_at", "is", null)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[perfil] query de la publicación fijada falló", { code: error.code });
    return null;
  }
  return data ? toPostTile(data as PostTileRow) : null;
}
