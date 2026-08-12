"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  ArrowClockwise,
  Check,
  MusicNotes,
  Pause,
  Play,
  X,
} from "@phosphor-icons/react/dist/ssr";
import { BottomSheet, Button, Skeleton } from "@/components/ui";
import { usePrefersReducedMotion } from "@/components/motion";
import { cn } from "@/lib/utils";
import {
  MUSIC_CLIP_SECONDS,
  clampStartSeconds,
  clipEndSeconds,
  formatClock,
  maxStartSeconds,
  type MusicTrackView,
  type PickedTrack,
} from "@/lib/media/audio-track";
import { clipGain, musicTimeFor } from "@/lib/media/audio-mix";
import { listMusicTracksAction } from "@/app/(app)/feed/music-actions";
import { MUSIC_COPY } from "./music-copy";

/**
 * ELEGIR MÚSICA PARA UNA PUBLICACIÓN (0090).
 *
 * SE MONTA COMO UNA FILA, NO COMO UNA CAJA. Va en la ranura `musicSlot` de
 * ComposerSheet, entre las otras filas de acción, así que no trae ancho, fondo
 * ni margen propios: hereda el layout de quien lo monta. Un componente que se
 * pinta su propia tarjeta no se puede montar en una lista de acciones sin
 * pelearse con el ritmo vertical de la hoja.
 *
 * CONTROLADO: el estado que importa —qué pista y desde qué segundo— vive
 * afuera, en PostComposer, que es quien publica. Acá adentro sólo hay estado de
 * BORRADOR: lo que se está probando en la hoja no es lo elegido hasta que la
 * persona toca "Listo". Cerrar sin confirmar no cambia nada, que es lo que
 * cualquiera espera de una hoja modal.
 *
 * UN SOLO AUDIO SONANDO. Hay UN elemento `<audio>` para toda la hoja, no uno
 * por pista. Elegir otra canción reusa el mismo elemento; cerrar la hoja lo
 * pausa. Es la única forma de garantizar que no queden dos canciones encimadas,
 * y además no crea 40 elementos de audio para un catálogo de 40.
 *
 * EL RECORTE. La vista previa suena EXACTAMENTE lo que se va a publicar: desde
 * el segundo elegido, 30 segundos, y vuelve a empezar con un desvanecido corto
 * en las puntas (`musicTimeFor` + `clipGain`). Escuchar algo distinto de lo que
 * se publica es la forma más rápida de que alguien publique algo que no quería.
 */

export type { PickedTrack };

export interface MusicPickerProps {
  value: PickedTrack | null;
  onChange: (next: PickedTrack | null) => void;
  disabled?: boolean;
}

type CatalogState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; tracks: MusicTrackView[] }
  | { status: "error"; message: string };

/* -------------------------------------------------------------------------- */
/*                          La fila (lo que se monta)                          */
/* -------------------------------------------------------------------------- */

