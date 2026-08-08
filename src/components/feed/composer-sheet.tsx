"use client";

import { Check, Plus, VideoCamera, X } from "@phosphor-icons/react/dist/ssr";
import { BottomSheet, Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { formatDuration, type VideoCategory } from "@/lib/media/video-policy";
import {
  VIDEO_CATEGORY_LABELS,
  VIDEO_CATEGORY_ORDER,
} from "@/app/(app)/videos/copy";
import { COPY } from "./copy";
import { QuestionBanner } from "./question-banner";
import { TextBanner } from "./text-banner";

/**
 * PASO DE TEXTO del composer rápido (feedback cliente 2026-07-27).
 *
 * Antes el composer era una caja de texto Y, aparte, dos recuadros para adjuntar
 * — "no está el escrito aparte y aparte la foto". Ahora primero se elige QUÉ se
 * publica y recién entonces se abre esta hoja, con el medio a la vista y el
 * texto debajo: el modelo de Instagram (subir → siguiente → escribir el pie).
 *
 * Una sola hoja para los TRES caminos rápidos, porque comparten todo lo que
 * importa (texto, publicar, progreso, errores) y solo cambia la pieza de arriba:
 *  · `media`    → el medio elegido, grande, y el pie debajo.
 *  · `question` → la pregunta se ve COMO VA A SALIR (el banner de marca real) y
 *                 abajo el interruptor de la encuesta Sí/No.
 *  · `text`     → mismo principio que `question` (el cuerpo ES la pieza
 *                 gráfica, vista previa real vía TextBanner) pero SIN encuesta
 *                 — `kind='text'` nunca lleva poll_kind (0041/0043).
 *
 * Es presentacional a propósito: el estado (texto, archivos, subida) vive en
 * PostComposer, que es quien publica. Así no hay dos fuentes de verdad ni un
 * FileList viajando entre componentes.
 */

const MAX_LENGTH = 2000;

export type ComposerMode = "media" | "question" | "text";

export interface ComposerMediaItem {
  id: string;
  kind: "photo" | "video";
  /** URL local (blob:) de la vista previa. */
  preview: string;
  /** Duración medida del video, en segundos (sólo en `kind: "video"`). */
  durationSeconds?: number;
}

export interface ComposerSheetProps {
  open: boolean;
  onClose: () => void;
  mode: ComposerMode;
  body: string;
  onBodyChange: (value: string) => void;
  media: ComposerMediaItem[];
  canAddPhoto: boolean;
  canAddVideo: boolean;
  onAddPhotos: () => void;
  onAddVideo: () => void;
  onRemoveMedia: (id: string) => void;
  pollEnabled: boolean;
  onPollChange: (next: boolean) => void;
  /** Categoría de Videos Cortos elegida (0046). Sólo se usa si hay video. */
  videoCategory: VideoCategory;
  onVideoCategoryChange: (next: VideoCategory) => void;
  /** Id estable de la sesión: fija la variante de color de la vista previa. */
  previewId: string;
  /** Progreso real de la subida del video, o null si no hay ninguna en curso. */
  uploadPct: number | null;
  /** Leyendo la duración del archivo recién elegido (antes de subir nada). */
  measuringVideo?: boolean;
  isPending: boolean;
  onPublish: () => void;
}

/**
 * Cómo se va a ver la encuesta, sin ser la encuesta. Decorativa y `aria-hidden`:
 * un control real acá pediría un post que todavía no existe, y votar en una
 * vista previa no significa nada.
 */
function PollPreview() {
  return (
    <div aria-hidden="true" className="w-full">
      <div className="flex flex-col gap-2">
        {[COPY.post.poll.yes, COPY.post.poll.no].map((label) => (
          <span
            key={label}
            className="flex min-h-11 w-full items-center rounded-full border border-on-media/25 bg-on-media/12 px-4 font-semibold text-on-media"
          >
            {label}
          </span>
        ))}
      </div>
      <p className="mt-2 text-center text-xs text-on-media/75">
        {COPY.post.poll.noVotesYet}
      </p>
    </div>
  );
}

/**
 * MARCO DE LA VISTA PREVIA — "así se va a ver" tiene que verse ENTERO.
 *
 * El bug (feedback cliente 2026-08-05: "el fondo cortado"): el banner fija su
 * alto con el espaciador `pt-[125%]` de TextBanner/QuestionBanner, o sea 125%
 * de SU ANCHO. A ancho completo de la hoja eso son ~416px en un teléfono de
 * 375 — y el área que scrollea de la hoja, con el teclado abierto (que es el
 * estado normal MIENTRAS se escribe, justo cuando aparece la vista previa),
 * mide ~374px menos la etiqueta y el campo de texto: ~215px. Medido en el
 * navegador: 78px de degradado quedaban fuera del viewport, siempre por abajo.
 * No era que el degradado no se pintara —el 4:5 sale exacto— sino que la pieza
 * pedía más alto del que la hoja tenía para mostrarla.
 *
 * El arreglo invierte la dependencia: en vez de que el ALTO salga del ancho
 * disponible, el ANCHO sale del alto disponible. La región es un contenedor de
 * tamaño (`container-type: size`) que toma el espacio que sobra en la columna,
 * y el marco mide `min(100%, 80cqh)` — 80% del alto de la región es
 * exactamente el ancho cuyo 4:5 entra justo. Con lugar de sobra gana el 100% y
 * la vista previa queda del tamaño real de la card; con el teclado arriba se
 * achica en proporción, pero entera. `max-h-full` cierra el caso raro (texto
 * que ni al 4:5 entra en ese ancho): lo que se recorta es el sobrante de
 * texto, nunca el fondo — el degradado llena el marco siempre.
 *
 * `min-h-40` es el piso: en un teléfono chico con el teclado abierto no hay
 * lugar para nada decente, así que la vista previa deja de encogerse y la hoja
 * scrollea, que es un problema que la persona puede resolver.
 */
function PreviewFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-40 flex-1 items-center justify-center [container-type:size]">
      <div className="max-h-full w-[min(100%,80cqh)] overflow-hidden rounded-xl border border-border-subtle">
        {children}
      </div>
    </div>
  );
}

