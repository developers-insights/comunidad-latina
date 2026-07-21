import Image from "next/image";
import { cn } from "@/lib/utils";

export interface CardMediaProps {
  /** URL absoluta (seed/API), path local ("/images/…") o URL pública de Storage. */
  src: string | null | undefined;
  /** Fallback local si src viene vacío (cada módulo trae el suyo). */
  fallbackSrc: string;
  /** Decorativa por default (alt="") — pasar alt solo si la foto ES el contenido. */
  alt?: string;
  /** 16:9 default (la estética de Propiedades que pidió el cliente). */
  aspect?: "video" | "square" | "portrait";
  sizes?: string;
  /** Allowlist en next.config.ts: [62, 75]. 62 en tarjetas chicas (§perf). */
  quality?: number;
  className?: string;
  /** Chips flotantes sobre la foto (ej. "Publicidad", precio, categoría). */
  overlayTopLeft?: React.ReactNode;
  overlayTopRight?: React.ReactNode;
  /** Franja inferior sobre scrim (legible por bg-media-scrim + text-on-media). */
  overlayBottom?: React.ReactNode;
}

const ASPECT: Record<NonNullable<CardMediaProps["aspect"]>, string> = {
  video: "aspect-video",
  square: "aspect-square",
  portrait: "aspect-[4/5]",
};

/**
 * Foto hero de card (§ feedback cliente 2026-07-19: "todos los módulos con la
 * misma estética de propiedades, con la foto grande"). Encapsula la decisión
 * next/image vs <img> de listing-card: solo assets locales o del Storage de
 * Supabase pasan por next/image; URLs externas de seed/API van en <img> para
 * no romper con hosts fuera del allowlist.
 *
 * Va SIEMPRE dentro de un BezelCard con coreClassName="overflow-hidden p-0"
 * (o contenedor con overflow-hidden) — el radio lo pone el contenedor.
 */
export function CardMedia({
  src,
  fallbackSrc,
  alt = "",
  aspect = "video",
  sizes = "(max-width: 512px) 100vw, 512px",
  quality,
  className,
  overlayTopLeft,
  overlayTopRight,
  overlayBottom,
}: CardMediaProps) {
  const photo = src && src.trim().length > 0 ? src : fallbackSrc;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const optimizable =
    photo.startsWith("/") || (base.length > 0 && photo.startsWith(`${base}/`));

  return (
    <div className={cn("relative w-full bg-surface-subtle", ASPECT[aspect], className)}>
      {optimizable ? (
        <Image
          src={photo}
          alt={alt}
          fill
          sizes={sizes}
          quality={quality}
          className="object-cover"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- URL externa de seed/API: host fuera del allowlist de next/image
        <img
          src={photo}
          alt={alt}
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
        />
      )}

      {overlayTopLeft && (
        <div className="absolute left-2.5 top-2.5 flex max-w-[70%] flex-wrap gap-1.5">
          {overlayTopLeft}
        </div>
      )}
      {overlayTopRight && (
        <div className="absolute right-2.5 top-2.5 flex max-w-[50%] flex-wrap justify-end gap-1.5">
          {overlayTopRight}
        </div>
      )}
      {overlayBottom && (
        <div className="absolute inset-x-0 bottom-0 bg-media-scrim px-3.5 py-2.5 text-on-media">
          {overlayBottom}
        </div>
      )}
    </div>
  );
}
