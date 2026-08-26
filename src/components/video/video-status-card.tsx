"use client";

import { FilmSlate, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { usePrefersReducedMotion } from "@/components/motion";
import { cn } from "@/lib/utils";
import { VIDEO_COPY } from "./copy";

/**
 * =============================================================================
 * LO QUE OCUPA EL LUGAR DEL VIDEO MIENTRAS TODAVÍA NO HAY VIDEO
 * =============================================================================
 *
 * Después de subir, Mux transcodifica, y eso tarda. La publicación no se queda
 * esperando —sale igual, que es lo que la persona vino a hacer—, así que durante
 * un rato existe una tarjeta publicada cuyo video todavía no se puede ver.
 *
 * Ese rato es este componente. Las dos formas fáciles de resolverlo son las dos
 * que no se pueden hacer:
 *
 *  · un reproductor montado sobre un HLS que todavía no existe → un cuadro negro
 *    con controles que no responden, o un error del reproductor;
 *  · nada → una tarjeta con texto y un hueco, que se lee como un bug.
 *
 * Lo honesto es decirlo, y decirlo de forma que nadie sienta que tiene que
 * hacer algo: "tarda un ratito, cuando esté listo aparece solo". Eso es cierto
 * (ver `mux-status-poll.ts`) y le devuelve el teléfono a la persona.
 *
 * ── LA MISMA CAJA QUE EL VIDEO ──────────────────────────────────────────────
 * 4:5 y ancho completo, exactamente como `CardVideo` y como `CardMedia`. Cuando
 * el sondeo avise que ya está, el reproductor entra en el MISMO rectángulo y no
 * se mueve nada de lo que hay debajo — el pie, las acciones, la publicación
 * siguiente. Un estado transitorio que empuja el feed hacia abajo al resolverse
 * es peor que la espera.
 */

export type VideoStatusKind = "procesando" | "demorado" | "fallo";

export interface VideoStatusCardProps {
  kind: VideoStatusKind;
  className?: string;
}

export function VideoStatusCard({ kind, className }: VideoStatusCardProps) {
  const reduce = usePrefersReducedMotion();
  const esFallo = kind === "fallo";

  const { titulo, cuerpo } = esFallo
    ? { titulo: VIDEO_COPY.fallo.titulo, cuerpo: VIDEO_COPY.fallo.cuerpo }
    : kind === "demorado"
      ? {
          titulo: VIDEO_COPY.procesando.demoradoTitulo,
          cuerpo: VIDEO_COPY.procesando.demoradoCuerpo,
        }
      : { titulo: VIDEO_COPY.procesando.titulo, cuerpo: VIDEO_COPY.procesando.cuerpo };

  return (
    <div
      /**
       * `role="status"` + `aria-live="polite"`: cuando el sondeo resuelva y esto
       * desaparezca, quien usa lector de pantalla no se entera de nada — pero
       * mientras existe, sí se le anuncia una vez y sin interrumpir lo que
       * estuviera leyendo. Es la diferencia entre una tarjeta muda y una que
       * explica por qué no hay video.
       */
      role="status"
      aria-live="polite"
      className={cn(
        "relative grid aspect-[4/5] w-full place-items-center overflow-hidden",
        // Fondo de superficie y no de medio: acá todavía no hay medio, y pintarlo
        // oscuro como si lo hubiera es justamente el "cuadro negro" a evitar.
        esFallo ? "bg-danger-bg" : "bg-surface-subtle",
        className,
      )}
    >
      {/* Chip en la misma esquina y con la misma forma que el de "Publicidad"
          (card-post-media): quien ya conoce la tarjeta sabe leer esa posición
          como "una marca sobre este medio". Sólo mientras se prepara: un fallo
          no es un estado que valga la pena rotular dos veces. */}
      {!esFallo && (
        <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-full bg-surface/80 px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-foreground-secondary backdrop-blur-sm">
          {VIDEO_COPY.procesando.chip}
        </span>
      )}

      <div className="flex max-w-[16rem] flex-col items-center px-6 text-center">
        <span
          className={cn(
            "grid size-14 place-items-center rounded-full",
            esFallo ? "bg-danger/10 text-danger-ink" : "bg-brand-tint text-brand-ink",
          )}
        >
          {esFallo ? (
            <WarningCircle size={26} weight="regular" aria-hidden="true" />
          ) : (
            <FilmSlate size={26} weight="regular" aria-hidden="true" />
          )}
        </span>

        <p className="mt-3.5 text-sm font-semibold text-foreground">{titulo}</p>
        <p className="mt-1 text-xs leading-relaxed text-foreground-secondary">{cuerpo}</p>

        {/*
          BARRA INDETERMINADA — sólo mientras se está preparando de verdad.
          No es un porcentaje y no finge serlo: nadie puede saber cuánto le falta
          a una transcodificación. Es la misma clase `skeleton` que usa el resto
          de la app para "esto está viniendo", así que el movimiento se siente
          parte del producto y no un widget nuevo.

          Con reduced-motion queda una barra quieta: el mensaje de arriba ya dijo
          todo lo que había que decir, y el movimiento era el adorno.
        */}
        {kind === "procesando" && (
          <span
            aria-hidden="true"
            className={cn(
              "mt-4 h-1 w-24 overflow-hidden rounded-full",
              reduce ? "bg-border" : "skeleton",
            )}
          />
        )}
      </div>
    </div>
  );
}
