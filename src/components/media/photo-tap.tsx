"use client";

// Import DIRECTO al módulo del visor, no al barril de @/components/feed: ese
// barril reexporta feed-listing-card, que a su vez importa de @/components/listings
// — pasar por él armaría un ciclo. Mismo criterio que listings/listing-card.tsx.
import { useMediaViewer } from "@/components/feed/media-viewer";
import { cn } from "@/lib/utils";

/**
 * LA FOTO ES LA FOTO (feedback cliente 2026-07-26: en Vivienda "quedó perfecto",
 * en el resto "tocar la foto te saca de la pantalla").
 *
 * Un solo gesto, una sola regla, en TODAS las cards de la app:
 *  - tocar la FOTO abre el visor a pantalla completa con todas las fotos del
 *    aviso (swipe, contador, arrastrar para cerrar) — nunca navega;
 *  - al DETALLE se va con el botón/píldora de la card, y sólo con eso.
 *
 * Este componente es la isla de cliente que hace tocable la foto SIN convertir
 * a la card entera en client component: las cards siguen siendo server y le
 * pasan su media como `children`.
 *
 * Sin fotos reales NO se envuelve nada: el fallback (gradiente + ícono del
 * módulo) no es una foto, así que no hay visor que abrir y no queremos un
 * control que no hace nada. El botón de la card sigue estando para el detalle.
 */

/** Mismo tacto que la foto de <ListingCard>: hundido sutil + foco visible. */
export const PHOTO_TAP_CLASS =
  "group block w-full text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.99]";

export interface PhotoTapProps {
  /** Fotos YA resueltas a URL pública, en orden. Vacío → no se envuelve. */
  photos: string[];
  /** aria-label del área tocable — "Ver fotos de {título}". */
  label: string;
  /** Encabezado del visor (título del aviso / nombre de quien publica). */
  authorName?: string;
  children: React.ReactNode;
  className?: string;
}

export function PhotoTap({ photos, label, authorName, children, className }: PhotoTapProps) {
  const viewer = useMediaViewer();
  const urls = photos.filter((url) => url && url.trim().length > 0);

  if (urls.length === 0) return <>{children}</>;

  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event) => {
        // Si algún día la card vuelve a tener un contenedor navegable, el tap en
        // la foto no puede escaparse hacia él.
        event.stopPropagation();
        viewer.open({
          items: urls.map((url) => ({ kind: "image" as const, url })),
          authorName,
        });
      }}
      className={cn(PHOTO_TAP_CLASS, className)}
    >
      {children}
    </button>
  );
}
