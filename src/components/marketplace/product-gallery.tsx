"use client";

import { useState } from "react";
import Image from "next/image";
import { AnimatePresence, m } from "motion/react";
import { isOptimizableSrc } from "@/components/listings";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

/** Sin fotos: misma composición de marca que la card y la cabecera de tienda. */
const FALLBACK_PHOTO = "/images/og-default.png";

export interface ProductGalleryProps {
  /** URLs públicas ya resueltas. Vacío → imagen de respaldo. */
  photos: string[];
  title: string;
  className?: string;
}

/**
 * Foto hero + tira de miniaturas (hasta 4 fotos por producto). Más simple que
 * el carrusel swipe de ListingGallery a propósito: acá el máximo es 4 fotos,
 * así que tocar una miniatura alcanza — con crossfade sutil (LazyMotion
 * strict, `m.*` nunca `motion.*`).
 */
export function ProductGallery({ photos, title, className }: ProductGalleryProps) {
  const items = photos.length > 0 ? photos : [FALLBACK_PHOTO];
  const total = items.length;
  const [active, setActive] = useState(0);
  const current = items[Math.min(active, total - 1)] ?? items[0];

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        role="group"
        aria-roledescription="galería"
        aria-label={COPY.detail.galleryLabel}
        className="relative aspect-square w-full overflow-hidden rounded-lg bg-surface-subtle"
      >
        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={current}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0"
          >
            {isOptimizableSrc(current) ? (
              <Image
                src={current}
                alt={title}
                fill
                sizes="(max-width: 512px) 100vw, 512px"
                className="object-cover"
                priority={active === 0}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- URL externa de seed/API: host fuera del allowlist de next/image
              <img src={current} alt={title} className="absolute inset-0 size-full object-cover" />
            )}
          </m.div>
        </AnimatePresence>

        {total > 1 && (
          <span
            aria-live="polite"
            className="cl-print-fill numeric absolute bottom-3 right-3 rounded-full bg-media-scrim px-2.5 py-1 text-xs font-semibold text-on-media backdrop-blur-sm"
          >
            {COPY.detail.photoCounter(active + 1, total)}
          </span>
        )}
      </div>

      {total > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none]">
          {items.map((src, index) => (
            <button
              key={src + index}
              type="button"
              aria-label={COPY.detail.photoCounter(index + 1, total)}
              aria-current={index === active}
              onClick={() => setActive(index)}
              className={cn(
                "relative size-16 shrink-0 overflow-hidden rounded-md border-2 transition-colors duration-(--duration-fast)",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                index === active ? "border-brand" : "border-transparent opacity-80 hover:opacity-100",
              )}
            >
              {isOptimizableSrc(src) ? (
                <Image src={src} alt="" fill sizes="64px" className="object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- URL externa de seed/API: host fuera del allowlist de next/image
                <img src={src} alt="" className="absolute inset-0 size-full object-cover" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