/** Vista previa antes de escribir: no hay pieza todavía, solo la invitación. */
function PreviewPlaceholder({ label }: { label: string }) {
  return (
    <p className="shrink-0 rounded-xl border border-border-subtle bg-surface-subtle px-5 py-10 text-center text-sm text-foreground-muted">
      {label}
    </p>
  );
}

/** Interruptor accesible de verdad: `role="switch"` + `aria-checked`, 44px. */
function PollSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border p-3 text-left",
        "transition-[background-color,border-color] duration-(--duration-fast)",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        "disabled:pointer-events-none disabled:opacity-45",
        checked ? "border-brand bg-brand/8" : "border-border bg-surface",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">
          {COPY.composer.compose.pollLabel}
        </span>
        <span className="mt-0.5 block text-xs text-foreground-secondary">
          {COPY.composer.compose.pollHint}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "flex h-7 w-12 shrink-0 items-center rounded-full p-0.5",
          "transition-colors duration-(--duration-fast) ease-(--ease-spring)",
          checked ? "bg-brand" : "bg-border",
        )}
      >
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-full bg-surface shadow-xs",
            "transition-transform duration-(--duration-fast) ease-(--ease-spring)",
            checked ? "translate-x-5" : "translate-x-0",
          )}
        >
          {checked && <Check size={13} weight="bold" className="text-brand" />}
        </span>
      </span>
    </button>
  );
}

