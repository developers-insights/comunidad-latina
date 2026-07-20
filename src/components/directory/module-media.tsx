import type { Icon } from "@phosphor-icons/react";
import { CardMedia, type CardMediaProps } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ACCENT_ICON_CLASS, ACCENT_MEDIA_BG, type ModuleAccent } from "./accent";

const ASPECT_CLASS = {
  video: "aspect-video",
  square: "aspect-square",
  portrait: "aspect-[4/5]",
} as const;

type Aspect = keyof typeof ASPECT_CLASS;

export interface ModuleFallbackBoxProps {
  accent: ModuleAccent;
  icon: Icon;
  aspect?: Aspect;
  className?: string;
}

/**
 * Fallback de foto SOLO cuando el listing no tiene fotos todavía (§ feedback
 * cliente 2026-07-19): gradiente del acento del módulo + ícono grande — un
 * COMPONENTE, nunca un asset binario nuevo. Misma caja (aspect + overflow)
 * que <CardMedia> para que ambas ramas de <DirectoryMedia> midan igual.
 */
export function ModuleFallbackBox({ accent, icon: IconCmp, aspect = "video", className }: ModuleFallbackBoxProps) {
  return (
    <div
      className={cn(
        "relative flex w-full items-center justify-center overflow-hidden",
        ASPECT_CLASS[aspect],
        ACCENT_MEDIA_BG[accent],
        className,
      )}
    >
      <IconCmp size={64} weight="light" aria-hidden="true" className={cn("opacity-45", ACCENT_ICON_CLASS[accent])} />
    </div>
  );
}

export interface DirectoryMediaProps
  extends Omit<CardMediaProps, "fallbackSrc" | "src" | "overlayBottom"> {
  /** URL ya resuelta (listingPhotoUrl/firstPhotoUrl) o null/vacío si no hay foto. */
  src: string | null | undefined;
  accent: ModuleAccent;
  /** Ícono del fallback cuando no hay foto. */
  icon: Icon;
}

/**
 * Foto hero de card de directorio (§ feedback cliente 2026-07-19: "todos los
 * módulos con la foto grande de propiedades"). <CardMedia> real cuando el
 * listing tiene foto; gradiente + ícono del módulo cuando no — nunca la card
 * se ve pobre por falta de foto de seed.
 */
export function DirectoryMedia({
  src,
  accent,
  icon: IconCmp,
  aspect = "video",
  className,
  sizes,
  alt,
  overlayTopLeft,
  overlayTopRight,
}: DirectoryMediaProps) {
  const hasPhoto = Boolean(src && src.trim().length > 0);

  if (hasPhoto) {
    return (
      <CardMedia
        src={src as string}
        fallbackSrc={src as string}
        aspect={aspect}
        className={className}
        sizes={sizes}
        alt={alt}
        overlayTopLeft={overlayTopLeft}
        overlayTopRight={overlayTopRight}
      />
    );
  }

  return (
    <div
      className={cn(
        "relative flex w-full items-center justify-center overflow-hidden",
        ASPECT_CLASS[aspect],
        ACCENT_MEDIA_BG[accent],
        className,
      )}
    >
      <IconCmp
        size={64}
        weight="light"
        aria-hidden="true"
        className={cn("opacity-45", ACCENT_ICON_CLASS[accent])}
      />
      {overlayTopLeft && (
        <div className="absolute left-2.5 top-2.5 flex max-w-[70%] flex-wrap gap-1.5">{overlayTopLeft}</div>
      )}
      {overlayTopRight && (
        <div className="absolute right-2.5 top-2.5 flex max-w-[50%] flex-wrap justify-end gap-1.5">
          {overlayTopRight}
        </div>
      )}
    </div>
  );
}
