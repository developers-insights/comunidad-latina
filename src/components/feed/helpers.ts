import type { TrustLevel, TrustSignal } from "@/components/trust";
import type { ListingCardModel } from "@/components/listings";

/**
 * Helpers puros del módulo FEED SOCIAL. Sin dependencias de servidor:
 * usables desde Server Components y client components por igual.
 * La paginación keyset (encodeCursor/decodeCursor) se reutiliza de
 * "@/components/listings" — mismo contrato created_at|id.
 */

// ---------------------------------------------------------------------------
// Tabs (los 5 feeds del wireframe §4.b) — el estado vive en ?tab= (URL)
// ---------------------------------------------------------------------------

export const FEED_TABS = [
  { id: "para-ti", listingKind: null },
  { id: "propiedades", listingKind: "property" },
  { id: "negocios", listingKind: "business" },
  { id: "profesionales", listingKind: "professional" },
  { id: "eventos", listingKind: "event" },
] as const;

export type FeedTabId = (typeof FEED_TABS)[number]["id"];

export function parseTab(raw: string | undefined): FeedTabId {
  const found = FEED_TABS.find((tab) => tab.id === raw);
  return found?.id ?? "para-ti";
}

// ---------------------------------------------------------------------------
// View models que las cards reciben ya resueltos (server → UI)
// ---------------------------------------------------------------------------

/** Autor de un post/comentario con su Trust Score resuelto en batch. */
export interface AuthorView {
  profileId: string | null;
  displayName: string;
  avatarUrl: string | null;
  score: number;
  level: TrustLevel;
  signals: TrustSignal[];
}

export interface PostCardModel {
  id: string;
  kind: "post" | "question";
  body: string;
  /** URL pública de la primera foto (ya resuelta) o null. */
  photoUrl: string | null;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  timeAgoLabel: string;
  author: AuthorView;
  likedByViewer: boolean;
}

/** Listing NO-property para la card propia del feed (los property usan ListingCard). */
export interface FeedListingModel {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  priceLabel: string | null;
  areaLabel: string | null;
  photoUrl: string | null;
  verifiedDateLabel: string | null;
  publisherName: string | null;
  publisherTrust: {
    displayName: string;
    firstName: string;
    score: number;
    level: TrustLevel;
    signals: TrustSignal[];
  } | null;
}

export interface GuideCardModel {
  slug: string;
  title: string;
  summary: string | null;
  readingMinutes: number | null;
}

/** Item mixto del feed "Para ti", ya ordenado server-side por created_at desc. */
export type FeedItem =
  | { type: "post"; createdAt: string; id: string; post: PostCardModel }
  | { type: "listing-property"; createdAt: string; id: string; listing: ListingCardModel }
  | { type: "listing"; createdAt: string; id: string; listing: FeedListingModel }
  | { type: "guide"; createdAt: string; id: string; guide: GuideCardModel };

export function postKindOf(raw: string): "post" | "question" {
  return raw === "question" ? "question" : "post";
}
