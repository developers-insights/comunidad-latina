import Link from "next/link";
import { ArrowRight, MapPin, Storefront } from "@phosphor-icons/react/dist/ssr";
import { Avatar, BezelCard, buttonVariants } from "@/components/ui";
import { FollowButton } from "@/components/social/follow-button";
import { PublisherTrust, type PublisherTrustProps } from "@/components/listings";
import { PhotoTap } from "@/components/media/photo-tap";
// Import DIRECTO al módulo, y no al barril `@/components/resenas`: ese barril
// reexporta `fetchResenasDeAviso` desde `./queries`, que abre con
// `import "server-only"`. Esta tarjeta la reexporta el barril de marketplace,
// que a su vez importa el formulario de publicar (`"use client"`) — así que
// pasar por el barril arrastraba `server-only` al bundle del cliente y el build
// de producción se caía entero. Ningún test lo veía: es un error de grafo de
// webpack, no de tipos ni de runtime en jsdom.
import { Estrellas } from "@/components/resenas/estrellas";
import { RESENAS_COPY, formatearPromedio, type ResumenPuntaje } from "@/lib/resenas";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import { followerCountLabel } from "./helpers";
import { PresenciaVerificadaBadge, SellerIdentityBadge } from "./seller-chip";

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
  /**
   * `undefined` = no se pidió (el directorio de Tiendas NO lo trae: contar
   * seguidores de N tiendas de una sola vez pediría traer TODAS las filas de
   * `follows` de esas tiendas —sin cota, a diferencia del conteo de artículos
   * activos— o una consulta por tienda, que es el N+1 que la spec pidió
   * evitar). El botón Seguir funciona igual sin el número: sólo necesita
   * `initialFollowing`, que sí se resuelve en lote y acotado por página.
   */
  followerCount?: number;
  initialFollowing: boolean;
  /**
   * Trust Score del dueño de la tienda — null si el negocio no tiene cuenta.
   *
   * `profileId` va REQUERIDO (en `PublisherTrustProps` es opcional): acá los
   * props se pasan con spread, así que un olvido no se vería en el JSX y la
   * hoja del Trust Score se abriría sin "Ver perfil". Exigirlo en el tipo hace
   * que lo agarre `tsc` en vez de nadie. Sin dueño con cuenta, `null` explícito.
   */
  trust: (Omit<PublisherTrustProps, "size" | "className"> & {
    profileId: string | null;
  }) | null;
  /** business_accounts.verified_presence (plan "Presencia Verificada") — PAGO. */
  verified?: boolean;
  /** profiles.identity_verified de quien administra la tienda — GRATIS. Ver seller-chip.tsx. */
  identityVerified?: boolean;
  /** attrs.category de la tienda, ya traducida a etiqueta legible. */
  categoryLabel?: string | null;
  /**
   * Resumen de listing_review_stats (0093). `undefined` = no se pidió para
   * este uso (p.ej. la card "Vendido por" del detalle de producto, que no
   * repite acá lo que ya muestra la vidriera completa) — en ese caso la fila
   * de calificación no se renderiza. `{promedio: null, cantidad: 0}` SÍ se
   * renderiza, como "Sin reseñas todavía".
   */
  rating?: ResumenPuntaje;
  /**
   * Conteo agregado de productos activos (kind='product', status='published')
   * de esta tienda — mismo criterio de "undefined = no se pidió".
   */
  activeListingCount?: number;
}

/**
 * Card compacta de tienda. Dos usos:
 *  1) "Vendido por" del detalle de producto (§ patrón publisherCard de
 *     propiedades/[id]): foto + nombre + zona + trust del dueño.
 *  2) El directorio de la pestaña Tiendas (marketplace/(lista)/page.tsx), que
 *     además pide categoría, calificaciones y cantidad de artículos activos —
 *     de ahí que esos tres campos sean opcionales: el mismo componente sirve
 *     para la versión liviana y la completa sin duplicar el layout.
 *
 * Mismo reparto de gestos que el resto de las cards (feedback 2026-07-26):
 * tocar la FOTO de la tienda la abre en el visor; a la vidriera se entra con
 * "Ver tienda". Sin foto, el avatar cae a sus iniciales y no es tocable.
 */
export function StoreCard({ store }: { store: StoreCardModel }) {
  const photos = store.photos?.length ? store.photos : store.photoUrl ? [store.photoUrl] : [];
  const promedio = store.rating ? formatearPromedio(store.rating.promedio) : null;

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
            {store.identityVerified && <SellerIdentityBadge />}
            {store.verified && <PresenciaVerificadaBadge />}
          </div>

          {/* Categoría · ciudad en una sola línea (mismo patrón de "join con
              medio punto" que ya usa el perfil para país/ciudad/zona). */}
          {(store.categoryLabel || store.areaLabel) && (
            <p className="flex items-center gap-1 text-xs text-foreground-muted">
              {store.areaLabel && <MapPin size={13} aria-hidden="true" className="shrink-0" />}
              {[store.categoryLabel, store.areaLabel].filter(Boolean).join(" · ")}
            </p>
          )}

          {store.rating && (
            <div className="mt-0.5 flex items-center gap-1.5">
              {promedio ? (
                <>
                  <Estrellas
                    valor={store.rating.promedio}
                    size={13}
                    etiqueta={RESENAS_COPY.promedioAria(promedio, store.rating.cantidad)}
                  />
                  <span className="numeric text-xs font-semibold text-foreground-secondary">
                    {promedio}
                  </span>
                  <span className="text-xs text-foreground-muted">
                    ({RESENAS_COPY.cantidad(store.rating.cantidad)})
                  </span>
                </>
              ) : (
                <span className="text-xs text-foreground-muted">{RESENAS_COPY.sinPuntaje}</span>
              )}
            </div>
          )}

          {store.trust && <PublisherTrust {...store.trust} size="inline" className="mt-1" />}
        </div>
      </div>

      {typeof store.activeListingCount === "number" && (
        <p className="flex items-center gap-1.5 text-xs text-foreground-secondary">
          <Storefront size={14} aria-hidden="true" className="shrink-0 text-foreground-muted" />
          {COPY.store.activeListingCount(store.activeListingCount)}
        </p>
      )}

      <div className="flex items-center gap-3">
        <FollowButton
          targetKind="listing"
          targetId={store.id}
          initialFollowing={store.initialFollowing}
          labelFollow={COPY.store.followStore}
          labelFollowing={COPY.store.followingStore}
        />
        {typeof store.followerCount === "number" && (
          <span className="text-sm text-foreground-secondary">
            {followerCountLabel(store.followerCount)}
          </span>
        )}
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
