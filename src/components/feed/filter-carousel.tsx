"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PHOTO_FILTER_ID,
  MIN_PHOTO_FILTER_INTENSITY,
  PHOTO_FILTERS,
  clampFilterIntensity,
  resolvePhotoFilterCss,
  type PhotoFilterId,
} from "@/lib/media/photo-filters";
import { makePreviewThumb } from "@/lib/media/preview-thumb";
import { COPY } from "./copy";

/**
 * EL SELECTOR DE FILTROS — la foto de la persona, 16 veces, en un carrusel.
 *
 * POR QUÉ MINIATURAS Y NO PASTILLAS DE TEXTO. "Súper 8" no significa nada
 * hasta que se ve encima de TU foto. Cada chip es la foto real ya filtrada, así
 * que elegir es reconocer, no adivinar y probar. Es la única razón por la que
 * un catálogo de 16 no abruma: no hay 16 palabras que leer, hay 16 fotos que
 * mirar de reojo.
 *
 * LA MINIATURA SE CONSTRUYE UNA VEZ. Las 16 comparten un `data:` de 216 px
 * (`makePreviewThumb`): apuntar las 16 al `blob:` original obliga al navegador
 * a rasterizar una foto de 12 megapíxeles dieciséis veces para pintar cuadritos
 * de 72.
 *
 * NO HAY ESTADO DE CARGA, y es a propósito. La optimización es una MEJORA
 * PROGRESIVA: los chips se pintan desde el primer frame con la vista previa
 * original y cambian a la miniatura chica cuando está lista. Un esqueleto acá
 * sería peor de dos maneras — retrasaría un carrusel que ya se puede usar, y
 * dejaría la pantalla trabada para siempre el día que la imagen no cargue
 * (un `blob:` revocado no dispara `onload` NI `onerror`).
 *
 * INTENSIDAD. El preset es el 100%; el deslizador lo interpola hacia la foto
 * original (`scaleFilterCss`). Aparece SOLO cuando hay un filtro elegido:
 * mostrarlo con "Original" seleccionado sería un control que no controla nada.
 * Y comparte forma con el recorte de música (`music-picker.tsx`) a propósito —
 * en la misma hoja, dos deslizadores no pueden verse como dos productos.
 *
 * RADIOS DE VERDAD (`input type="radio"`), no botones con `aria-pressed`: en un
 * grupo de 16 dentro de una trampa de foco, las flechas del teclado tienen que
 * moverse entre opciones sin que lo implementemos a mano, y el lector de
 * pantalla tiene que decir "3 de 16".
 */

export interface FilterCarouselProps {
  /** Vista previa (blob:) de la foto que se está editando. */
  preview: string;
  filterId: PhotoFilterId;
  /** 0–1. El preset entero es 1. */
  intensity: number;
  onFilterChange: (id: PhotoFilterId) => void;
  onIntensityChange: (value: number) => void;
  disabled?: boolean;
}

