import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";

/**
 * LA ÚNICA PUERTA AL PERFIL DE OTRA PERSONA.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ESTO ES UN ARREGLO DE SEGURIDAD, NO UNA REFACTORIZACIÓN
 * ═══════════════════════════════════════════════════════════════════════════
 * Antes las dos pantallas de perfil leían `public.profiles` derecho: el propio
 * con `select("*")` y el ajeno con una lista explícita. `bio` y
 * `country_origin` viven en esa tabla, cuya policy de SELECT es `using(true)` —
 * o sea que se leían SIN pasar por los controles de privacidad, y la
 * configuración del usuario no movía nada. El comentario de la columna
 * `profile_privacy.show_bio` (0063) lo dejó anotado como el hueco a cerrar:
 *
 *   «bio y country_origin viven en `profiles` y siguen siendo legibles por
 *    lectura directa de la tabla; para que estos dos niveles apliquen de verdad,
 *    la app tiene que dejar de leer profiles directo y pasar por profile_card()»
 *
 * Esta función es ese cambio. `public.profile_card()` es SECURITY DEFINER y
 * aplica la matriz ADENTRO de la base: lo que la configuración no permite vuelve
 * NULL desde el servidor y no viaja al cliente. Si mañana alguien borra un `if`
 * de la UI, no se filtra nada — no hay nada que esconder porque nunca llegó.
 *
 * Cierra además dos cosas de yapa:
 *   · `select("*")` sobre `profiles` arrastraba `role`, `account_status`,
 *     `suspended_until`, `phone_verified`, `terms_accepted_at`… al navegador.
 *     Eso desaparece: `profile_card` devuelve 20 campos elegidos.
 *   · La función ya filtra `account_status = 'banned'` (devuelve cero filas), o
 *     sea que un perfil dado de baja deja de tener ficha sin que cada pantalla
 *     tenga que acordarse de chequearlo.
 *
 * ── LO QUE NO SALE NUNCA ─────────────────────────────────────────────────────
 * `birthdate` completa sólo la ve el dueño; el resto recibe `age` en años, y eso
 * lo garantiza la función, no la configuración. Un cumpleaños exacto + nombre +
 * ciudad es el kit de suplantación de identidad.
 */

type Client = SupabaseClient<Database>;

export interface ProfileCard {
  id: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  identityVerified: boolean;
  createdAt: string;

  /** Todos estos pueden venir en null porque la privacidad los cerró. */
  bio: string | null;
  countryOrigin: string | null;
  areaLabel: string | null;
  lastName: string | null;
  /** Años. La fecha exacta NO — ver arriba. */
  age: number | null;
  /** Sólo para el dueño. Para cualquier otro es null, siempre. */
  birthdate: string | null;
  countryResidence: string | null;
  city: string | null;
  languages: string[];

  canSeeFollowers: boolean;
  canSeePosts: boolean;
  viewerIsOwner: boolean;
  viewerIsFollower: boolean;
}

/**
 * La ficha tal como la puede ver quien llama, o `null` si el perfil no existe,
 * está dado de baja, o la función no está disponible.
 *
 * Devuelve `null` y no lanza: una ficha que no se puede armar es un 404 para la
 * persona, nunca una pantalla rota.
 */
export async function fetchProfileCard(
  supabase: Client,
  profileId: string,
): Promise<ProfileCard | null> {
  const { data, error } = await supabase.rpc("profile_card", { p_profile_id: profileId });

  if (error) {
    console.error("[perfil] profile_card falló", { code: error.code });
    return null;
  }

  // `returns table (…)` → PostgREST manda un array. Cero filas = sin ficha.
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;

  return {
    id: row.id,
    displayName: row.display_name,
    username: row.username ?? null,
    avatarUrl: row.avatar_url ?? null,
    coverUrl: row.cover_url ?? null,
    identityVerified: Boolean(row.identity_verified),
    createdAt: row.created_at,

    bio: row.bio ?? null,
    countryOrigin: row.country_origin ?? null,
    areaLabel: row.area_label ?? null,
    lastName: row.last_name ?? null,
    age: typeof row.age === "number" ? row.age : null,
    birthdate: row.birthdate ?? null,
    countryResidence: row.country_residence ?? null,
    city: row.city ?? null,
    languages: Array.isArray(row.languages) ? row.languages : [],

    canSeeFollowers: Boolean(row.can_see_followers),
    canSeePosts: Boolean(row.can_see_posts),
    viewerIsOwner: Boolean(row.viewer_is_owner),
    viewerIsFollower: Boolean(row.viewer_is_follower),
  };
}

/**
 * El nombre completo tal como corresponde mostrarlo.
 *
 * Cuando la privacidad cierra el apellido, `lastName` viene null y acá sale sólo
 * el nombre — sin puntos suspensivos ni "•••" que delaten que hay algo tapado.
 * Un indicador de "acá hay un apellido oculto" es información igual.
 */
export function fullName(card: Pick<ProfileCard, "displayName" | "lastName">): string {
  return card.lastName ? `${card.displayName} ${card.lastName}` : card.displayName;
}
