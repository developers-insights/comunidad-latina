import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * =============================================================================
 * ETIQUETAS EN PUBLICACIONES (migración 0089) — contrato compartido
 * =============================================================================
 *
 * Este archivo es el único que conocen a la vez el servidor (las actions, las
 * queries del feed) y el cliente (el selector, la línea "con Ana y 2 más"). Por
 * eso NO lleva `server-only` y NO importa nada de `@/lib/supabase/*`: recibe el
 * cliente por parámetro. Lo que vive acá es contrato y lógica pura; lo que
 * escribe vive en `feed/tag-actions.ts`.
 *
 * Las funciones de lectura no lanzan NUNCA. Una etiqueta que no se pinta es
 * molesta; un feed que no carga porque la migración todavía no está aplicada en
 * ese entorno, no. Mismo criterio que `fetchPostPolls` en `feed/queries.ts`.
 */

/** Tope duro por publicación. La base lo repite en app.post_tags_enforce_cap(). */
export const MAX_POST_TAGS = 20;

/** Mínimo de caracteres para que el buscador salga a preguntar. Espeja la RPC. */
export const MIN_TAG_QUERY_LENGTH = 2;

/** Resultados que devuelve la RPC como máximo (clampeado también en la base). */
export const TAG_SEARCH_LIMIT = 8;

/** Cuántos nombres se escriben antes de resumir con "y N más". */
export const TAGGED_NAMES_SHOWN = 2;

export interface TaggedProfile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * Cómo se parte la lista para escribirla: los primeros nombres y cuántos
 * quedaron afuera. La FRASE la arma el copy (`people-tagger-copy.ts`); acá sólo
 * está la aritmética, que es lo que se puede testear sin leer español.
 */
export interface TaggedSummary {
  names: string[];
  extraCount: number;
}

export function summarizeTagged(
  people: readonly TaggedProfile[],
  shown: number = TAGGED_NAMES_SHOWN,
): TaggedSummary {
  const visible = people.slice(0, Math.max(0, shown));
  return {
    names: visible.map((person) => person.displayName),
    extraCount: Math.max(0, people.length - visible.length),
  };
}

/** ¿Ya está en la lista? Comparación por id — dos personas pueden llamarse igual. */
export function isTagged(people: readonly TaggedProfile[], id: string): boolean {
  return people.some((person) => person.id === id);
}

/**
 * Agrega respetando el tope y la unicidad. Devuelve la MISMA referencia cuando
 * no hay nada que cambiar, así el `onChange` del selector no dispara renders
 * de más ni marca el formulario como sucio por un toque repetido.
 */
export function addTagged(
  people: readonly TaggedProfile[],
  person: TaggedProfile,
  max: number = MAX_POST_TAGS,
): TaggedProfile[] {
  if (isTagged(people, person.id) || people.length >= max) return people as TaggedProfile[];
  return [...people, person];
}

export function removeTagged(
  people: readonly TaggedProfile[],
  id: string,
): TaggedProfile[] {
  if (!isTagged(people, id)) return people as TaggedProfile[];
  return people.filter((person) => person.id !== id);
}

/**
 * Qué hay que insertar y qué hay que borrar para que las etiquetas de un post
 * queden como pide `next`. Se resuelve ACÁ, en una función pura, y no con un
 * "borrá todo e insertá todo": ese atajo dispararía una notificación nueva por
 * cada persona que YA estaba etiquetada cada vez que el autor toca la lista.
 */
export function diffTagIds(
  current: readonly string[],
  next: readonly string[],
): { toAdd: string[]; toRemove: string[] } {
  const currentSet = new Set(current);
  const nextSet = new Set(next);
  return {
    toAdd: [...nextSet].filter((id) => !currentSet.has(id)),
    toRemove: [...currentSet].filter((id) => !nextSet.has(id)),
  };
}

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

/**
 * `post_tags` no está en `database.types.ts` hasta que se regenere el archivo
 * (la 0089 es nueva), así que la lectura va con el cliente de esquema abierto —
 * mismo patrón que `saves` y `post_poll_votes` en `feed/queries.ts`.
 */
type OpenClient = SupabaseClient;

interface TagRow {
  post_id: string;
  profile_id: string;
  profiles: { id: string; display_name: string; avatar_url: string | null } | null;
}

/**
 * Etiquetas de una tanda de posts, en UNA query, listas para la card.
 *
 * El join a `profiles` es explícito y acotado a tres columnas: nombre y avatar
 * es todo lo que la card necesita, y pedir `*` sobre una tabla con columnas
 * revocadas para `anon` (0058) haría fallar la consulta entera en las páginas
 * públicas.
 *
 * La RLS ya decide qué filas se ven (`post_tags_select`): acá no se filtra nada
 * por seguridad, sólo se ordena para que la frase salga siempre igual.
 */
export async function fetchPostTags(
  supabase: SupabaseClient,
  postIds: readonly string[],
): Promise<Map<string, TaggedProfile[]>> {
  const byPostId = new Map<string, TaggedProfile[]>();
  const ids = [...new Set(postIds.filter(Boolean))];
  if (ids.length === 0) return byPostId;

  const open = supabase as OpenClient;
  const { data, error } = await open
    .from("post_tags")
    .select("post_id, profile_id, profiles!post_tags_profile_id_fkey(id, display_name, avatar_url)")
    .in("post_id", ids)
    .order("created_at", { ascending: true });

  if (error) {
    // Sin la migración aplicada no hay etiquetas que mostrar, y eso no es un
    // motivo para romper el feed.
    console.warn("[social] query de etiquetas falló", { code: error.code });
    return byPostId;
  }

  for (const row of (data ?? []) as unknown as TagRow[]) {
    const profile = row.profiles;
    if (!profile) continue; // perfil borrado a mitad de la lectura
    const list = byPostId.get(row.post_id) ?? [];
    list.push({
      id: profile.id,
      displayName: profile.display_name,
      avatarUrl: profile.avatar_url,
    });
    byPostId.set(row.post_id, list);
  }
  return byPostId;
}

/** Las etiquetas de UN post. Azúcar sobre `fetchPostTags` para el detalle. */
export async function fetchTagsForPost(
  supabase: SupabaseClient,
  postId: string,
): Promise<TaggedProfile[]> {
  const byPostId = await fetchPostTags(supabase, [postId]);
  return byPostId.get(postId) ?? [];
}
