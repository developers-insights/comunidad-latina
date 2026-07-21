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

const TILE_COLUMNS = "id, body, kind, media, created_at";

/** 12 = 4 filas de 3 en el primer pantallazo; el resto llega con "Ver más". */
export const PROFILE_POSTS_PAGE_SIZE = 12;

interface PostTileRow {
  id: string;
  body: string;
  kind: string;
  media: string[] | null;
  created_at: string;
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
  let query = supabase
    .from("posts")
    .select(TILE_COLUMNS)
    .eq("tenant_id", args.tenantId)
    .eq("author_id", args.authorId)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PROFILE_POSTS_PAGE_SIZE + 1);

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
    return { tiles: [], nextCursor: null };
  }

  const rows = (data ?? []) as PostTileRow[];
  const page = rows.slice(0, PROFILE_POSTS_PAGE_SIZE);
  const hasMore = rows.length > PROFILE_POSTS_PAGE_SIZE;
  const last = page[page.length - 1];

  return {
    tiles: page.map((row) => toPostTile(row)),
    nextCursor:
      hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  };
}
