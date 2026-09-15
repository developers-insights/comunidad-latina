import { mediaKindOf, postMediaUrl } from "@/components/feed/helpers";
import { firstPhotoUrl } from "@/components/listings";
import { estadoDePromocion } from "@/lib/boosts/estado-promocion";
import type { EstadoPromocion } from "@/lib/boosts/estado-promocion";

/**
 * Modelo PURO de una fila de /impulsar (índice "Promocioná lo tuyo").
 *
 * Sin imports de servidor a propósito — mismo criterio que perfil/post-tiles.ts:
 * la RSC de page.tsx hace las queries y le pasa filas crudas a estas funciones,
 * que son las que se testean en entorno node (sin jsdom, sin mock de Supabase).
 */

export type ImpulsarItemKind = "listing" | "post";

/**
 * La regla de "¿puedo promocionar esto?" vive en `lib/boosts/estado-promocion`
 * desde que también la usan las pantallas de éxito de los wizards, que son
 * componentes de cliente y no pueden importar de una ruta del App Router. Se
 * reexporta para no tocar a nadie que ya la traía de acá.
 */
export {
  estadoDePromocion,
  puedePromocionarse,
  type EstadoPromocion,
} from "@/lib/boosts/estado-promocion";

/** Ventana de "recién creado" — ver `esReciente`. */
export const RECIENTE_MS = 30 * 60 * 1000;

/**
 * ¿Esto se creó hace un rato?
 *
 * Es lo que cierra el círculo del botón "Crear" del índice cuando el creador
 * de destino NO devuelve a Boost por su cuenta. Sólo el wizard de /publicar
 * ofrece "Impulsar este anuncio" al terminar; empleos, marketplace, creadores
 * y el feed cierran en su propia pantalla de éxito, y ninguna de esas es de
 * este módulo. La persona vuelve a /impulsar por donde sea (atrás, el nav, el
 * "+") y lo recién hecho ya está primero —la query ordena por created_at—:
 * esto es lo único que faltaba para DECIRLO en vez de dejarlo adivinar.
 *
 * `ahoraMs` entra por parámetro y no se lee acá: así todas las filas de una
 * misma pantalla miden contra el mismo instante (y la función se testea sin
 * tocar el reloj). El `delta >= 0` descarta fechas futuras — un reloj torcido
 * no debería encender la etiqueta para siempre.
 */
export function esReciente(createdAt: string, ahoraMs: number): boolean {
  const creado = Date.parse(createdAt);
  if (Number.isNaN(creado)) return false;
  const delta = ahoraMs - creado;
  return delta >= 0 && delta <= RECIENTE_MS;
}

export interface ImpulsarItem {
  id: string;
  kind: ImpulsarItemKind;
  /** Vertical del aviso (property/business/professional/event/job) o kind del post (post/question/text). */
  subKind: string;
  /** Título del aviso, o un recorte del cuerpo del post (nunca vacío: hay respaldo). */
  title: string;
  /** URL pública de la primera foto (avisos) o el primer medio (posts). null sin medios. */
  thumbnailUrl: string | null;
  /** true si el thumbnail es un video (posts.media puede traer video primero). */
  thumbnailIsVideo: boolean;
  /** Estado combinado fila + promoción: decide el chip, la nota y si hay botón. */
  estado: EstadoPromocion;
  /** ends_at de un boost/campaña de post VIGENTE (activo AHORA), o null. */
  activePromotionEndsAt: string | null;
  /** /impulsar/[listingId] o /impulsar-post/[postId]. */
  href: string;
  createdAt: string;
}

const EXCERPT_MAX = 90;

/** Recorta el cuerpo de un post para el título de la fila — nunca un párrafo entero. */
function excerptOf(body: string): string {
  const clean = body.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > EXCERPT_MAX ? `${clean.slice(0, EXCERPT_MAX)}…` : clean;
}

export interface ListingRowInput {
  id: string;
  kind: string;
  title: string;
  status: string;
  photos: string[] | null;
  created_at: string;
}

/** Fila de `listings` (propias, cualquier status) → item de la lista. */
export function toListingImpulsarItem(
  row: ListingRowInput,
  activeBoostEndsAt: string | null,
): ImpulsarItem {
  return {
    id: row.id,
    kind: "listing",
    subKind: row.kind,
    title: row.title,
    thumbnailUrl: firstPhotoUrl(row.photos),
    thumbnailIsVideo: false,
    estado: estadoDePromocion(row.status, activeBoostEndsAt !== null),
    activePromotionEndsAt: activeBoostEndsAt,
    href: `/impulsar/${row.id}`,
    createdAt: row.created_at,
  };
}

export interface PostRowInput {
  id: string;
  kind: string;
  body: string;
  media: string[] | null;
  status: string;
  created_at: string;
}

const NO_BODY_FALLBACK = "Publicación sin texto";

/** Fila de `posts` (propios, cualquier status) → item de la lista. */
export function toPostImpulsarItem(
  row: PostRowInput,
  activePromoEndsAt: string | null,
): ImpulsarItem {
  const media = (row.media ?? []).filter(
    (path) => typeof path === "string" && path.trim().length > 0,
  );
  const first = media[0];

  return {
    id: row.id,
    kind: "post",
    subKind: row.kind,
    title: excerptOf(row.body) || NO_BODY_FALLBACK,
    thumbnailUrl: first ? postMediaUrl(first) : null,
    thumbnailIsVideo: first ? mediaKindOf(first) === "video" : false,
    estado: estadoDePromocion(row.status, activePromoEndsAt !== null),
    activePromotionEndsAt: activePromoEndsAt,
    href: `/impulsar-post/${row.id}`,
    createdAt: row.created_at,
  };
}