export function ComposerSheet({
  open,
  onClose,
  mode,
  body,
  onBodyChange,
  media,
  canAddPhoto,
  canAddVideo,
  onAddPhotos,
  onAddVideo,
  onRemoveMedia,
  pollEnabled,
  onPollChange,
  videoCategory,
  onVideoCategoryChange,
  previewId,
  uploadPct,
  measuringVideo = false,
  isPending,
  onPublish,
}: ComposerSheetProps) {
  const isQuestion = mode === "question";
  const isText = mode === "text";
  // Ambos exentos del trigger MEDIA_REQUIRED (0023/0043): question y text.
  const exemptFromMedia = isQuestion || isText;
  const photos = media.filter((item) => item.kind === "photo");
  const hasVideo = media.some((item) => item.kind === "video");
  const hasMedia = media.length > 0;
  const trimmed = body.trim();
  /**
   * QUÉ HABILITA PUBLICAR (feedback cliente 2026-08-05: "acá si no pongo algo
   * no me deja publicar. Que se pueda publicar así de una").
   *
   * La regla real es "que haya ALGO que publicar", no "que haya texto":
   *  · con foto o video, el pie es OPCIONAL — una foto ya es la publicación,
   *    igual que en Instagram;
   *  · en pregunta y texto el cuerpo ES la publicación: sin él no hay nada que
   *    mandar, así que sigue siendo obligatorio;
   *  · un post kind='post' SIN medio no pasa el trigger MEDIA_REQUIRED, y acá
   *    el botón se apaga —el medio está a un toque, en la misma pantalla— en
   *    vez de abrir otra hoja encima de esta y pelearse dos focus traps.
   *
   * El mínimo de 2 caracteres se mantiene SOLO para lo que sí se escribió: un
   * pie de un carácter es casi siempre un roce sin querer, y además es la misma
   * regla que valida el servidor (postSchema) — si el botón dejara pasar algo
   * que la action rechaza, la persona vería un error sin entender por qué.
   */
  const bodyOk = trimmed.length === 0 ? !exemptFromMedia : trimmed.length >= 2;
  const canPublish = bodyOk && !isPending && (exemptFromMedia || hasMedia);
  const bodyPlaceholder = isQuestion
    ? COPY.composer.compose.questionPlaceholder
    : isText
      ? COPY.composer.compose.textPlaceholder
      : COPY.composer.compose.mediaPlaceholder(photos.length, hasVideo);

  const addTileClass = cn(
    "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full border border-dashed border-border",
    "px-3 text-sm font-medium text-foreground-secondary",
    "transition-colors duration-(--duration-fast) hover:border-brand hover:bg-surface-subtle",
    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
    "disabled:pointer-events-none disabled:opacity-45",
  );

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      size="tall"
      keyboardAware
      title={
        isQuestion
          ? COPY.composer.compose.questionTitle
          : isText
            ? COPY.composer.compose.textTitle
            : COPY.composer.compose.mediaTitle
      }
      // EN PAPEL NO EXISTE: es la hoja donde se COMPONE una publicación, un
      // overlay modal sobre toda la página. Además escribe tinta `on-media`
      // (chip de duración del video, botón "Quitar", la encuesta de la vista
      // previa), que es clara por definición — 1.00:1 sobre papel blanco si su
      // relleno no se imprime (ver src/test/print-contract.test.ts). Mismo
      // criterio que el visor de medios y la hoja de comentarios: el panel
      // entero se esconde. Sin efecto en pantalla (la regla es @media print).
      className="cl-print-hide"
      // `flex-1 min-h-0`: el cuerpo tiene que ESTIRARSE hasta el alto de la hoja
      // para que el pie quede anclado abajo; sin eso se encoge al contenido y el
      // botón de publicar queda flotando a media pantalla.
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
    >
      {/* `flex flex-col`: la vista previa tiene que poder CEDER alto (ver
          PreviewFrame). Todo lo demás va `shrink-0` — el campo de texto y el
          pie no se achican para hacerle lugar a una maqueta. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-4 pt-3">
        {isQuestion ? (
          <>
            {/* La pregunta ya se ve como va a salir: mismo componente que el
                feed, en modo vista previa (sin toque, sin navegación). */}
            <p className="mb-2 shrink-0 text-xs font-medium uppercase tracking-wider text-foreground-muted">
              {COPY.composer.compose.previewLabel}
            </p>
            {trimmed.length > 0 ? (
              <PreviewFrame>
                <QuestionBanner
                  preview
                  postId={previewId}
                  question={body}
                  footer={pollEnabled ? <PollPreview /> : undefined}
                />
              </PreviewFrame>
            ) : (
              <PreviewPlaceholder label={COPY.composer.compose.questionPlaceholder} />
            )}
          </>
        ) : isText ? (
          <>
            {/* Mismo principio que la pregunta: el texto ya se ve como va a
                salir, sin encuesta debajo (kind='text' nunca la lleva). */}
            <p className="mb-2 shrink-0 text-xs font-medium uppercase tracking-wider text-foreground-muted">
              {COPY.composer.compose.previewLabel}
            </p>
            {trimmed.length > 0 ? (
              <PreviewFrame>
                <TextBanner preview postId={previewId} text={body} />
              </PreviewFrame>
            ) : (
              <PreviewPlaceholder label={COPY.composer.compose.textPlaceholder} />
            )}
          </>
        ) : (
          <div className="shrink-0">
            {/* El medio elegido, protagonista: primero el que abre la
                publicación, el resto en una tira debajo. */}
            {media.length > 0 && (
              // `items-start`: sin esto el stretch del flex estira las
              // miniaturas chicas al alto de la primera y les rompe el cuadrado.
              <ul className="flex items-start gap-2 overflow-x-auto pb-1">
                {media.map((item, index) => (
                  <li
                    key={item.id}
                    className={cn(
                      "relative shrink-0 overflow-hidden rounded-xl bg-surface-subtle",
                      index === 0 ? "aspect-[4/5] w-40" : "aspect-square w-20",
                    )}
                  >
                    {item.kind === "photo" ? (
                      // eslint-disable-next-line @next/next/no-img-element -- preview local (blob:)
                      <img
                        src={item.preview}
                        alt=""
                        className="absolute inset-0 size-full object-cover"
                      />
                    ) : (
                      <>
                        <video
                          src={item.preview}
                          muted
                          playsInline
                          preload="metadata"
                          className="absolute inset-0 size-full object-cover"
                        />
                        {/* La DURACIÓN medida, no la palabra "Video": es el
                            dato que importa cuando el tope son 90 s, y ya lo
                            tenemos —se midió antes de aceptar el archivo. */}
                        <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-media-scrim px-2 py-0.5 text-xs font-semibold text-on-media">
                          <VideoCamera size={12} weight="fill" aria-hidden="true" />
                          {formatDuration(item.durationSeconds) ?? COPY.composer.videoChip}
                        </span>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => onRemoveMedia(item.id)}
                      disabled={isPending}
                      aria-label={
                        item.kind === "photo"
                          ? `${COPY.composer.removePhoto} ${index + 1}`
                          : COPY.composer.removeVideo
                      }
                      // Área táctil de 44px con el círculo visible de 36: en una
                      // miniatura de 80px un botón de 44 se come media foto, pero
                      // el dedo necesita los 44 igual. Se separan las dos cosas.
                      className={cn(
                        "absolute right-0 top-0 flex size-11 items-center justify-center rounded-full",
                        "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.92]",
                        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-on-media/60",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="flex size-9 items-center justify-center rounded-full bg-media-scrim text-on-media"
                      >
                        <X size={15} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-2 flex items-center gap-2">
              {canAddPhoto && (
                <button
                  type="button"
                  onClick={onAddPhotos}
                  disabled={isPending}
                  className={addTileClass}
                >
                  <Plus size={15} aria-hidden="true" />
                  {COPY.composer.addMorePhotos}
                </button>
              )}
              {canAddVideo && (
                <button
                  type="button"
                  onClick={onAddVideo}
                  disabled={isPending}
                  className={addTileClass}
                >
                  <VideoCamera size={15} aria-hidden="true" />
                  {COPY.composer.addVideo}
                </button>
              )}
            </div>
            {media.length > 0 && (
              <p className="mt-2 text-xs text-foreground-muted">
                {COPY.composer.compose.mediaCount(photos.length, hasVideo)}
              </p>
            )}

            {/* Midiendo el archivo recién elegido: es una espera corta pero
                REAL (el navegador baja la cabecera del contenedor), y sin aviso
                parecería que el botón no hizo nada. */}
            {measuringVideo && (
              <p role="status" className="mt-2 text-xs font-medium text-foreground-secondary">
                {COPY.composer.videoMeasuring}
              </p>
            )}

            {/* CATEGORÍA DE VIDEOS CORTOS (0046). Sólo aparece cuando hay un
                video: en una publicación de fotos no significa nada, y la base
                la rechaza sin video. Radios reales (no botones con aria): dentro
                de una hoja con trampa de foco, las flechas del teclado tienen
                que moverse entre opciones sin que lo implementemos a mano. */}
            {hasVideo && (
              <fieldset className="mt-4" disabled={isPending}>
                <legend className="text-sm font-semibold text-foreground">
                  {COPY.composer.compose.videoCategoryLabel}
                </legend>
                <p className="mt-0.5 text-xs text-foreground-secondary">
                  {COPY.composer.compose.videoCategoryHint}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {VIDEO_CATEGORY_ORDER.map((category) => (
                    <label key={category} className="cursor-pointer">
                      <input
                        type="radio"
                        name="composer-video-category"
                        value={category}
                        checked={videoCategory === category}
                        onChange={() => onVideoCategoryChange(category)}
                        className="peer sr-only"
                      />
                      <span
                        className={cn(
                          "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium",
                          "border-border bg-surface text-foreground-secondary",
                          "transition-colors duration-(--duration-fast)",
                          "hover:bg-surface-hover",
                          // El estado seleccionado se lee por relleno Y por
                          // peso, no sólo por color.
                          "peer-checked:border-brand peer-checked:bg-brand-tint",
                          "peer-checked:font-semibold peer-checked:text-brand-ink",
                          "peer-focus-visible:outline-none peer-focus-visible:ring-[3px] peer-focus-visible:ring-focus-ring",
                          "peer-disabled:opacity-45",
                        )}
                      >
                        {VIDEO_CATEGORY_LABELS[category]}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
        )}

        <label htmlFor="composer-sheet-body" className="sr-only">
          {bodyPlaceholder}
        </label>
        <textarea
          id="composer-sheet-body"
          rows={3}
          maxLength={MAX_LENGTH}
          value={body}
          disabled={isPending}
          onChange={(event) => onBodyChange(event.target.value)}
          placeholder={bodyPlaceholder}
          className={cn(
            "mt-3 min-h-24 w-full shrink-0 resize-none rounded-lg border border-border bg-surface p-3",
            "text-base text-foreground placeholder:text-foreground-muted",
            "focus:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            "disabled:opacity-60",
          )}
        />

        {isQuestion && (
          <div className="mt-3 shrink-0">
            <PollSwitch
              checked={pollEnabled}
              onChange={onPollChange}
              disabled={isPending}
            />
          </div>
        )}

        {/* Progreso REAL de la subida del video (XHR), no una barra decorativa. */}
        {uploadPct !== null && (
          <div className="mt-3 shrink-0" role="status">
            <p className="text-xs font-medium text-foreground-secondary">
              {COPY.composer.videoUploading(uploadPct)}
            </p>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-subtle">
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-(--duration-fast)"
                style={{ width: `${uploadPct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Publicar SIEMPRE a la vista: el pie no scrollea con el contenido. */}
      <div className="flex shrink-0 items-center gap-2 border-t border-border-subtle px-5 pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11"
          onClick={onClose}
          disabled={isPending}
        >
          {COPY.composer.compose.close}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="md"
          className="ml-auto"
          onClick={onPublish}
          disabled={!canPublish}
          loading={isPending}
        >
          {isPending
            ? COPY.composer.publishing
            : isQuestion
              ? COPY.composer.compose.publishQuestion
              : COPY.composer.publish}
        </Button>
      </div>
    </BottomSheet>
  );
}
