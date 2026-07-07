"use client";

import { useRef, useState } from "react";
import Image from "next/image";
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
        <span
          aria-live="polite"
          className="numeric absolute bottom-3 right-3 rounded-full bg-scrim px-2.5 py-1 text-xs font-semibold text-white"
        >
          {COPY.detail.photoCounter(current, total)}
        </span>
      )}
    </div>
  );
}
