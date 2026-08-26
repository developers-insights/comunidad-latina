import { DEFAULT_TIME_ZONE } from "@/lib/utils";
import type { PostTile } from "./post-tiles";

/**
 * LAS OCHO PESTAÑAS DEL PERFIL (contrato 2026-07-30 §B.6 + "Avisos", pedido del
 * cliente 2026-08-26: un evento o aviso publicado tiene que verse en la página
 * de quien lo publicó) — parte PURA.
 *
 * Sin `server-only` y sin imports de Supabase a propósito: acá viven el orden,
 * los ids, el copy y el parseo del `?t=`, que es lo que se testea en node sin
 * jsdom ni base. Las consultas viven en `profile-data.ts` (y, para "avisos",
 * en `profile-listings.ts` — separada porque reusa la capa de datos del feed y
 * no tiene nada que ver con `posts`/`follows`/`gig_reviews`, que es lo que
 * consulta el resto de ese archivo).
 *
 * "AVISOS" VA DESPUÉS DE "VIDEOS" Y ANTES DE "INFORMACIÓN": las tres primeras
 * pestañas (publicaciones, fotos, videos) son galerías de `posts` — contenido
 * social. "Avisos" es la otra mitad de lo que esta persona publicó —`listings`,
 * no `posts`— y por eso cierra ese grupo en vez de mezclarse con él. Recién
 * después viene "Información" (quién es), "Reseñas" (qué dicen de ella) y el
 * grafo social (seguidores/siguiendo): de "qué publicó" a "quién es" a "qué
 * dicen" a "con quién se conecta" es el único orden de los tres que no salta
 * de un tema al otro y vuelve.
 */

export const PROFILE_TAB_IDS = [
  "publicaciones",
  "fotos",
  "videos",
  "avisos",
  "informacion",
  "resenas",
  "seguidores",
  "siguiendo",
] as const;

export type ProfileTabId = (typeof PROFILE_TAB_IDS)[number];

export const PROFILE_TAB_LABELS: Record<ProfileTabId, string> = {
  publicaciones: "Publicaciones",
  fotos: "Fotos",
  videos: "Videos",
  avisos: "Avisos",
  informacion: "Información",
  resenas: "Reseñas",
  seguidores: "Seguidores",
  siguiendo: "Siguiendo",
};

/**
 * `?t=` → pestaña. Cualquier cosa rara cae en "publicaciones" en vez de 404:
 * una URL vieja o mal copiada tiene que abrir el perfil igual.
 */
export function parseProfileTab(raw: string | undefined): ProfileTabId {
  const value = (raw ?? "").trim().toLowerCase();
  return (PROFILE_TAB_IDS as readonly string[]).includes(value)
    ? (value as ProfileTabId)
    : "publicaciones";
}

/**
 * Construye el href de una pestaña conservando la base (`/perfil` o
 * `/perfil/<id>`). "publicaciones" va SIN query: es la URL canónica del perfil
 * y no queremos dos direcciones para la misma pantalla.
 *
 * El cursor de paginación NO se arrastra entre pestañas a propósito: un cursor
 * de "fotos" no significa nada en "seguidores", y arrastrarlo abría la pestaña
 * nueva en la mitad de una lista que la persona nunca vio.
 */
export function profileTabHref(base: string, tab: ProfileTabId): string {
  return tab === "publicaciones" ? base : `${base}?t=${tab}`;
}

/** Un tile de foto/video: lo que alimenta las pestañas Fotos y Videos. */
export function filterTilesByKind(tiles: PostTile[], kind: "image" | "video"): PostTile[] {
  return tiles.filter((tile) => tile.tileKind === kind);
}

/**
 * "Miembro desde marzo de 2026".
 *
 * Mes y año, NUNCA el día: la fecha exacta de alta es un dato de la cuenta y
 * §9 prohíbe exponer datos personales finos en el perfil público. El mes ya
 * comunica lo único que importa acá — la antigüedad como señal de confianza.
 *
 * ⚠️ LA ZONA NO ES OPCIONAL AUNQUE SEA UN MES. Este formateo no tenía ninguna,
 * o sea que usaba el reloj del RUNTIME: el server de Vercel corre en UTC y el
 * teléfono de la persona en su huso, así que alguien que se registró el 1 de
 * marzo a las 02:00 UTC salía "marzo" en el servidor y "febrero" en el
 * navegador de Nueva York. Mismatch de hidratación y, encima, un mes falso. Se
 * usa la zona de quien MIRA, con la de la comunidad como piso.
 */
export function memberSinceLabel(
  createdAt: string,
  locale: string,
  timeZone: string = DEFAULT_TIME_ZONE,
): string | null {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone,
  }).format(date);
}
