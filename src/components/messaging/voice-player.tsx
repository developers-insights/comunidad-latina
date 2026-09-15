"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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
  /**
   * `true` cuando la burbuja es propia.
   *
   * ⚠️ NO significa "fondo de marca". Las dos burbujas del hilo van sobre
   * TINTES claros (`bg-brand-tint` y `bg-surface-subtle`), así que la paleta de
   * este reproductor es la misma de los dos lados y `propio` sólo corrige el
   * color del texto secundario y el borde del anillo de foco. Cuando esto
   * pintaba blanco sobre blanco (`brand-foreground`, pensado para un fondo
   * `bg-brand` sólido que la burbuja nunca tuvo), el audio propio se veía vacío:
   * el play, la onda y el reloj eran invisibles.
   */
  propio?: boolean;
  className?: string;
}

/**
 * CUÁNTAS BARRAS SE DIBUJAN. NO es el largo de `adjunto.onda` (48, `PICOS_DE_ONDA`).
 *
 * Con 48 barras y 1,5 px de separación, los huecos solos miden 70 px. Adentro de
 * una burbuja —que mide lo que mide su contenido— eso era TODO el ancho
 * intrínseco de la onda: las barras son `flex-1` sin ancho propio, así que el
 * navegador le daba a la onda exactamente el largo de los huecos y cada barra
 * quedaba en 0 px. La onda no se veía en ningún hilo, en ningún teléfono.
 *
 * 24 es el techo que deja barras visibles en el caso más angosto que soportamos
 * (un audio ajeno en un grupo, con avatar, a 320 px): ~81 px de onda − 34,5 de
 * huecos = 1,9 px por barra. Subir este número las vuelve a apagar.
 */
export const BARRAS_DIBUJADAS = 24;

const ONDA_PLANA = Array.from({ length: BARRAS_DIBUJADAS }, () => 38);

/**
 * Los 48 picos guardados → las `BARRAS_DIBUJADAS` que entran. Promedio por
 * cubeta y no "una de cada dos": con un salto, un pico aislado desaparece o se
 * come la barra entera según dónde caiga, y la misma nota se dibuja distinta
 * según su largo.
 */
export function aBarras(picos: readonly number[], cuantas: number): number[] {
  if (picos.length <= cuantas) return [...picos];
  return Array.from({ length: cuantas }, (_, indice) => {
    const desde = Math.floor((indice * picos.length) / cuantas);
    const hasta = Math.max(desde + 1, Math.floor(((indice + 1) * picos.length) / cuantas));
    let suma = 0;
    for (let i = desde; i < hasta; i += 1) suma += picos[i] ?? 0;
    return Math.round(suma / (hasta - desde));
  });
}

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

  const picos = useMemo(
    () => (onda && onda.length > 0 ? aBarras(onda, BARRAS_DIBUJADAS) : ONDA_PLANA),
    [onda],
  );
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
    // `cl-print-hide`: un reproductor de audio impreso no es nada — y el
    // tiempo y el aviso de error viven fuera de un <button>, así que el
    // @media print no los alcanza solo (contrato de `print-contract.test.ts`).
    <div
      className={cn(
        // ⚠️ ANCHO PROPIO, NO `w-full`. La burbuja del hilo mide lo que mide su
        // contenido, así que un `w-full` acá no pedía nada: el ancho del audio
        // terminaba siendo el ancho INTRÍNSECO de sus partes (los huecos entre
        // barras) y salía igual —201 px— en un teléfono de 320 y en un monitor.
        // `w-[17rem]` es el tamaño con el que se diseñó una nota de voz y
        // `max-w-full` lo deja achicarse cuando la burbuja no da. En el composer
        // llega `flex-1`, que fija `flex-basis:0` y manda sobre este `width`.
        "cl-print-hide flex w-[17rem] min-w-0 max-w-full items-center gap-2.5",
        className,
      )}
    >
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
          "bg-brand text-brand-foreground",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
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
              propio ? "text-foreground-secondary" : "text-foreground-muted",
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
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              "focus-visible:ring-offset-2",
              propio
                ? "focus-visible:ring-offset-brand-tint"
                : "focus-visible:ring-offset-surface-subtle",
            )}
          >
            <Barras picos={picos} className="bg-brand/30" />
            {/* La misma onda encima, en color, recortada hasta donde va la
                reproducción. Es la capa que mueve el rAF. */}
            <div
              ref={pintadoRef}
              aria-hidden="true"
              className="absolute inset-0"
              style={{ clipPath: "inset(0 100% 0 0)" }}
            >
              <Barras picos={picos} className="bg-brand" />
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <span
          className={cn(
            "font-mono text-[0.6875rem] tabular-nums",
            propio ? "text-foreground-secondary" : "text-foreground-muted",
          )}
        >
          {etiquetaTiempo}
        </span>
        <button
          type="button"
          onClick={cambiarVelocidad}
          aria-label={COPY_COMPOSER.reproductor.velocidad(etiquetaDeVelocidad(velocidad))}
          className={cn(
            // La píldora mide 30×28 y no puede crecer: al lado de una onda de
            // 17rem, un control de 44px se lee como un botón más. `touch-hitbox`
            // le da los 44×44 reales con un pseudo-elemento invisible, sin
            // tocar lo que se ve — la misma utility que ya usan el Trust Score
            // inline y el cierre del toast.
            "touch-hitbox rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold tabular-nums",
            "transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring)",
            "active:scale-[0.92] motion-reduce:transition-none motion-reduce:active:scale-100",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
            propio
              ? "bg-canvas/55 text-foreground-secondary hover:bg-canvas/75"
              : "bg-surface-subtle text-foreground-secondary hover:bg-surface-hover",
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
 *
 * ⚠️ El `gap` es lo único con ancho propio acá: las barras son `flex-1` y no
 * aportan nada al ancho mínimo. Cada pixel que se le sume a esta separación se
 * le resta a TODAS las barras — ver `BARRAS_DIBUJADAS`.
 */
function Barras({ picos, className }: { picos: readonly number[]; className: string }) {
  return (
    <div aria-hidden="true" className="flex h-full w-full items-center gap-[1.5px]">
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
