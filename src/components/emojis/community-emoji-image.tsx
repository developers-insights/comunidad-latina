import { cn } from "@/lib/utils";
import { EMOJI_ASSET_SIDE_PX, type CommunityEmoji } from "@/lib/emojis/catalog";

/**
 * UN EMOJI DE LA COMUNIDAD, PINTADO.
 *
 * Es un `<img>` pelado y no `next/image`, y las dos razones son concretas:
 *
 *  1. `next/image` exige declarar el host remoto en `remotePatterns`
 *     (next.config.ts). El bucket de Supabase ya sirve estos archivos ya
 *     optimizados —PNG de 512 px, 20-80 KB— así que el optimizador no tendría
 *     nada que hacer salvo agregar un salto por el servidor de Next.
 *  2. El MISMO archivo lo tiene que cargar el horneado en canvas
 *     (`sticker-image.ts`) con `crossOrigin`. Que el picker y el canvas pidan
 *     la misma URL es lo que hace que la segunda carga salga de la caché del
 *     navegador en vez de la red.
 *
 * ─── CERO SALTO DE LAYOUT ───────────────────────────────────────────────────
 * El contenedor fija la caja (`aspect-square` + tamaño del padre) y la imagen
 * la llena en absoluto. La celda mide lo mismo antes y después de que la
 * imagen llegue: con 60 dibujos entrando de a poco, sin esto la grilla saltaría
 * en cada uno. `width`/`height` van igual, por si alguien lo monta suelto.
 *
 * `loading="lazy"` es lo que evita que abrir el picker pida las 60 imágenes:
 * junto con las pestañas (que sólo montan la categoría activa) el navegador
 * baja las de una categoría, y de ésas, las que se ven.
 */
export function CommunityEmojiImage({
  emoji,
  className,
  style,
  decorative = false,
  eager = false,
}: {
  emoji: CommunityEmoji;
  className?: string;
  /** Medida fija cuando el emoji va dentro de un texto (ver `CommunityEmojiText`). */
  style?: React.CSSProperties;
  /**
   * `true` cuando el nombre accesible ya lo pone quien envuelve (el botón del
   * picker dice "Agregar KLK: …"). Repetir el alt adentro haría que un lector
   * de pantalla lea la descripción dos veces.
   */
  decorative?: boolean;
  /** Sólo para el emoji ya elegido, que se ve sí o sí. */
  eager?: boolean;
}) {
  return (
    <span style={style} className={cn("relative block aspect-square", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- ver la cabecera */}
      <img
        src={emoji.url}
        alt={decorative ? "" : emoji.alt}
        aria-hidden={decorative ? "true" : undefined}
        width={EMOJI_ASSET_SIDE_PX}
        height={EMOJI_ASSET_SIDE_PX}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        draggable={false}
        className="absolute inset-0 size-full select-none object-contain"
      />
    </span>
  );
}
