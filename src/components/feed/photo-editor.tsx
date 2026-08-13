"use client";

import { useEffect, useState } from "react";
import {
  AlignBottom,
  AlignCenterVertical,
  AlignTop,
  Check,
  TextT,
} from "@phosphor-icons/react/dist/ssr";
import { Button, Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PHOTO_FILTER_ID,
  DEFAULT_PHOTO_FILTER_INTENSITY,
  resolvePhotoFilterCss,
  type PhotoFilterId,
} from "@/lib/media/photo-filters";
import {
  CAPTION_MAX_LENGTH,
  type CaptionBackground,
  type CaptionPosition,
} from "@/lib/media/bake-photo";
import { NEUTRAL_THUMB, capturePosterFrame } from "@/lib/media/video-poster";
import { FilterCarousel } from "./filter-carousel";
import { COPY, VIDEO_EDITOR_COPY } from "./copy";

/**
 * EDICIÓN DE UNA FOTO (§2 filtros / §3 texto del pedido de Manuel).
 *
 * Se abre DENTRO de la hoja ya abierta de `ComposerSheet` (no es un
 * `BottomSheet` propio, es un panel que reemplaza su contenido): dos hojas
 * apiladas compartirían el mismo `useFocusTrap` global por `document`, y su
 * Escape/scrim no distinguen "cerrar el editor" de "cerrar todo el
 * compositor" (`stopPropagation` no alcanza entre dos listeners del mismo
 * `document`, hace falta `stopImmediatePropagation`, y esos hooks no son
 * nuestros para tocar). `ComposerSheet` decide cuándo mostrar este panel
 * dentro de SU MISMO `BottomSheet`, así que Escape/scrim/arrastre siempre
 * hacen lo mismo: salir de a un paso.
 *
 * Vista previa en vivo: el filtro se aplica con `filter` de CSS (gratis, sin
 * canvas) y el texto usa el MISMO componente (`PhotoCaptionOverlay`) que la
 * miniatura de la grilla — lo que se ve acá es, con la salvedad de la
 * compresión, lo que `bake-photo.ts` va a quemar en los píxeles al publicar.
 *
 * "Cancelar" descarta el borrador; sólo "Listo" confirma. Por eso el estado
 * vive LOCAL (`draft`) y no escribe en `PostComposer` hasta `onSave`.
 */

export interface PhotoEdit {
  filterId: PhotoFilterId;
  /**
   * Cuánto del preset se aplica (0–1). Es un multiplicador sobre el MISMO
   * string de `filter`, no otro preset: ver `scaleFilterCss`. Vive acá y no en
   * el catálogo porque es una decisión POR FOTO — la misma "Vintage" al 40% en
   * una y al 100% en otra.
   */
  filterIntensity: number;
  captionText: string;
  captionPosition: CaptionPosition;
  captionBackground: CaptionBackground;
}

export const DEFAULT_PHOTO_EDIT: PhotoEdit = {
  filterId: DEFAULT_PHOTO_FILTER_ID,
  filterIntensity: DEFAULT_PHOTO_FILTER_INTENSITY,
  captionText: "",
  captionPosition: "bottom",
  captionBackground: "solid",
};

/**
 * El `filter` de una edición, resuelto. Lo llaman la vista previa grande, la
 * miniatura de la grilla (`composer-sheet.tsx`) y el horneado
 * (`post-composer.tsx`): un solo lugar donde el preset y su intensidad se
 * combinan, para que los tres no puedan discrepar.
 *
 * Tolera `undefined` (foto que nunca pasó por el editor) y ediciones viejas sin
 * `filterIntensity`, que se leen como el preset entero.
 */
export function photoEditFilterCss(edit: PhotoEdit | undefined | null): string {
  if (!edit) return "";
  return resolvePhotoFilterCss(
    edit.filterId,
    edit.filterIntensity ?? DEFAULT_PHOTO_FILTER_INTENSITY,
  );
}

export interface PhotoEditorProps {
  /** Vista previa (blob:) del medio que se está editando. */
  preview: string;
  /** Edición ya guardada — el borrador arranca SIEMPRE desde acá. */
  edit: PhotoEdit;
  /**
   * QUÉ SE ESTÁ EDITANDO. El mismo panel sirve para los dos medios —mismo
   * catálogo de 16, mismo carrusel, mismo deslizador de intensidad— pero no
   * ofrecen lo mismo, y la diferencia no es cosmética:
   *
   *  · FOTO: el filtro y el texto se QUEMAN en los píxeles al publicar
   *    (`bake-photo.ts`). El archivo que se sube ya es la foto editada.
   *  · VIDEO: nada se quema. El filtro se guarda como metadato (0104) y se
   *    aplica al reproducir. Por eso acá NO hay panel de texto: escribir sobre
   *    un video pediría hornearlo —re-codificar en tiempo real, romper la
   *    subida directa al bucket y cambiarle la huella a Content Integrity—,
   *    que es exactamente lo que esta decisión evita. Ofrecer un control que
   *    no podemos cumplir sería peor que no ofrecerlo.
   */
  kind?: "photo" | "video";
  onCancel: () => void;
  onSave: (edit: PhotoEdit) => void;
}

