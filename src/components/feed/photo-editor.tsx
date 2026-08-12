"use client";

import { useState } from "react";
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
  PHOTO_FILTERS,
  getPhotoFilter,
  type PhotoFilterId,
} from "@/lib/media/photo-filters";
import {
  CAPTION_MAX_LENGTH,
  type CaptionBackground,
  type CaptionPosition,
} from "@/lib/media/bake-photo";
import { COPY } from "./copy";

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
  captionText: string;
  captionPosition: CaptionPosition;
  captionBackground: CaptionBackground;
}

export const DEFAULT_PHOTO_EDIT: PhotoEdit = {
  filterId: DEFAULT_PHOTO_FILTER_ID,
  captionText: "",
  captionPosition: "bottom",
  captionBackground: "solid",
};

export interface PhotoEditorProps {
  /** Vista previa (blob:) de la foto que se está editando. */
  preview: string;
  /** Edición ya guardada — el borrador arranca SIEMPRE desde acá. */
  edit: PhotoEdit;
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

export function PhotoEditor({ preview, edit, onCancel, onSave }: PhotoEditorProps) {
  const [draft, setDraft] = useState<PhotoEdit>(edit);
  const [textPanelOpen, setTextPanelOpen] = useState(edit.captionText.trim().length > 0);

  function handleSave() {
    onSave({ ...draft, captionText: draft.captionText.trim() });
  }

  const filter = getPhotoFilter(draft.filterId);
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
          {/* eslint-disable-next-line @next/next/no-img-element -- preview local (blob:) */}
          <img
            src={preview}
            alt=""
            style={{ filter: filter.css || undefined }}
            className="absolute inset-0 size-full object-contain"
          />
          {draft.captionText.trim() && (
            <PhotoCaptionOverlay
              text={draft.captionText}
              position={draft.captionPosition}
              background={draft.captionBackground}
              textClassName="text-lg"
            />
          )}
        </div>

        {/* Filtros: miniaturas REALES de esta foto, no swatches genéricos. */}
        <div className="mt-4 shrink-0">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-foreground-muted">
            {COPY.composer.photoEditor.filtersLabel}
          </p>
          <div className="flex gap-3 overflow-x-auto scrollbar-none pb-1">
            {PHOTO_FILTERS.map((option) => {
              const active = option.id === draft.filterId;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, filterId: option.id }))}
                  aria-pressed={active}
                  className={cn(
                    "flex shrink-0 flex-col items-center gap-1.5 rounded-lg p-0.5",
                    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                  )}
                >
                  <span
                    className={cn(
                      "block size-16 overflow-hidden rounded-lg border-2 transition-colors duration-(--duration-fast)",
                      active ? "border-brand" : "border-transparent",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- preview local (blob:) */}
                    <img
                      src={preview}
                      alt=""
                      style={{ filter: option.css || undefined }}
                      className="size-full object-cover"
                    />
                  </span>
                  <span
                    className={cn(
                      "text-xs",
                      active ? "font-semibold text-brand-ink" : "text-foreground-secondary",
                    )}
                  >
                    {option.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Texto sobre la foto: revelado progresivo — el botón abre el panel
            en vez de saturar la pantalla de controles de entrada. */}
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
