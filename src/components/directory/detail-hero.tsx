import type { Icon } from "@phosphor-icons/react";
import { ListingGallery } from "@/components/listings";
import { cn } from "@/lib/utils";
import { ACCENT_ICON_CLASS, ACCENT_MEDIA_BG, type ModuleAccent } from "./accent";

export interface DirectoryDetailHeroProps {
  /** URLs públicas ya resueltas (listingPhotoUrl). Vacío → fallback del módulo. */
  photos: string[];
  title: string;
  accent: ModuleAccent;
  icon: Icon;
  className?: string;
}

/**
 * Hero del detalle (§ feedback cliente 2026-07-19: "la foto grande de
 * propiedades"). Con fotos reales reusa <ListingGallery> tal cual (swipe +
 * contador) — su propio fallback interno (FALLBACK_PHOTO, una casa) nunca se
 * activa porque solo se monta cuando `photos.length > 0`. Sin fotos, cae al
 * mismo gradiente + ícono del módulo que usan las cards de lista.
 */
export function DirectoryDetailHero({ photos, title, accent, icon: IconCmp, className }: DirectoryDetailHeroProps) {
  if (photos.length > 0) {
    return <ListingGallery photos={photos} title={title} className={className} />;
  }

  return (
    <div
      className={cn(
        "relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg",
        ACCENT_MEDIA_BG[accent],
        className,
      )}
    >
      <IconCmp size={72} weight="light" aria-hidden="true" className={cn("opacity-45", ACCENT_ICON_CLASS[accent])} />
    </div>
  );
}
