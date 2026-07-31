import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";

/**
 * Consultas de las pestañas del perfil (contrato 2026-07-30 §B.5/§B.6).
 *
 * Todo sale del cliente SERVER del usuario, así que RLS manda: lo que la
 * persona no puede ver, no vuelve. Nada de `admin.ts` acá.
 */

export interface ProfileCounts {
  posts: number;
  /** Cuánta gente sigue a este perfil. FALTABA — es el pedido §B.5. */
  followers: number;
  following: number;
  reviews: number;
}

/**
 * Los cuatro contadores del perfil, en una sola ida.
 *
 * ── SEGUIDORES: por qué recién ahora ─────────────────────────────────────────
 * PROGRESS decía que "Seguidores" se había omitido porque "ningún perfil
 * general tiene follow hoy". Eso dejó de ser cierto: la migración 0023 creó
 * `follows` con `target_kind` polimórfico ('listing' | 'profile') y su política
 * de INSERT contempla explícitamente seguir un PERFIL (chequea `pair_blocked`
 * para no dejar seguir a alguien que te bloqueó). O sea que el grafo
 * persona→persona existe en la base; lo que faltaba era mostrarlo. Verificado
 * en supabase/migrations/0023_follows_post_reach.sql antes de escribir esto.
 *
 * `follows_select` es tenant-wide para authenticated, así que el contador es
 * legible por cualquier miembro del tenant — no hace falta ninguna vía especial.
 *
 * OJO con la asimetría, que es donde estaba el bug latente:
 *   seguidores → `target_kind='profile'` AND `target_id = <perfil>`
 *   siguiendo  → `follower_id = <perfil>`  (sin filtrar target_kind: seguir un
 *                negocio también es "seguir", y es lo que el contador ya decía
 *                antes de este cambio; no se altera su significado).
 */
export async function fetchProfileCounts(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; profileId: string },
): Promise<ProfileCounts> {
  const { tenantId, profileId } = args;
  const [posts, followers, following, reviews] = await Promise.all([
    supabase
      .from("posts")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("author_id", profileId)
      .eq("status", "published"),
    supabase
      .from("follows")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("target_kind", "profile")
      .eq("target_id", profileId),
    supabase
      .from("follows")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("follower_id", profileId),
    supabase
      .from("gig_reviews")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("ratee_id", profileId),
  ]);

  return {
    posts: posts.count ?? 0,
    followers: followers.count ?? 0,
    following: following.count ?? 0,
    reviews: reviews.count ?? 0,
  };
}

export interface PersonRow {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  areaLabel: string | null;
  identityVerified: boolean;
}

/** Cuánta gente entra en una pestaña de personas antes de "Ver más". */
export const PROFILE_PEOPLE_PAGE_SIZE = 24;

/**
 * Seguidores o seguidos, ya resueltos a personas.
 *
 * Dos idas y no un join anidado por una razón concreta: `follows` es
 * POLIMÓRFICA (`target_id` apunta a `listings` o a `profiles` según
 * `target_kind`) y por eso NO tiene foreign key hacia `profiles`. Sin FK,
 * PostgREST no puede hacer el embed `follows(profiles(...))`: devuelve
 * PGRST200. Así que primero se piden los ids y después los perfiles.
 *
 * En "siguiendo" se filtra a `target_kind='profile'`: la lista es de PERSONAS.
 * El CONTADOR de siguiendo sigue incluyendo negocios y eventos (ver
 * fetchProfileCounts), así que el número de arriba puede ser mayor que lo que
 * se ve en la lista. Es deliberado y está dicho en el copy de la pestaña —
 * mentir en el contador para que cierre con la lista sería peor.
 */
export async function fetchFollowPeople(
  supabase: SupabaseClient<Database>,
  args: {
    tenantId: string;
    profileId: string;
    /** "seguidores" = quién lo sigue · "siguiendo" = a quién sigue. */
    direction: "followers" | "following";
  },
): Promise<PersonRow[]> {
  const { tenantId, profileId, direction } = args;

  let query = supabase
    .from("follows")
    .select("follower_id, target_id")
    .eq("tenant_id", tenantId)
    .eq("target_kind", "profile")
    .order("created_at", { ascending: false })
    .limit(PROFILE_PEOPLE_PAGE_SIZE);

  query =
    direction === "followers"
      ? query.eq("target_id", profileId)
      : query.eq("follower_id", profileId);

  const { data, error } = await query;
  if (error) {
    console.warn("[perfil] query de follows falló", { code: error.code, direction });
    return [];
  }

  const ids = (data ?? []).map((row) =>
    direction === "followers" ? row.follower_id : row.target_id,
  );
  if (ids.length === 0) return [];

  const { data: people, error: peopleError } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url, area_label, identity_verified")
    .in("id", ids);

  if (peopleError) {
    console.warn("[perfil] query de perfiles de follows falló", { code: peopleError.code });
    return [];
  }

  // Se reordena según `ids` para conservar el orden por fecha del follow: el
  // `.in()` vuelve en el orden que quiere Postgres, no en el que se pidió.
  const byId = new Map((people ?? []).map((p) => [p.id, p]));
  return ids
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({
      id: p.id,
      displayName: p.display_name,
      avatarUrl: p.avatar_url,
      areaLabel: p.area_label,
      identityVerified: p.identity_verified,
    }));
}

export interface ReviewRow {
  id: string;
  rating: number;
  body: string | null;
  createdAt: string;
  reviewerName: string;
  reviewerAvatarUrl: string | null;
}

/**
 * Reseñas RECIBIDAS por este perfil.
 *
 * Son reales y ya existían: `gig_reviews` (0024, endurecida en 0033) guarda la
 * calificación mutua de cada contrato del Creator Marketplace, con `ratee_id`
 * apuntando a quien la recibe. `gig_reviews_select` deja leer las que tienen
 * `visible = true` —una reseña ocultada por moderación no vuelve— así que la
 * pestaña no necesita filtrar nada a mano.
 *
 * Con el Creator Marketplace apagado hasta dentro de 3-4 meses (dicho por el
 * cliente en la call, 1:10), lo normal HOY es que esta pestaña esté vacía. Por
 * eso su estado vacío explica de dónde vendrían las reseñas en vez de decir
 * "no hay nada": un vacío que no se explica se lee como una función rota.
 */
export async function fetchProfileReviews(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; profileId: string },
): Promise<ReviewRow[]> {
  const { data, error } = await supabase
    .from("gig_reviews")
    .select("id, rating, body, created_at, reviewer_id")
    .eq("tenant_id", args.tenantId)
    .eq("ratee_id", args.profileId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.warn("[perfil] query de reseñas falló", { code: error.code });
    return [];
  }

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const { data: reviewers } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", rows.map((r) => r.reviewer_id));

  const byId = new Map((reviewers ?? []).map((p) => [p.id, p]));

  return rows.map((row) => {
    const reviewer = byId.get(row.reviewer_id);
    return {
      id: row.id,
      rating: row.rating,
      body: row.body,
      createdAt: row.created_at,
      // Sin perfil legible (borrado o fuera del tenant) la reseña NO se
      // esconde: el promedio la cuenta igual, así que ocultarla mentiría.
      reviewerName: reviewer?.display_name ?? "Alguien de la comunidad",
      reviewerAvatarUrl: reviewer?.avatar_url ?? null,
    };
  });
}
