"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Pause, Play } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import {
  etiquetaDeVelocidad,
  formatearDuracion,
  siguienteVelocidad,
  type VelocidadDeReproduccion,
} from "@/lib/messaging/audio";
import { COPY_COMPOSER } from "./copy-composer";

/**
 * REPRODUCTOR DE UNA NOTA DE VOZ.
 *
 * La onda NO se calcula acá: viene en `adjunto.onda` (0136), un arreglo corto
 * de enteros 0–100 que el grabador guardó al mandar el audio. Ése es todo el
 * punto de esa columna — dibujar la forma sin bajar el archivo. Un reproductor
 * que decodifica el audio para pintarse convierte cada burbuja del hilo en una
 * descarga, y en un chat con veinte audios eso son veinte descargas para ver
 * una lista.
 */

/**
 * UN SOLO AUDIO SUENA A LA VEZ EN TODA LA PANTALLA.
 *
 * Registro a nivel de módulo y no un contexto de React a propósito: los
 * reproductores viven en burbujas que renderiza el servidor, esparcidas por el
 * hilo, y un provider tendría que envolver una lista que no es de este
 * componente. Un `Map` compartido resuelve lo mismo sin pedirle nada al árbol.
 */
const enReproduccion = new Map<string, () => void>();

function reclamarReproduccion(id: string, pausar: () => void): void {
  for (const [otroId, pausarOtro] of enReproduccion) {
    if (otroId !== id) pausarOtro();
  }
  enReproduccion.set(id, pausar);
}

export interface VoicePlayerProps {
  /** URL firmada del bucket privado. `null` mientras se está pidiendo. */
  src: string | null;
  /** `adjunto.duracion_ms`. Lo que se muestra antes de tocar play. */
  duracionMs?: number;
  /** `adjunto.onda` — picos 0–100. Sin ella se dibuja una línea pareja. */
  onda?: readonly number[];
  /** `true` cuando la burbuja es propia (fondo de marca). */
  propio?: boolean;
  className?: string;
}

const ONDA_PLANA = Array.from({ length: 48 }, () => 38);

