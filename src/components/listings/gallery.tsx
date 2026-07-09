"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import { FALLBACK_PHOTO, isOptimizableSrc } from "./helpers";

export interface ListingGalleryProps {
  /** URLs públicas ya resueltas. Vacío → imagen de respaldo. */
  photos: string[];
  /** alt de la primera foto (las demás son decorativas dentro del carrusel). */
  title: string;
  className?: string;
}

/**
 * Galería 16:9 con swipe horizontal (scroll-snap nativo — el gesto estándar,
 * nunca redefinido) y contador "3/8" (§4.d).
 *
 * Controles y contador flotan sobre la foto: van con los tokens de media
 * (constantes en ambos temas). Una foto no se aclara porque el usuario prendió
 * el tema light — bg-scrim se reserva para backdrops de overlay.
 */
export function ListingGallery({ photos, title, className }: ListingGalleryProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(1);

  const items = photos.length > 0 ? photos : [FALLBACK_PHOTO];
  const total = items.length;

  function handleScroll() {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    const index = Math.round(track.scrollLeft / track.clientWidth);
    setCurrent(Math.min(total, Math.max(1, index + 1)));
  }

  /** Desplaza una foto — habilita navegación por teclado y por botón. */
  function scrollByStep(direction: 1 | -1) {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * track.clientWidth, behavior: "smooth" });
  }

  return (
    <div
      role="group"
      aria-roledescription="carrusel"
      aria-label={COPY.detail.galleryLabel}
      className={cn("relative overflow-hidden rounded-lg bg-surface-subtle", className)}
    >
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className={cn(
          "flex snap-x snap-mandatory overflow-x-auto scroll-smooth",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {items.map((src, index) => (
          <div key={src + index} className="relative aspect-video w-full shrink-0 snap-center">
            {isOptimizableSrc(src) ? (
              <Image
                src={src}
                alt={index === 0 ? title : ""}
                fill
                sizes="(max-width: 512px) 100vw, 512px"
                className="object-cover"
                priority={index === 0}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- URL externa de seed/API: host fuera del allowlist de next/image
              <img
                src={src}
                alt={index === 0 ? title : ""}
                loading={index === 0 ? "eager" : "lazy"}
                className="absolute inset-0 size-full object-cover"
              />
            )}
          </div>
        ))}
      </div>

      {total > 1 && (
        <>
          {/* Controles prev/next: habilitan navegación por teclado (no solo
              swipe/scroll con puntero). ≥44px, con foco visible. */}
          <button
            type="button"
            aria-label={COPY.detail.galleryPrev}
            onClick={() => scrollByStep(-1)}
            disabled={current <= 1}
            className={cn(
              "absolute left-2 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full",
              "bg-media-scrim text-on-media backdrop-blur-sm transition-opacity duration-(--duration-fast)",
              "hover:bg-media-scrim/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              "disabled:pointer-events-none disabled:opacity-0",
            )}
          >
            <CaretLeft size={20} weight="bold" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={COPY.detail.galleryNext}
            onClick={() => scrollByStep(1)}
            disabled={current >= total}
            className={cn(
              "absolute right-2 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full",
              "bg-media-scrim text-on-media backdrop-blur-sm transition-opacity duration-(--duration-fast)",
              "hover:bg-media-scrim/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              "disabled:pointer-events-none disabled:opacity-0",
            )}
          >
            <CaretRight size={20} weight="bold" aria-hidden="true" />
          </button>
          {/* `cl-print-fill`: las flechas son <button> y el @media print se las
              lleva, pero este contador no. `text-on-media` es tinta clara sobre el
              velo `bg-media-scrim`, y un velo es background-color: el navegador no
              lo imprime. Sin el velo el "3 / 7" quedaba casi blanco sobre la foto. */}
          <span
            aria-live="polite"
            className="cl-print-fill numeric absolute bottom-3 right-3 rounded-full bg-media-scrim px-2.5 py-1 text-xs font-semibold text-on-media"
          >
            {COPY.detail.photoCounter(current, total)}
          </span>
        </>
      )}
    </div>
  );
}
