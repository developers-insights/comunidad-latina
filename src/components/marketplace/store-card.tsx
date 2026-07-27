import Link from "next/link";
import { ArrowRight, MapPin } from "@phosphor-icons/react/dist/ssr";
import { Avatar, BezelCard, buttonVariants } from "@/components/ui";
import { FollowButton } from "@/components/social/follow-button";
import { PublisherTrust, type PublisherTrustProps } from "@/components/listings";
import { PhotoTap } from "@/components/media/photo-tap";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import { followerCountLabel } from "./helpers";
import { SellerVerifiedBadge } from "./seller-chip";

export interface StoreCardModel {
  id: string;
  name: string;
  areaLabel: string | null;
  photoUrl: string | null;
  /**
   * TODAS las fotos de la tienda ya resueltas (allPhotoUrls) — tocar la foto
   * las abre en el visor. Opcional: sin ella cae a `photoUrl`.
   */
  photos?: string[];
  followerCount: number;
  initialFollowing: boolean;
  /** Trust Score del dueño de la tienda — null si el negocio no tiene cuenta. */
  trust: Omit<PublisherTrustProps, "size" | "className"> | null;
  /** business_accounts.verified_presence (plan "Presencia Verificada"). */
  verified?: boolean;
}

/**
 * Card compacta "Vendido por" del detalle de producto (§ patrón publisherCard
 * de propiedades/[id]): foto + nombre + zona + trust del dueño, Seguir tienda
 * con contador, y salida a la vidriera completa.
 *
 * Mismo reparto de gestos que el resto de las cards (feedback 2026-07-26):
 * tocar la FOTO de la tienda la abre en el visor; a la vidriera se entra con
 * "Ver tienda". Sin foto, el avatar cae a sus iniciales y no es tocable.
 */
export function StoreCard({ store }: { store: StoreCardModel }) {
  const photos = store.photos?.length ? store.photos : store.photoUrl ? [store.photoUrl] : [];

  return (
    <BezelCard coreClassName="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <PhotoTap
          photos={photos}
          label={COPY.store.openPhotos(store.name)}
          authorName={store.name}
          // El avatar es redondo y NO ocupa el ancho: el botón se ajusta a él.
          className="w-auto shrink-0 rounded-full"
        >
          <Avatar src={store.photoUrl} name={store.name} size="lg" />
        </PhotoTap>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className="min-w-0 truncate font-display text-base font-bold text-foreground">
              {store.name}
            </p>
            {store.verified && <SellerVerifiedBadge />}
          </div>
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