export function MusicPicker({ value, onChange, disabled = false }: MusicPickerProps) {
  const [open, setOpen] = useState(false);
  /**
   * El catálogo vive ACÁ y no en la hoja porque se pide desde el GESTO que
   * abre la hoja, no desde un efecto que reacciona a que se abrió. Es la
   * diferencia entre "la persona pidió ver las canciones" y "el componente se
   * enteró tarde": lo primero arranca la consulta un render antes y no
   * encadena renders (react-hooks/set-state-in-effect).
   */
  const [catalog, setCatalog] = useState<CatalogState>({ status: "idle" });

  const load = useCallback(async () => {
    setCatalog({ status: "loading" });
    const result = await listMusicTracksAction();
    if (result.ok) {
      setCatalog({ status: "ready", tracks: result.tracks });
      return;
    }
    // Cada motivo tiene su salida: una sesión vencida no se arregla
    // reintentando, y decirle "revisá tu conexión" haría perder el tiempo.
    setCatalog({
      status: "error",
      message:
        result.code === "unauthenticated"
          ? MUSIC_COPY.signedOut
          : result.code === "tenant-mismatch"
            ? result.message
            : MUSIC_COPY.errorBody,
    });
  }, []);

  // Se pide el catálogo al abrir, no al montar el composer: quien publica una
  // foto sin música no tiene por qué pagar esta consulta.
  const openSheet = useCallback(() => {
    setOpen(true);
    if (catalog.status === "idle") void load();
  }, [catalog.status, load]);

  return (
    <>
      {value ? (
        <div className="flex items-center gap-2">
          {/* La pista elegida ABRE la hoja para cambiarla: tocar lo que ya
              elegiste tiene que llevarte a donde se elige, no a ningún lado. */}
          <button
            type="button"
            onClick={openSheet}
            disabled={disabled}
            aria-label={MUSIC_COPY.change}
            className={cn(
              "flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-brand bg-brand/8 px-3 text-left",
              "transition-colors duration-(--duration-fast)",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              "disabled:pointer-events-none disabled:opacity-45",
            )}
          >
            <MusicNotes size={17} weight="fill" aria-hidden="true" className="shrink-0 text-brand-ink" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-foreground">
                {value.title}
              </span>
              <span className="block truncate text-xs text-foreground-secondary">
                {value.artist} · {MUSIC_COPY.trimValue(formatClock(value.startSeconds))}
              </span>
            </span>
          </button>
          {/* Quitar es su propio botón: meterlo dentro del anterior obligaría a
              anidar controles y dejaría dos acciones en un mismo blanco táctil. */}
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            aria-label={MUSIC_COPY.remove}
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-full text-foreground-secondary",
              "transition-colors duration-(--duration-fast) hover:bg-surface-hover hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              "disabled:pointer-events-none disabled:opacity-45",
            )}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={openSheet}
          disabled={disabled}
          className={cn(
            "flex min-h-11 w-full items-center gap-2.5 rounded-lg border border-dashed border-border px-3 text-left",
            "transition-colors duration-(--duration-fast) hover:border-brand hover:bg-surface-subtle",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            "disabled:pointer-events-none disabled:opacity-45",
          )}
        >
          <MusicNotes size={17} aria-hidden="true" className="shrink-0 text-foreground-secondary" />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">{MUSIC_COPY.add}</span>
            <span className="block truncate text-xs text-foreground-muted">
              {MUSIC_COPY.addHint}
            </span>
          </span>
        </button>
      )}

      <MusicSheet
        open={open}
        onClose={() => setOpen(false)}
        value={value}
        catalog={catalog}
        onRetry={() => void load()}
        onConfirm={(next) => {
          onChange(next);
          setOpen(false);
        }}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  La hoja                                    */
/* -------------------------------------------------------------------------- */