export function FilterCarousel({
  preview,
  filterId,
  intensity,
  onFilterChange,
  onIntensityChange,
  disabled = false,
}: FilterCarouselProps) {
  const reduce = usePrefersReducedMotion();
  const groupName = useId();
  const rangeId = useId();
  /** La miniatura ya construida: el `data:` chico, o la URL original si falló. */
  const [thumbSrc, setThumbSrc] = useState<string | null>(null);
  /** Cada chip, para poder centrar el elegido sin buscarlo en el DOM. */
  const chipsRef = useRef(new Map<string, HTMLElement>());

  /**
   * Cambiar de foto vuelve a "construyendo" DURANTE EL RENDER (el patrón que la
   * doc de React llama "adjusting state when a prop changes"), no en un efecto:
   * hacerlo en el efecto encadenaría un render de más y pintaría un frame con
   * la miniatura de la foto anterior filtrada — que es exactamente la clase de
   * mentira que este componente existe para no cometer.
   */
  const [thumbFor, setThumbFor] = useState(preview);
  if (preview !== thumbFor) {
    setThumbFor(preview);
    setThumbSrc(null);
  }

  // Construir la miniatura es trabajo sobre un sistema externo (canvas) que
  // depende de una prop: exactamente para lo que sirve un efecto. `cancelled`
  // evita pintar el resultado de una foto que ya no es la que se está editando.
  useEffect(() => {
    let cancelled = false;
    void makePreviewThumb(preview).then((small) => {
      if (!cancelled) setThumbSrc(small ?? preview);
    });
    return () => {
      cancelled = true;
    };
  }, [preview]);

  /**
   * El chip elegido siempre a la vista. Sin esto, abrir el editor de una foto
   * que ya tenía "Polaroid" (el último de la lista) mostraría el carrusel en el
   * arranque, con el filtro activo fuera de pantalla.
   */
  useEffect(() => {
    const chip = chipsRef.current.get(filterId);
    // `scrollIntoView` no existe en jsdom ni en algún navegador viejo: centrar
    // el chip es una cortesía, y una cortesía no puede tirar abajo el editor.
    if (typeof chip?.scrollIntoView !== "function") return;
    chip.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [filterId, reduce]);

  const active = PHOTO_FILTERS.find((filter) => filter.id === filterId) ?? PHOTO_FILTERS[0];
  const hasFilter = active.id !== DEFAULT_PHOTO_FILTER_ID;
  const percent = Math.round(clampFilterIntensity(intensity) * 100);
  const C = COPY.composer.photoEditor;

  return (
    <section aria-label={C.filtersLabel} className="shrink-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        {/* El título VISIBLE se fue el 2026-08-26: desde que el editor tiene
            pestañas, la que está activa ya dice "Filtros" justo arriba, y
            repetirlo acá era la misma palabra dos veces en dos centímetros. El
            `aria-label` del `<section>` y el del `radiogroup` siguen nombrando
            el grupo para quien no ve las pestañas. Queda el renglón porque el
            nombre del filtro elegido vive a su derecha. */}
        <span aria-hidden="true" />
        {/* El nombre del elegido, ahí arriba: el rótulo del chip mide 11px y
            está pensado para reconocerse de reojo, no para leerse a fondo. */}
        <p
          role="status"
          className="min-w-0 truncate text-xs font-semibold text-foreground-secondary"
        >
          {active.label}
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label={C.filtersLabel}
        className={cn(
          "-mx-5 flex gap-2.5 overflow-x-auto scrollbar-none px-5 pb-1",
          // Snap suave: el dedo se detiene sobre un chip entero, nunca a
          // mitad de camino entre dos.
          "snap-x scroll-px-5",
          // El degradado en los bordes dice "hay más" sin ocupar lugar ni
          // depender del color del papel de la hoja.
          "[mask-image:linear-gradient(to_right,transparent_0,#000_20px,#000_calc(100%-20px),transparent_100%)]",
        )}
      >
        {PHOTO_FILTERS.map((option) => {
          const selected = option.id === filterId;
          return (
            <label
              key={option.id}
              ref={(node) => {
                if (node) chipsRef.current.set(option.id, node);
                else chipsRef.current.delete(option.id);
              }}
              className={cn(
                "group flex shrink-0 snap-start cursor-pointer flex-col items-center gap-1.5 pt-0.5",
                disabled && "pointer-events-none opacity-45",
              )}
            >
              <input
                type="radio"
                name={groupName}
                value={option.id}
                checked={selected}
                disabled={disabled}
                onChange={() => onFilterChange(option.id)}
                className="peer sr-only"
              />

              {/*
               * DOBLE BISEL: una bandeja exterior con su borde fino y, adentro,
               * la foto con su propio radio concéntrico. Una miniatura apoyada
               * plana sobre la hoja se lee como una imagen suelta; así se lee
               * como una pieza montada, y el estado elegido tiene DÓNDE
               * mostrarse sin taparle un píxel a la foto.
               */}
              <span
                className={cn(
                  "block rounded-[18px] p-[3px] ring-1 ring-inset",
                  "ring-border-subtle",
                  "transition-[transform,box-shadow,background-color] duration-(--duration-fast)",
                  "ease-(--ease-spring)",
                  "peer-checked:bg-brand peer-checked:ring-brand",
                  "peer-checked:shadow-[0_2px_10px_-2px_var(--color-brand)]",
                  !reduce && "peer-checked:scale-[1.04] group-active:scale-[0.95]",
                  "peer-focus-visible:outline-none peer-focus-visible:ring-[3px] peer-focus-visible:ring-focus-ring",
                )}
              >
                <span className="block size-[68px] overflow-hidden rounded-[15px] bg-surface-subtle">
                  {/* eslint-disable-next-line @next/next/no-img-element -- miniatura local (data:/blob:) */}
                  <img
                    src={thumbSrc ?? preview}
                    alt=""
                    draggable={false}
                    style={{ filter: resolvePhotoFilterCss(option.id, intensity) || undefined }}
                    className="size-full object-cover"
                  />
                </span>
              </span>

              <span
                className={cn(
                  "max-w-[76px] truncate text-[11px] leading-tight text-foreground-secondary",
                  "transition-colors duration-(--duration-fast)",
                  "peer-checked:font-semibold peer-checked:text-brand-ink",
                )}
              >
                {option.label}
              </span>
            </label>
          );
        })}
      </div>

      {/*
       * Sin animación de entrada: el control aparece porque la persona ACABA de
       * tocar un filtro, y una respuesta inmediata a un toque se siente mejor
       * que una que llega 200 ms tarde. Lo que sí se anima es el resultado —la
       * foto de arriba cambia con el deslizador— que es donde está el sentido.
       */}
      {hasFilter && (
        <div className="mt-3">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={rangeId} className="text-xs font-medium text-foreground-secondary">
              {C.intensityLabel}
            </label>
            <span className="text-xs font-semibold tabular-nums text-foreground-secondary">
              {C.intensityValue(percent)}
            </span>
          </div>
          <input
            id={rangeId}
            type="range"
            min={Math.round(MIN_PHOTO_FILTER_INTENSITY * 100)}
            max={100}
            step={5}
            value={percent}
            disabled={disabled}
            onChange={(event) => onIntensityChange(Number(event.target.value) / 100)}
            aria-valuetext={C.intensityValue(percent)}
            className={cn(
              // `h-11` es el blanco táctil; la barra visible la dibuja el track.
              // Mismos valores que el recorte de música: un solo deslizador en
              // toda la app.
              "mt-1 h-11 w-full cursor-pointer appearance-none bg-transparent",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              "disabled:cursor-not-allowed disabled:opacity-45",
              "[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-surface-subtle",
              "[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-surface-subtle",
              "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:-mt-[7px] [&::-webkit-slider-thumb]:size-5",
              "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-brand [&::-webkit-slider-thumb]:shadow-xs",
              "[&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-brand",
            )}
          />
        </div>
      )}
    </section>
  );
}

