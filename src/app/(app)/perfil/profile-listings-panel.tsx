import { Megaphone } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import { ListingCard } from "@/components/listings";
import { FeedListingCard } from "@/components/feed";
import type { ProfileListingItem } from "./profile-listings";

/**
 * Pestaña "Avisos" del perfil.
 *
 * Reusa las MISMAS tarjetas que ya pinta el feed —`ListingCard` para vivienda,
 * `FeedListingCard` para el resto— en vez de inventar una tercera versión: ver
 * el docblock de `profile-listings.ts` para el porqué completo.
 */

const COPY = {
  emptyTitle: "Todavía no hay avisos",
  emptyOwn:
    "Cuando publiques un evento, un empleo, una propiedad o cualquier otro aviso, va a aparecer acá.",
  emptyOther: "Cuando publique un aviso, va a aparecer acá.",
} as const;

export interface ProfileListingsPanelProps {
  items: readonly ProfileListingItem[];
  isOwn: boolean;
}

export function ProfileListingsPanel({ items, isOwn }: ProfileListingsPanelProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Megaphone />}
        title={COPY.emptyTitle}
        message={isOwn ? COPY.emptyOwn : COPY.emptyOther}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {items.map((item) =>
        item.kind === "property" ? (
          <ListingCard key={item.listing.id} listing={item.listing} />
        ) : (
          <FeedListingCard key={item.listing.id} listing={item.listing} />
        ),
      )}
    </div>
  );
}