export function VoicePlayer({
  src,
  duracionMs,
  onda,
  propio = false,
  className,
}: VoicePlayerProps) {
  const id = useId();
  const audioRef = useRef<HTMLAudioElement>(null);
  const pintadoRef = useRef<HTMLDivElement>(null);

  const [sonando, setSonando] = useState(false);
  const [velocidad, setVelocidad] = useState<VelocidadDeReproduccion>(1);
  const [transcurrido, setTranscurrido] = useState(0);
  const [duracionCargada, setDuracionCargada] = useState(0);
  const [fallo, setFallo] = useState(false);

  const picos = onda && onda.length > 0 ? onda : ONDA_PLANA;
  // Del metadato del archivo sólo cuando `adjunto.duracion_ms` no vino: lo que
  // se guardó al grabar es más fiable que lo que reporta un contenedor webm sin
  // índice de duración (Chrome devuelve Infinity hasta que se busca al final).
  const duracionS = duracionMs && duracionMs > 0 ? duracionMs / 1000 : duracionCargada;

  function reiniciarPintado() {
    if (pintadoRef.current) pintadoRef.current.style.clipPath = "inset(0 100% 0 0)";
  }

  /**
   * El avance se pinta escribiendo `clip-path` DIRECTO sobre el elemento, en un
   * rAF, sin pasar por el estado de React: serían sesenta renders por segundo
   * de un componente que puede estar veinte veces en el hilo. El texto del
   * tiempo sí usa estado, pero se actualiza cuatro veces por segundo con
   * `timeupdate`.
   */
  const pintarAvance = useCallback(() => {
    const audio = audioRef.current;
    const capa = pintadoRef.current;
    if (!audio || !capa) return;
    const total =
      Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duracionS;
    const razon = total > 0 ? Math.min(1, audio.currentTime / total) : 0;
    capa.style.clipPath = `inset(0 ${((1 - razon) * 100).toFixed(2)}% 0 0)`;
  }, [duracionS]);

  useEffect(() => {
    if (!sonando) return;
    let cuadro = 0;
    function paso() {
      pintarAvance();
      cuadro = requestAnimationFrame(paso);
    }
    cuadro = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(cuadro);
  }, [sonando, pintarAvance]);

  useEffect(() => {
    const registro = enReproduccion;
    return () => {
      registro.delete(id);
    };
  }, [id]);

  function duracionEfectiva(): number {
    const audio = audioRef.current;
    if (audio && Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration;
    return duracionS;
  }

  function alternar() {
    const audio = audioRef.current;
    if (!audio || !src) return;
    if (sonando) {
      audio.pause();
      return;
    }
    reclamarReproduccion(id, () => audio.pause());
    audio.playbackRate = velocidad;
    void audio.play().catch(() => setFallo(true));
  }

  function cambiarVelocidad() {
    const siguiente = siguienteVelocidad(velocidad);
    setVelocidad(siguiente);
    if (audioRef.current) audioRef.current.playbackRate = siguiente;
  }

  function buscarEn(razon: number) {
    const audio = audioRef.current;
    const total = duracionEfectiva();
    if (!audio || total <= 0) return;
    audio.currentTime = Math.max(0, Math.min(total, razon * total));
    setTranscurrido(audio.currentTime);
    pintarAvance();
  }

  function buscarDesdeEvento(event: React.PointerEvent<HTMLDivElement>) {
    const caja = event.currentTarget.getBoundingClientRect();
    if (caja.width <= 0) return;
    buscarEn((event.clientX - caja.left) / caja.width);
  }

  function saltar(segundos: number) {
    const audio = audioRef.current;
    const total = duracionEfectiva();
    if (!audio || total <= 0) return;
    buscarEn((audio.currentTime + segundos) / total);
  }

  const restante = Math.max(0, duracionS - transcurrido);
  const etiquetaTiempo = formatearDuracion(
    (sonando || transcurrido > 0 ? restante : duracionS) * 1000,
  );
  const razonActual = duracionS > 0 ? Math.min(1, transcurrido / duracionS) : 0;

  return (
    <div className={cn("flex w-full max-w-xs items-center gap-2.5", className)}>
      {src && (
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          // Una `src` nueva (la firma venció y se renovó) reinicia lo pintado
          // acá y no en un efecto: el elemento avisa cuándo empieza a cargar, y
          // un `setState` sincrónico dentro de un efecto encadena renders.
          onLoadStart={() => {
            setFallo(false);
            setTranscurrido(0);
            setDuracionCargada(0);
            reiniciarPintado();
          }}
          onLoadedMetadata={(event) => {
            const duracion = event.currentTarget.duration;
            if (Number.isFinite(duracion) && duracion > 0) setDuracionCargada(duracion);
          }}
          onPlay={() => setSonando(true)}
          onPause={() => setSonando(false)}
          onTimeUpdate={(event) => setTranscurrido(event.currentTarget.currentTime)}
          onEnded={() => {
            setSonando(false);
            setTranscurrido(0);
            reiniciarPintado();
          }}
          onError={() => setFallo(true)}
        />
      )}

      <button
        type="button"
        onClick={alternar}
        disabled={!src || fallo}
        aria-label={
          sonando ? COPY_COMPOSER.reproductor.pausar : COPY_COMPOSER.reproductor.reproducir
        }
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full",
          "transition-[transform,background-color,opacity] duration-(--duration-fast) ease-(--ease-spring)",
          "active:scale-[0.92] motion-reduce:transition-none motion-reduce:active:scale-100",
          "disabled:pointer-events-none disabled:opacity-45",
          "focus-visible:outline-none focus-visible:ring-[3px]",
          propio
            ? "bg-brand-foreground/15 text-brand-foreground focus-visible:ring-brand-foreground/70"
            : "bg-brand text-brand-foreground focus-visible:ring-focus-ring",
        )}
      >
        {!src && !fallo ? (
          <Spinner size={16} />
        ) : sonando ? (
          <Pause size={18} weight="fill" aria-hidden="true" />
        ) : (
          <Play size={18} weight="fill" aria-hidden="true" />
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {fallo ? (
          <p
            className={cn(
              "text-xs",
              propio ? "text-brand-foreground/80" : "text-foreground-muted",
            )}
          >
            {COPY_COMPOSER.reproductor.noDisponible}
          </p>
        ) : (
          <div
            role="slider"
            tabIndex={0}
            aria-label={COPY_COMPOSER.reproductor.reproducir}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(razonActual * 100)}
            aria-valuetext={formatearDuracion(transcurrido * 1000)}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              buscarDesdeEvento(event);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                buscarDesdeEvento(event);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                saltar(5);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                saltar(-5);
              } else if (event.key === "Home") {
                event.preventDefault();
                buscarEn(0);
              } else if (event.key === "End") {
                event.preventDefault();
                buscarEn(1);
              }
            }}
            className={cn(
              "relative h-8 cursor-pointer touch-none select-none rounded-md",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-offset-2",
              propio
                ? "focus-visible:ring-brand-foreground/70 focus-visible:ring-offset-brand"
                : "focus-visible:ring-focus-ring focus-visible:ring-offset-surface-raised",
            )}
          >
            <Barras
              picos={picos}
              className={propio ? "bg-brand-foreground/35" : "bg-border-strong"}
            />
            {/* La misma onda encima, en color, recortada hasta donde va la
                reproducción. Es la capa que mueve el rAF. */}
            <div
              ref={pintadoRef}
              aria-hidden="true"
              className="absolute inset-0"
              style={{ clipPath: "inset(0 100% 0 0)" }}
            >
              <Barras
                picos={picos}
                className={propio ? "bg-brand-foreground" : "bg-brand"}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <span
          className={cn(
            "font-mono text-[0.6875rem] tabular-nums",
            propio ? "text-brand-foreground/85" : "text-foreground-muted",
          )}
        >
          {etiquetaTiempo}
        </span>
        <button
          type="button"
          onClick={cambiarVelocidad}
          aria-label={COPY_COMPOSER.reproductor.velocidad(etiquetaDeVelocidad(velocidad))}
          className={cn(
            "rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold tabular-nums",
            "transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring)",
            "active:scale-[0.92] motion-reduce:transition-none motion-reduce:active:scale-100",
            "focus-visible:outline-none focus-visible:ring-2",
            propio
              ? "bg-brand-foreground/15 text-brand-foreground focus-visible:ring-brand-foreground/70"
              : "bg-surface-subtle text-foreground-secondary hover:bg-surface-hover focus-visible:ring-focus-ring",
          )}
        >
          {etiquetaDeVelocidad(velocidad)}
        </button>
      </div>
    </div>
  );
}

/**
 * Las barras. El piso del 8% existe porque un pico de 0 es silencio REAL: una
 * barra de alto cero deja un agujero en la onda, y el silencio de una nota de
 * voz se lee mejor como una línea fina que como un hueco.
 */
function Barras({ picos, className }: { picos: readonly number[]; className: string }) {
  return (
    <div aria-hidden="true" className="flex h-full w-full items-center gap-[2px]">
      {picos.map((pico, indice) => (
        <span
          key={indice}
          className={cn("min-h-[3px] flex-1 rounded-full", className)}
          style={{ height: `${Math.max(8, pico)}%` }}
        />
      ))}
    </div>
  );
}