function MusicSheet({
  open,
  onClose,
  value,
  catalog,
  onRetry,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  value: PickedTrack | null;
  catalog: CatalogState;
  onRetry: () => void;
  onConfirm: (next: PickedTrack) => void;
}) {
  const reduce = usePrefersReducedMotion();
  const trimId = useId();
  /** Borrador: lo que se está probando, todavía no elegido. */
  const [draftId, setDraftId] = useState<string | null>(value?.id ?? null);
  const [draftStart, setDraftStart] = useState(value?.startSeconds ?? 0);
  /** Qué pista está sonando ahora mismo (null = ninguna). */
  const [playingId, setPlayingId] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** Segundo del recorte desde el que arranca la vuelta actual. */
  const clipStartRef = useRef(0);

  const tracks = catalog.status === "ready" ? catalog.tracks : [];
  const draft = tracks.find((track) => track.id === draftId) ?? null;

  /* ------------------------- Abrir y cerrar la hoja ----------------------- */

  /**
   * Ajuste de estado DURANTE EL RENDER (el patrón que la doc de React llama
   * "adjusting state when a prop changes"), no en un efecto. Abrir la hoja
   * vuelve a lo que YA está elegido —no a lo último que se estuvo probando y
   * se descartó— y cerrarla apaga el indicador de "sonando". Hacerlo en un
   * `useEffect` encadenaría un render de más y pintaría un frame con el
   * borrador viejo antes de corregirlo.
   */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setPlayingId(null);
    if (open) {
      setDraftId(value?.id ?? null);
      setDraftStart(value?.startSeconds ?? 0);
    }
  }

  /* -------------------------- El audio de la hoja ------------------------- */

  /**
   * Sólo toca el elemento: NO escribe estado de React. Por eso se puede llamar
   * desde un efecto sin encadenar renders — el `<audio>` es un sistema externo
   * y sincronizarlo es exactamente para lo que sirve un efecto. Quién está
   * sonando (`playingId`) lo apaga el ajuste de arriba.
   */
  const stopAudioElement = useCallback(() => {
    const node = audioRef.current;
    if (!node) return;
    node.pause();
    node.removeAttribute("src");
    node.load();
  }, []);

  // Cerrar la hoja CORTA el audio. Sin esto, la música seguiría sonando encima
  // del feed y no habría forma visible de pararla. El desmontaje también:
  // publicar cierra el composer entero.
  useEffect(() => {
    if (!open) stopAudioElement();
    return stopAudioElement;
  }, [open, stopAudioElement]);

  const playTrack = useCallback(
    (track: MusicTrackView, from: number) => {
      const node = audioRef.current;
      if (!node) return;
      const start = clampStartSeconds(from, track.durationSeconds);
      clipStartRef.current = start;
      if (node.getAttribute("src") !== track.previewUrl) {
        node.src = track.previewUrl;
      }
      node.currentTime = start;
      node.volume = 0;
      const played = node.play() as Promise<void> | undefined;
      if (played) {
        played.then(
          () => setPlayingId(track.id),
          () => {
            // El navegador rechazó la reproducción (política de autoplay, red).
            // No hay nada que hacer más que no mentir que está sonando.
            setPlayingId(null);
          },
        );
        return;
      }
      // Navegadores viejos / jsdom: play() no devuelve promesa.
      setPlayingId(track.id);
    },
    [],
  );

  const togglePlay = useCallback(
    (track: MusicTrackView) => {
      if (playingId === track.id) {
        audioRef.current?.pause();
        setPlayingId(null);
        return;
      }
      playTrack(track, draftId === track.id ? draftStart : 0);
    },
    [playingId, playTrack, draftId, draftStart],
  );

  /** Elegir una pista en la lista: la deja en borrador y la hace sonar. */
  const selectTrack = useCallback(
    (track: MusicTrackView) => {
      const start = draftId === track.id ? draftStart : 0;
      setDraftId(track.id);
      setDraftStart(clampStartSeconds(start, track.durationSeconds));
      playTrack(track, start);
    },
    [draftId, draftStart, playTrack],
  );

  /** Mover el recorte reubica la púa en el acto: se escucha lo que se elige. */
  const moveTrim = useCallback(
    (next: number) => {
      if (!draft) return;
      const start = clampStartSeconds(next, draft.durationSeconds);
      setDraftStart(start);
      clipStartRef.current = start;
      const node = audioRef.current;
      if (node && playingId === draft.id) node.currentTime = start;
    },
    [draft, playingId],
  );

  /**
   * El recorte se repite y se desvanece en las puntas. Va acá y no en un
   * intervalo propio: `timeupdate` ya lo dispara el elemento, y un `setInterval`
   * por pista sería un timer que sobrevive a la hoja.
   */
  const handleTimeUpdate = useCallback(() => {
    const node = audioRef.current;
    if (!node || !draft) return;
    const start = clipStartRef.current;
    const end = clipEndSeconds(start, draft.durationSeconds);
    const elapsed = node.currentTime - start;
    node.volume = clipGain(elapsed, Math.max(0, end - start));
    if (node.currentTime >= end) {
      node.currentTime = musicTimeFor(start, 0, draft.durationSeconds);
    }
  }, [draft]);

  /* -------------------------------- Render -------------------------------- */

  const max = draft ? maxStartSeconds(draft.durationSeconds) : 0;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      size="tall"
      title={MUSIC_COPY.sheetTitle}
      className="cl-print-hide"
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
    >
      {/* Un solo elemento de audio para toda la hoja. `preload="none"`: abrir la
          hoja no puede descargar 40 canciones. */}
      <audio
        ref={audioRef}
        preload="none"
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => setPlayingId(null)}
        // Un error de red no puede dejar el botón diciendo "Parar" para siempre.
        onError={() => setPlayingId(null)}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-4 pt-1">
        {catalog.status === "loading" || catalog.status === "idle" ? (
          <TrackListSkeleton />
        ) : catalog.status === "error" ? (
          <SheetMessage
            title={MUSIC_COPY.errorTitle}
            body={catalog.message}
            action={
              <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
                <ArrowClockwise size={15} aria-hidden="true" />
                {MUSIC_COPY.retry}
              </Button>
            }
          />
        ) : tracks.length === 0 ? (
          <SheetMessage title={MUSIC_COPY.emptyTitle} body={MUSIC_COPY.emptyBody} />
        ) : (
          <>
            <p className="sr-only" id={`${trimId}-list`}>
              {MUSIC_COPY.listLabel}
            </p>
            <ul aria-labelledby={`${trimId}-list`} className="flex flex-col gap-1.5">
              {tracks.map((track) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  selected={draftId === track.id}
                  playing={playingId === track.id}
                  reduce={reduce}
                  onSelect={() => selectTrack(track)}
                  onTogglePlay={() => togglePlay(track)}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      {/* El recorte y el pie viven fuera del scroll: elegir el tramo no puede
          obligar a bajar por una lista de 40 canciones para encontrar el
          deslizador que ya se estaba usando. */}
      {draft && (
        <div className="shrink-0 border-t border-border-subtle px-5 pt-3">
          <label htmlFor={trimId} className="block text-sm font-semibold text-foreground">
            {MUSIC_COPY.trimLabel}
          </label>
          <p className="mt-0.5 text-xs text-foreground-secondary">
            {MUSIC_COPY.trimHint(MUSIC_CLIP_SECONDS)}
          </p>
          <input
            id={trimId}
            type="range"
            min={0}
            max={max}
            step={1}
            value={Math.min(draftStart, max)}
            disabled={max === 0}
            onChange={(event) => moveTrim(Number(event.target.value))}
            // El lector de pantalla anuncia el TRAMO, no un número suelto: "45"
            // no significa nada, "De 0:45 a 1:15" sí.
            aria-valuetext={MUSIC_COPY.trimValueText(
              formatClock(draftStart),
              formatClock(clipEndSeconds(draftStart, draft.durationSeconds)),
            )}
            aria-label={MUSIC_COPY.trimSliderLabel}
            className={cn(
              // `h-11` es el blanco táctil; la barra visible la dibuja el track.
              "mt-2 h-11 w-full cursor-pointer appearance-none bg-transparent",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              "disabled:cursor-not-allowed disabled:opacity-45",
              "[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-surface-subtle",
              "[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-surface-subtle",
              "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:-mt-[7px] [&::-webkit-slider-thumb]:size-5",
              "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-brand [&::-webkit-slider-thumb]:shadow-xs",
              "[&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-brand",
            )}
          />
          <p className="text-xs font-medium tabular-nums text-foreground-secondary">
            {MUSIC_COPY.trimValueText(
              formatClock(draftStart),
              formatClock(clipEndSeconds(draftStart, draft.durationSeconds)),
            )}
          </p>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-2 border-t border-border-subtle px-5 pt-3">
        <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={onClose}>
          {MUSIC_COPY.cancel}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="md"
          className="ml-auto"
          disabled={!draft}
          onClick={() => {
            if (!draft) return;
            onConfirm({
              id: draft.id,
              title: draft.title,
              artist: draft.artist,
              previewUrl: draft.previewUrl,
              startSeconds: clampStartSeconds(draftStart, draft.durationSeconds),
            });
          }}
        >
          {MUSIC_COPY.done}
        </Button>
      </div>
    </BottomSheet>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  Piezas                                     */
/* -------------------------------------------------------------------------- */

function TrackRow({
  track,
  selected,
  playing,
  reduce,
  onSelect,
  onTogglePlay,
}: {
  track: MusicTrackView;
  selected: boolean;
  playing: boolean;
  reduce: boolean;
  onSelect: () => void;
  onTogglePlay: () => void;
}) {
  return (
    <li className="flex items-center gap-2">
      {/* Escuchar y elegir son DOS acciones distintas y tienen dos botones:
          probar una canción no debería cambiar la que vas a publicar. */}
      <button
        type="button"
        onClick={onTogglePlay}
        aria-label={playing ? MUSIC_COPY.stop(track.title) : MUSIC_COPY.play(track.title)}
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-full",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        <span
          className={cn(
            "grid size-9 place-items-center rounded-full",
            playing ? "bg-brand text-brand-foreground" : "bg-surface-subtle text-foreground-secondary",
            // El rebote se apaga con prefers-reduced-motion; el cambio de color
            // sigue comunicando el estado.
            !reduce &&
              "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-90",
          )}
        >
          {playing ? (
            <Pause size={15} weight="fill" aria-hidden="true" />
          ) : (
            <Play size={15} weight="fill" aria-hidden="true" />
          )}
        </span>
      </button>

      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          "flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-left",
          "transition-colors duration-(--duration-fast)",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          // El elegido se lee por relleno Y por peso, no sólo por color.
          selected
            ? "border-brand bg-brand/8"
            : "border-transparent bg-surface hover:bg-surface-subtle",
        )}
      >
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-sm text-foreground",
              selected ? "font-semibold" : "font-medium",
            )}
          >
            {track.title}
          </span>
          <span className="block truncate text-xs text-foreground-secondary">{track.artist}</span>
        </span>
        <span className="shrink-0 text-xs tabular-nums text-foreground-muted">
          {formatClock(track.durationSeconds)}
        </span>
        {selected && <Check size={15} weight="bold" aria-hidden="true" className="shrink-0 text-brand" />}
      </button>
    </li>
  );
}

/** Carga de CONTENIDO: esqueleto, nunca un spinner centrado (§5.2). */
function TrackListSkeleton() {
  return (
    <ul aria-label={MUSIC_COPY.loading} aria-busy="true" className="flex flex-col gap-1.5">
      {[0, 1, 2, 3, 4].map((row) => (
        <li key={row} className="flex items-center gap-2 py-1">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5 w-2/5 rounded" />
            <Skeleton className="mt-1.5 h-3 w-1/4 rounded" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Vacío y error comparten forma: título, explicación y —si sirve— una salida. */
function SheetMessage({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div role="status" className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <MusicNotes size={28} aria-hidden="true" className="text-foreground-muted" />
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="max-w-xs text-sm text-foreground-secondary">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
