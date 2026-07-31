import Image from "next/image";
import { cn } from "@/lib/utils";

export interface CardMediaProps {
  /** URL absoluta (seed/API), path local ("/images/…") o URL pública de Storage. */
  src: string | null | undefined;
  /** Fallback local si src viene vacío (cada módulo trae el suyo). */
  fallbackSrc: string;
  /** Decorativa por default (alt="") — pasar alt solo si la foto ES el contenido. */
  alt?: string;
  /**
   * Proporción del recuadro de media.
   *
   * El default sigue siendo `video` (16:9) por retrocompatibilidad, pero la
   * proporción de TARJETA de la app es `portrait` (4:5): el cliente pidió el
   * 2026-07-30 que "todas las tarjetas de todos tengan el mismo tamaño", y
   * quien decidía era este prop. Ver `CARD_MEDIA_ASPECT`.
   */
  aspect?: "video" | "square" | "portrait";
  sizes?: string;
  /** Allowlist en next.config.ts: [62, 75]. 62 en tarjetas chicas (§perf). */
  quality?: number;
  className?: string;
  /** Chips flotantes sobre la foto (ej. "Publicidad", precio, categoría). */
  overlayTopLeft?: React.ReactNode;
  overlayTopRight?: React.ReactNode;
  /** Franja inferior de VIDRIO (título/precio/zona). Ver <MediaScrimBottom>: la
   *  tinta clara la hereda del contenedor — no re-declarar `text-on-media`. */
  overlayBottom?: React.ReactNode;
}

export type CardMediaAspect = NonNullable<CardMediaProps["aspect"]>;

/**
 * LA ÚNICA TABLA DE PROPORCIONES DE LA APP.
 *
 * Estaba duplicada textualmente en `components/directory/module-media.tsx`
 * (`ASPECT_CLASS`), que es la que usan las tarjetas de Negocios y Empleos. Dos
 * copias de la misma tabla no se ven distintas hasta que alguien toca UNA —
 * y entonces media app cambia de proporción y la otra media no. Se exporta
 * para que ese archivo la importe en vez de re-declararla.
 */
export const CARD_MEDIA_ASPECT: Record<CardMediaAspect, string> = {
  video: "aspect-video",
  square: "aspect-square",
  portrait: "aspect-[4/5]",
};

/**
 * La proporción con la que se dibuja una TARJETA de listado en esta app.
 *
 * Pedido textual del cliente (call 29/7, 1:05): «todas las tarjetas de todos
 * tienen que ser igual, el mismo tamaño». La única excepción son los videos,
 * que conservan su formato vertical propio en /videos.
 *
 * Existe como constante y no como literal repetido para que la próxima tarjeta
 * que alguien escriba herede la decisión en vez de re-elegirla.
 */
export const LISTING_CARD_ASPECT: CardMediaAspect = "portrait";

const ASPECT = CARD_MEDIA_ASPECT;

/**
 * Franja de VIDRIO ("tipo iPhone" — feedback cliente 2026-07-24) para el
 * título/precio/ubicación SOBRE la foto. Reemplaza al scrim plano opaco por un
 * panel esmerilado. Dos capas:
 *  1. Un degradado de legibilidad que sube desde el borde inferior — el vidrio
 *     no corta en seco y da aire por encima del panel.
 *  2. El panel esmerilado: `bg-media-scrim` (0.62 → mismo contraste AA que ya
 *     validó el scrim plano, incluso sobre fotos claras) + `backdrop-blur` para
 *     el frost + hairline superior + brillo interno de vidrio.
 *
 * `text-on-media` define la tinta clara UNA sola vez acá; los hijos HEREDAN el
 * color (no re-declaran `text-on-media`), así el inventario de print-contract no
 * crece por cada card que use la franja. `cl-print-fill` imprime el velo bajo la
 * tinta clara. `pointer-events-none`: el tap atraviesa la franja y cae en el
 * Link que envuelve la media (abrir el detalle — feedback 2026-07-24).
 */
export function MediaScrimBottom({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 cl-print-fill text-on-media">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-[180%] bg-gradient-to-t from-media-shade/70 via-media-shade/20 to-transparent"
      />
      <div className="relative border-t border-on-media/15 bg-media-scrim px-3.5 py-3 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]">
        {children}
      </div>
    </div>
  );
}

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
      {overlayBottom && <MediaScrimBottom>{overlayBottom}</MediaScrimBottom>}
    </div>
  );
}
