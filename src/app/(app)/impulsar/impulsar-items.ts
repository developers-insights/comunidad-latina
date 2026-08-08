import { mediaKindOf, postMediaUrl } from "@/components/feed/helpers";
import { firstPhotoUrl } from "@/components/listings";

/**
 * Modelo PURO de una fila de /impulsar (índice "Promocioná lo tuyo").
 *
 * Sin imports de servidor a propósito — mismo criterio que perfil/post-tiles.ts:
 * la RSC de page.tsx hace las queries y le pasa filas crudas a estas funciones,
 * que son las que se testean en entorno node (sin jsdom, sin mock de Supabase).
 */

export type ImpulsarItemKind = "listing" | "post";

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
  /** status !== 'published': la página de destino explica por qué todavía no se puede promocionar. */
  isPublished: boolean;
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
    isPublished: row.status === "published",
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
    isPublished: row.status === "published",
    activePromotionEndsAt: activePromoEndsAt,
    href: `/impulsar-post/${row.id}`,
    createdAt: row.created_at,
  };
}
