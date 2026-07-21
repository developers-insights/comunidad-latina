import { mediaKindOf } from "@/components/feed/helpers";

/**
 * Helpers PUROS del módulo VIDEOS (reels). Sin dependencias de servidor:
 * los usan el server component, la server action y los tests de nodo.
 *
 * El scope espeja los tabs del feed (§4.b): "para-ti" muestra todos los
 * videos visibles; los otros cuatro filtran por el vertical del listing
 * asociado al post (posts.entity_listing_id → listings.kind). Pedido del
 * cliente: "el sistema debe reutilizar el mismo reproductor; dependiendo del
 * módulo, muestra solo videos de ese módulo".
 */

export const VIDEO_SCOPES = [
  { id: "para-ti", listingKind: null },
  { id: "propiedades", listingKind: "property" },
  { id: "negocios", listingKind: "business" },
  { id: "profesionales", listingKind: "professional" },
  { id: "eventos", listingKind: "event" },
] as const;

export type VideosScope = (typeof VIDEO_SCOPES)[number]["id"];

export function parseVideosScope(raw: string | undefined): VideosScope {
  const found = VIDEO_SCOPES.find((scope) => scope.id === raw);
  return found?.id ?? "para-ti";
}

/** Vertical de listing que filtra el scope (null = todos, "para-ti"). */
export function scopeListingKind(scope: VideosScope): string | null {
  return VIDEO_SCOPES.find((s) => s.id === scope)?.listingKind ?? null;
}

/**
 * ¿El post trae al menos un video? posts.media guarda fotos y videos en el
 * mismo array (0025) sin columna de tipo: el kind se infiere por extensión.
 * PostgREST no filtra arrays por patrón con elegancia, así que el módulo
 * escanea páginas de posts y filtra acá, en memoria.
 */
export function hasVideoMedia(mediaPaths: readonly string[] | null | undefined): boolean {
  return (mediaPaths ?? []).some(
    (path) => path && path.trim().length > 0 && mediaKindOf(path) === "video",
  );
}

/** `?param=` puede llegar como string o string[] — normaliza al primero. */
export function firstParamValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?start=` solo se acepta si es un uuid con pinta de post id. */
export function parseStartId(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  return UUID_RE.test(value) ? value : null;
}