const POSITION_OPTIONS: Array<{
  value: CaptionPosition;
  label: string;
  icon: React.ReactNode;
}> = [
  { value: "top", label: COPY.composer.photoEditor.positionTop, icon: <AlignTop size={16} aria-hidden="true" /> },
  {
    value: "center",
    label: COPY.composer.photoEditor.positionCenter,
    icon: <AlignCenterVertical size={16} aria-hidden="true" />,
  },
  {
    value: "bottom",
    label: COPY.composer.photoEditor.positionBottom,
    icon: <AlignBottom size={16} aria-hidden="true" />,
  },
];

const BACKGROUND_OPTIONS: Array<[CaptionBackground, string]> = [
  ["solid", COPY.composer.photoEditor.backgroundSolid],
  ["none", COPY.composer.photoEditor.backgroundNone],
];

/** Estilo de botón-pastilla seleccionable, compartido por posición y fondo. */
const optionButtonClass = (active: boolean) =>
  cn(
    "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border text-sm font-medium",
    "transition-colors duration-(--duration-fast)",
    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
    active
      ? "border-brand bg-brand-tint font-semibold text-brand-ink"
      : "border-border bg-surface text-foreground-secondary hover:bg-surface-hover",
  );

export function PhotoEditor({
  preview,
  edit,
  kind = "photo",
  onCancel,
  onSave,
}: PhotoEditorProps) {
  const isVideo = kind === "video";
  const [draft, setDraft] = useState<PhotoEdit>(edit);
  const [textPanelOpen, setTextPanelOpen] = useState(edit.captionText.trim().length > 0);
  /**
   * Un fotograma del video como imagen, para que las 16 miniaturas del carrusel
   * muestren MATERIAL PROPIO en vez de cuadritos genéricos. Pintar el video 16
   * veces no es una opción: serían 16 decodificadores para chips de 72 px.
   *
   * Arranca en el respaldo neutro y no en `null` para que el carrusel se pinte
   * COMPLETO desde el primer frame —con sus nombres y sus tintes— y sólo cambie
   * a la imagen real cuando esté. Misma mejora progresiva que ya usa el
   * carrusel con la miniatura chica de una foto: nada de esqueletos que
   * retrasan un control que ya se puede usar.
   */
  const [videoThumb, setVideoThumb] = useState(NEUTRAL_THUMB);

  useEffect(() => {
    if (!isVideo) return;
    let cancelled = false;
    void capturePosterFrame(preview).then((frame) => {
      if (!cancelled && frame) setVideoThumb(frame);
    });
    return () => {
      cancelled = true;
    };
  }, [isVideo, preview]);

  function handleSave() {
    // Un video nunca lleva texto quemado (ver `kind` en los props): se guarda
    // vacío explícitamente para que un borrador arrastrado no lo cuele.
    onSave({
      ...draft,
      captionText: isVideo ? "" : draft.captionText.trim(),
    });
  }

  const filterCss = photoEditFilterCss(draft);
  const captionLength = draft.captionText.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-4 pt-3">
        {/* Foto grande, filtro y texto en vivo — mismo 4:5 que el resto del
            composer (hero de la grilla, TextBanner/QuestionBanner). */}
        <div
          className="relative mx-auto w-full max-w-sm shrink-0 overflow-hidden rounded-xl bg-surface-subtle"
          style={{ aspectRatio: "4 / 5" }}
        >
          {isVideo ? (
            /* El video REPRODUCIÉNDOSE con el filtro encima: es literalmente lo
               que va a ver la comunidad, porque en el feed el filtro también se
               aplica al pintar y no está quemado en el archivo. Mudo y en bucle
               —esto es una vista previa, no una reproducción— y sin controles
               para que nada compita con los chips de abajo, que es lo que se
               vino a tocar. */
            <video
              src={preview}
              style={{ filter: filterCss || undefined }}
              className="absolute inset-0 size-full object-contain"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
            />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element -- preview local (blob:) */
            <img
              src={preview}
              alt=""
              style={{ filter: filterCss || undefined }}
              className="absolute inset-0 size-full object-contain"
            />
          )}
          {!isVideo && draft.captionText.trim() && (
            <PhotoCaptionOverlay
              text={draft.captionText}
              position={draft.captionPosition}
              background={draft.captionBackground}
              textClassName="text-lg"
            />
          )}
        </div>

        {/* Filtros: miniaturas REALES de este medio, no swatches genéricos. En
            un video son un fotograma suyo (ver `videoThumb`); el catálogo, el
            carrusel y el deslizador son EXACTAMENTE los mismos que en una foto
            — un segundo selector "para video" sería otro catálogo que mantener
            y otra forma de que los dos digan cosas distintas. */}
        <div className="mt-4 shrink-0">
          <FilterCarousel
            preview={isVideo ? videoThumb : preview}
            filterId={draft.filterId}
            intensity={draft.filterIntensity}
            /**
             * Elegir un preset devuelve la intensidad al 100%: si alguien dejó
             * "Vintage" en 30% y salta a "Carbón", lo que quiere ver es Carbón,
             * no un Carbón apagado por una decisión que tomó sobre otro filtro.
             */
            onFilterChange={(id) =>
              setDraft((current) => ({
                ...current,
                filterId: id,
                filterIntensity: DEFAULT_PHOTO_FILTER_INTENSITY,
              }))
            }
            onIntensityChange={(value) =>
              setDraft((current) => ({ ...current, filterIntensity: value }))
            }
          />
        </div>

        {isVideo && (
          /* Por qué esto es instantáneo y por qué el video no se arruina. Es la
             única pregunta que aparece sola al ver un filtro sobre un video
             ("¿me lo va a recomprimir?"), y se contesta antes de que se haga. */
          <p className="mt-3 shrink-0 text-xs leading-relaxed text-foreground-muted">
            {VIDEO_EDITOR_COPY.hint}
          </p>
        )}

        {/* Texto sobre la foto: revelado progresivo — el botón abre el panel
            en vez de saturar la pantalla de controles de entrada. NO existe
            para un video: quemar texto encima pediría re-codificarlo, que es
            justo lo que esta pantalla evita (ver `kind` en los props). */}
        {!isVideo && (
        <div className="mt-4 shrink-0">
          <button
            type="button"
            onClick={() => setTextPanelOpen((value) => !value)}
            aria-expanded={textPanelOpen}
            className={cn(
              "flex min-h-11 items-center gap-2 rounded-full border border-dashed border-border px-4",
              "text-sm font-medium text-foreground-secondary",
              "transition-colors duration-(--duration-fast) hover:border-brand hover:bg-surface-subtle",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            )}
          >
            <TextT size={16} aria-hidden="true" />
            {draft.captionText.trim()
              ? COPY.composer.photoEditor.textButtonActive
              : COPY.composer.photoEditor.textButton}
          </button>

          {textPanelOpen && (
            <div className="mt-3 flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-subtle p-3">
              <div>
                <label htmlFor="photo-editor-caption" className="sr-only">
                  {COPY.composer.photoEditor.textareaLabel}
                </label>
                <Input
                  id="photo-editor-caption"
                  value={draft.captionText}
                  maxLength={CAPTION_MAX_LENGTH}
                  placeholder={COPY.composer.photoEditor.textareaPlaceholder}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, captionText: event.target.value }))
                  }
                />
                <p className="mt-1 text-right text-xs text-foreground-muted">
                  {captionLength}/{CAPTION_MAX_LENGTH}
                </p>
              </div>

              <fieldset>
                <legend className="text-xs font-medium uppercase tracking-wider text-foreground-muted">
                  {COPY.composer.photoEditor.positionLabel}
                </legend>
                <div className="mt-1.5 flex gap-2">
                  {POSITION_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({ ...current, captionPosition: option.value }))
                      }
                      aria-pressed={option.value === draft.captionPosition}
                      className={optionButtonClass(option.value === draft.captionPosition)}
                    >
                      {option.icon}
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-xs font-medium uppercase tracking-wider text-foreground-muted">
                  {COPY.composer.photoEditor.backgroundLabel}
                </legend>
                <div className="mt-1.5 flex gap-2">
                  {BACKGROUND_OPTIONS.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setDraft((current) => ({ ...current, captionBackground: value }))}
                      aria-pressed={value === draft.captionBackground}
                      className={optionButtonClass(value === draft.captionBackground)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>

              {draft.captionText.trim() && (
                <button
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, captionText: "" }))}
                  className="min-h-11 self-start text-xs font-medium text-danger underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
                >
                  {COPY.composer.photoEditor.removeText}
                </button>
              )}
            </div>
          )}
        </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border-subtle px-5 pt-3">
        <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={onCancel}>
          {COPY.composer.photoEditor.cancel}
        </Button>
        <Button type="button" variant="primary" size="md" className="ml-auto" onClick={handleSave}>
          <Check size={16} aria-hidden="true" />
          {COPY.composer.photoEditor.done}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlay del texto — la MISMA pieza para la miniatura de la grilla y la
// vista previa grande de acá. `bake-photo.ts` no la importa (dibuja en canvas
// con su propia lógica de ajuste de línea) pero replica el mismo criterio de
// posición/fondo, así que lo que se ve en la UI es lo que sale publicado.
// ---------------------------------------------------------------------------

export function PhotoCaptionOverlay({
  text,
  position,
  background,
  className,
  textClassName,
}: {
  text: string;
  position: CaptionPosition;
  background: CaptionBackground;
  className?: string;
  textClassName?: string;
}) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-x-0 flex justify-center px-3 py-2",
        position === "top" && "top-0",
        position === "center" && "top-1/2 -translate-y-1/2",
        position === "bottom" && "bottom-0",
        background === "solid" && "bg-media-shade/55",
        className,
      )}
    >
      <span
        className={cn(
          "line-clamp-4 max-w-full break-words text-center font-bold text-on-media",
          background === "none" && "drop-shadow-[0_1px_6px_rgba(0,0,0,0.9)]",
          textClassName ?? "text-sm",
        )}
      >
        {trimmed}
      </span>
    </div>
  );
}
