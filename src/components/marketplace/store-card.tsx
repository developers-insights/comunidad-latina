import Link from "next/link";
import { ArrowRight, MapPin } from "@phosphor-icons/react/dist/ssr";
import { Avatar, BezelCard, buttonVariants } from "@/components/ui";
import { FollowButton } from "@/components/social/follow-button";
import { PublisherTrust, type PublisherTrustProps } from "@/components/listings";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import { followerCountLabel } from "./helpers";

export interface StoreCardModel {
  id: string;
  name: string;
  areaLabel: string | null;
  photoUrl: string | null;
  followerCount: number;
  initialFollowing: boolean;
  /** Trust Score del dueño de la tienda — null si el negocio no tiene cuenta. */
  trust: Omit<PublisherTrustProps, "size" | "className"> | null;
}

/**
 * Card compacta "Vendido por" del detalle de producto (§ patrón publisherCard
 * de propiedades/[id]): foto + nombre + zona + trust del dueño, Seguir tienda
 * con contador, y salida a la vidriera completa.
 */
export function StoreCard({ store }: { store: StoreCardModel }) {
  return (
    <BezelCard coreClassName="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <Avatar src={store.photoUrl} name={store.name} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-base font-bold text-foreground">
            {store.name}
          </p>
          {store.areaLabel && (
            <p className="flex items-center gap-1 text-xs text-foreground-muted">
              <MapPin size={13} aria-hidden="true" className="shrink-0" />
              {store.areaLabel}
            </p>
          )}
          {store.trust && <PublisherTrust {...store.trust} size="inline" className="mt-1" />}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <FollowButton
          targetKind="listing"
          targetId={store.id}
          initialFollowing={store.initialFollowing}
          labelFollow={COPY.store.followStore}
          labelFollowing={COPY.store.followingStore}
        />
        <span className="text-sm text-foreground-secondary">
          {followerCountLabel(store.followerCount)}
        </span>
      </div>

      <Link
        href={`/marketplace/tienda/${store.id}`}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}
      >
        {COPY.detail.visitStore}
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </BezelCard>
  );
}
