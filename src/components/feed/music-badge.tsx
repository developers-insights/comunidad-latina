import { MusicNotes } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { MUSIC_COPY } from "./music-copy";

/**
 * LA MÚSICA DE UNA PUBLICACIÓN, A LA VISTA (0090).
 *
 * No es decoración: es la única señal de que lo que se escucha no es el sonido
 * del video, y —cuando la licencia lo exige— es una OBLIGACIÓN CONTRACTUAL.
 * Por eso se pinta siempre que haya pista, aunque el sonido esté en silencio.
 *
 * Dos líneas, y sólo cuando hacen falta:
 *  · Siempre: "♪ Título · Artista". Alcanza para CC0 y dominio público, donde
 *    nombrar al autor es cortesía y no requisito.
 *  · Además: la línea EXACTA que pide la licencia, cuando dice algo más que el
 *    título y el artista (CC BY suele exigir la licencia y su versión). Va
 *    visible, debajo, con la misma tinta. Esconderla en un `title` o en un
 *    `aria-label` sería no cumplirla: la atribución tiene que poder LEERSE.
 *
 * `cl-print-fill`: la píldora escribe tinta `on-media`, que es clara por
 * definición. Sin forzar el relleno queda en 1.00:1 sobre papel blanco (ver
 * src/test/print-contract.test.ts). Se imprime con su fondo, igual que la
 * píldora de "Vista previa" del video.
 *
 * Es un Server Component (sin "use client"): no tiene estado, y así puede
 * montarse dentro de la card sin arrastrar JavaScript por una etiqueta.
 */

export interface MusicBadgeProps {
  title: string;
  artist: string;
  /**
   * La línea exacta que exige la licencia, si exige alguna. Sale de
   * `attributionLine()` (lib/media/audio-track.ts) — NO se arma acá: quién debe
   * crédito lo decide la licencia, no un componente de presentación.
   */
  attribution?: string | null;
  className?: string;
}

export function MusicBadge({ title, artist, attribution = null, className }: MusicBadgeProps) {
  const visible = `${title}${MUSIC_COPY.badgeSeparator}${artist}`;
  /**
   * La segunda línea aparece sólo si dice algo que la primera no. Repetir
   * "Cumbia del barrio — Los del Sur" debajo de "Cumbia del barrio · Los del
   * Sur" es ruido, no cumplimiento.
   */
  const extra =
    attribution && attribution.replace(/\s+/g, " ").trim() !== visible ? attribution : null;

  return (
    <div className={cn("pointer-events-none flex max-w-[85%] flex-col items-start gap-1", className)}>
      <span
        className={cn(
          "cl-print-fill flex min-w-0 max-w-full items-center gap-1.5 rounded-full",
          "bg-media-scrim px-2.5 py-1 text-xs font-semibold text-on-media backdrop-blur-sm",
        )}
        // Lo que significa lo dice el texto de al lado; el ícono es adorno.
        aria-label={MUSIC_COPY.badgeLabel(title, artist)}
      >
        <MusicNotes size={13} weight="fill" aria-hidden="true" className="shrink-0" />
        {/* `truncate`: un título largo no puede empujar la píldora fuera de la
            foto. Se corta el texto, nunca se corta la píldora. */}
        <span className="truncate">{visible}</span>
      </span>

      {extra && (
        <span
          className={cn(
            "cl-print-fill max-w-full rounded-full bg-media-scrim px-2.5 py-0.5",
            "text-[11px] font-medium text-on-media backdrop-blur-sm",
          )}
        >
          {/* Sin `truncate`: si la licencia pide un texto, se lee entero o no se
              cumple. Que dé la vuelta a dos renglones es preferible a recortarlo. */}
          {extra}
        </span>
      )}
    </div>
  );
}
