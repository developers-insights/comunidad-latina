import { mediaKindOf } from "@/components/feed/helpers";
import { parseVideoCategory, type VideoCategory } from "@/lib/media/video-policy";

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

// ---------------------------------------------------------------------------
// Menú de categorías (pedido de la call 1:20) — `?cat=`
// ---------------------------------------------------------------------------

/**
 * Valor del menú que significa "no filtres por tema". No es una categoría de la
 * base: es la opción "Todos" del menú, y por eso vive acá y no en el catálogo
 * cerrado de `video-policy`.
 */
export const ALL_CATEGORIES = "todos" as const;

export type VideoCategoryFilter = VideoCategory | typeof ALL_CATEGORIES;

/**
 * `?cat=` → categoría del catálogo, "todos", o null si no vino (o vino basura).
 *
 * NULL Y "todos" NO SON LO MISMO, y de esa diferencia depende la pantalla:
 * null = la persona todavía no eligió ⇒ se le muestra el MENÚ;
 * "todos" = eligió ver todo ⇒ se le muestra el reel sin filtro de tema.
 * Colapsar los dos casos devolvería el módulo a "entra reproduciendo de una",
 * que es justo lo que el cliente pidió cambiar.
 */
export function parseVideoCategoryParam(
  raw: string | undefined,
): VideoCategoryFilter | null {
  const value = (raw ?? "").trim();
  if (value.length === 0) return null;
  if (value === ALL_CATEGORIES) return ALL_CATEGORIES;
  return parseVideoCategory(value);
}

/** El tema que se manda a la query: null cuando no hay que filtrar por tema. */
export function categoryFilterValue(
  filter: VideoCategoryFilter | null,
): VideoCategory | null {
  return filter && filter !== ALL_CATEGORIES ? filter : null;
}

/**
 * ¿Hay que mostrar el MENÚ de categorías en vez del reel?
 *
 * Sólo cuando la persona llega a `/videos` pelado. Con `?start=` (un video
 * compartido o tocado en el feed) se va derecho al video: interponer un menú
 * rompería el deep link, que es exactamente lo que se comparte. Con `?scope=`
 * (el reel acotado a un módulo) también, porque ese link YA declara qué quiere
 * ver — el menú de temas es otra dimensión, no la misma.
 */
export function shouldShowCategoryMenu(args: {
  category: VideoCategoryFilter | null;
  startId: string | null;
  rawScope: string;
}): boolean {
  return args.category === null && !args.startId && args.rawScope.trim().length === 0;
}
