import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import { encodeCursor } from "@/components/listings";
import { toPostTile } from "../post-tiles";
import {
  toSavedListingTile,
  type PostTile,
  type SavedItem,
  type SavedListingInput,
  type SavedListingTile,
} from "./saved-tile";

/**
 * Lectura server-only de los guardados del dueño de la sesión para
 * /perfil/guardados (tabla `saves`, 0038).
 *
 * Privacidad: NO recibe un `profileId` externo — siempre lee `args.viewerId`,
 * que el caller obtiene de `auth.getUser()` de LA PROPIA sesión. No existe un
 * parámetro "de quién" que un caller pueda desviar hacia otra persona, y la RLS
 * de `saves` (profile_id = auth.uid()) es la segunda barrera. No hay ruta
 * pública equivalente (no hay /perfil/[id]/guardados) — tercera barrera.
 *
 * `saves` todavía no está en database.types.ts (llegó con la 0038) → cliente de
 * schema abierto, mismo patrón que fetchViewerSaves en feed/queries.ts.
 *
 * Nunca lanza: cualquier error se resuelve a `{ ok: false }` (logueado, nunca
 * mudo) para que la página muestre un estado de error DISTINTO del vacío — acá
 * "no pudimos cargar" y "no guardaste nada" no pueden confundirse.
 */

type Supabase = SupabaseClient<Database>;

/** 10 filas por página: lista mixta (no grid), liviana y cómoda para el pulgar. */
export const SAVED_ITEMS_PAGE_SIZE = 10;

interface SaveRow {
  id: string;
  subject_kind: "post" | "listing";
  subject_id: string;
  created_at: string;
}

interface SavedPostRow {
  id: string;
  body: string;
  kind: string;
  media: string[] | null;
  created_at: string;
}

export interface SavedItemsPage {
  items: SavedItem[];
  /** Cursor keyset del siguiente pantallazo, ya codificado, o null si no hay más. */
  nextCursor: string | null;
}

export type SavedItemsResult = { ok: true; page: SavedItemsPage } | { ok: false };

/** posts guardados → Map por id, para hidratar los tiles en el orden de `saves`. */
async function fetchSavedPostTiles(
  supabase: Supabase,
  tenantId: string,
  ids: string[],
): Promise<Map<string, PostTile>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from("posts")
    .select("id, body, kind, media, created_at")
    .eq("tenant_id", tenantId)
    .eq("status", "published")
    .in("id", ids);
  if (error) throw new Error(`saved-posts:${error.code}`);
  const rows = (data ?? []) as SavedPostRow[];
  return new Map(rows.map((row) => [row.id, toPostTile(row)]));
}

/** listings guardados → Map por id (omite kinds sin ruta pública, ver saved-tile.ts). */
async function fetchSavedListingTiles(
  supabase: Supabase,
  tenantId: string,
  ids: string[],
): Promise<Map<string, SavedListingTile>> {
  const map = new Map<string, SavedListingTile>();
  if (ids.length === 0) return map;
  const { data, error } = await supabase
    .from("listings")
    .select("id, kind, title, price_amount, price_currency, price_period, area_label, photos")
    .eq("tenant_id", tenantId)
    .eq("status", "published")
    .in("id", ids);
  if (error) throw new Error(`saved-listings:${error.code}`);
  const rows = (data ?? []) as SavedListingInput[];
  for (const row of rows) {
    const tile = toSavedListingTile(row);
    if (tile) map.set(row.id, tile);
  }
  return map;
}

export async function fetchSavedItems(
  supabase: Supabase,
  args: {
    tenantId: string;
    viewerId: string;
    cursor: { createdAt: string; id: string } | null;
  },
): Promise<SavedItemsResult> {
  try {
    // `saves` no está tipado todavía (0038) — mismo escape hatch que
    // fetchSavedSubjectIds en feed/queries.ts. Sigue siendo el MISMO cliente
    // (mismas cookies/sesión): la RLS no se ve afectada por el cast de tipos.
    const open = supabase as unknown as SupabaseClient;
    let query = open
      .from("saves")
      .select("id, subject_kind, subject_id, created_at")
      .eq("tenant_id", args.tenantId)
      .eq("profile_id", args.viewerId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(SAVED_ITEMS_PAGE_SIZE + 1);

    // Keyset (mismo contrato que fetchAuthorPostTiles): la página siguiente al cursor.
    if (args.cursor) {
      query = query.or(
        `created_at.lt."${args.cursor.createdAt}",and(created_at.eq."${args.cursor.createdAt}",id.lt."${args.cursor.id}")`,
      );
    }

    const { data, error } = await query;
    if (error) throw new Error(`saves:${error.code}`);

    const rows = (data ?? []) as SaveRow[];
    const page = rows.slice(0, SAVED_ITEMS_PAGE_SIZE);
    const hasMore = rows.length > SAVED_ITEMS_PAGE_SIZE;
    const last = page[page.length - 1];

    const postIds = page.filter((r) => r.subject_kind === "post").map((r) => r.subject_id);
    const listingIds = page.filter((r) => r.subject_kind === "listing").map((r) => r.subject_id);

    const [postTiles, listingTiles] = await Promise.all([
      fetchSavedPostTiles(supabase, args.tenantId, postIds),
      fetchSavedListingTiles(supabase, args.tenantId, listingIds),
    ]);

    const items: SavedItem[] = [];
    for (const row of page) {
      if (row.subject_kind === "post") {
        const post = postTiles.get(row.subject_id);
        if (!post) continue; // post borrado/despublicado desde que se guardó
        items.push({ key: row.id, subjectKind: "post", post });
      } else {
        const listing = listingTiles.get(row.subject_id);
        if (!listing) continue; // listing borrado/despublicado, o kind sin ruta pública
        items.push({ key: row.id, subjectKind: "listing", listing });
      }
    }

    return {
      ok: true,
      page: {
        items,
        nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
      },
    };
  } catch (err) {
    console.error("[perfil/guardados] fetchSavedItems falló", {
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: false };
  }
}
