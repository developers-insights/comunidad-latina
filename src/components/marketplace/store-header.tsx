import { MapPin } from "@phosphor-icons/react/dist/ssr";
import { CardMedia } from "@/components/ui";
import { FollowButton } from "@/components/social/follow-button";
import { COPY } from "./copy";
import { followerCountLabel } from "./helpers";

/** Sin foto propia: misma composición de marca que usa la card de producto. */
const FALLBACK_PHOTO = "/images/og-default.png";

export interface StoreHeaderModel {
  id: string;
  name: string;
  areaLabel: string | null;
  photoUrl: string | null;
  followerCount: number;
  /** Resuelto en el server — null cuando no hay sesión (FollowButton invita a entrar). */
  initialFollowing: boolean;
}

/**
 * Cabecera de /marketplace/tienda/[storeId]: foto grande del negocio (misma
 * estética que Propiedades) + nombre + zona + Seguir tienda con contador.
 */
export function StoreHeader({ store }: { store: StoreHeaderModel }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-xl">
        <CardMedia src={store.photoUrl} fallbackSrc={FALLBACK_PHOTO} aspect="video" />
      </div>

      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {store.name}
        </h1>
        {store.areaLabel && (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-foreground-secondary">
            <MapPin size={16} aria-hidden="true" className="shrink-0" />
            {store.areaLabel}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <FollowButton
          targetKind="listing"
          targetId={store.id}
          initialFollowing={store.initialFollowing}
          labelFollow={COPY.store.followStore}
          labelFollowing={COPY.store.followingStore}
          size="md"
        />
        <span className="numeric text-sm text-foreground-secondary">
          {followerCountLabel(store.followerCount)}
        </span>
      </div>
    </div>
  );
}
