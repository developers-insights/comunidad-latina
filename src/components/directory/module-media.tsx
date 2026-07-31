import type { Icon } from "@phosphor-icons/react";
import {
  CARD_MEDIA_ASPECT,
  CardMedia,
  LISTING_CARD_ASPECT,
  MediaScrimBottom,
  type CardMediaAspect,
  type CardMediaProps,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { ACCENT_ICON_CLASS, ACCENT_MEDIA_BG, type ModuleAccent } from "./accent";

/**
 * La tabla de proporciones se IMPORTA del primitivo (`ui/card-media.tsx`); acá
 * había una copia textual. Mantener dos tablas iguales era el mecanismo exacto
 * por el que las tarjetas de Negocios podían quedar con otra proporción que las
 * del resto sin que ningún cambio pareciera tener la culpa.
 */
const ASPECT_CLASS = CARD_MEDIA_ASPECT;

type Aspect = CardMediaAspect;

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
export function ModuleFallbackBox({
  accent,
  icon: IconCmp,
  aspect = LISTING_CARD_ASPECT,
  className,
}: ModuleFallbackBoxProps) {
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

export interface DirectoryMediaProps extends Omit<CardMediaProps, "fallbackSrc" | "src"> {
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
 *
 * ── EL DEFAULT PASÓ DE 16:9 A 4:5 (2026-07-30) ───────────────────────────────
 * Este default era `video`, y era la razón concreta de que las tarjetas de
 * Negocios se vieran "más chicas que las de propiedades" (call 29/7, 1:05):
 * `business-card.tsx` no pasa `aspect`, así que heredaba 16:9 mientras
 * Propiedades, Marketplace, Creadores, Colaboraciones y Empleos dibujaban 4:5.
 * A igual ancho, 16:9 es ~44% más bajo — no era una impresión, era la caja.
 *
 * Se corrige ACÁ y no en `business-card.tsx` a propósito: esa tarjeta es de
 * otro agente, y además arreglarla sola habría dejado el mismo agujero abierto
 * para la próxima que naciera sin pasar `aspect`. El default ahora ES la
 * decisión de producto.
 *
 * Quien de verdad necesite 16:9 lo sigue pidiendo explícitamente — el prop no
 * desapareció.
 */
export function DirectoryMedia({
  src,
  accent,
  icon: IconCmp,
  aspect = LISTING_CARD_ASPECT,
  className,
  sizes,
  alt,
  overlayTopLeft,
  overlayTopRight,
  overlayBottom,
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
        overlayBottom={overlayBottom}
      />
    );
  }

  // Sin foto: gradiente + ícono del módulo. La franja de vidrio (título/meta) va
  // por <MediaScrimBottom> — misma que sobre una foto real, para que la card no
  // cambie de gramática cuando falta la foto de seed.
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
      {overlayBottom && <MediaScrimBottom>{overlayBottom}</MediaScrimBottom>}
    </div>
  );
}
