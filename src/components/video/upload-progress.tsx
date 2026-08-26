"use client";

import { CloudArrowUp, WifiSlash } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { VIDEO_COPY, formatBytesPair } from "./copy";

/**
 * =============================================================================
 * LA PANTALLA QUE MÁS SE MIRA DE TODO ESTE FLUJO
 * =============================================================================
 *
 * Con el camino viejo —60 MB por WiFi— la barra de subida era un detalle: pasaba
 * en dos segundos y nadie la leía. Con Mux se puede subir un video de cientos de
 * megas, y buena parte de la comunidad está en 4G y en teléfonos de gama media.
 * Eso convierte esta caja en una pantalla donde alguien se va a quedar parado
 * varios minutos, y una pantalla donde se espera tiene tres obligaciones:
 *
 *  1. DECIR CUÁNTO VA, DE VERDAD. Porcentaje Y megabytes. El porcentaje solo no
 *     alcanza: 3 % de 20 MB y 3 % de 2 GB se ven idénticos en la pantalla y son
 *     esperas completamente distintas. Los megabytes le ponen escala.
 *  2. DEJAR SALIR. Un botón de cancelar visible desde el primer segundo, con
 *     área táctil de 44 px. Una espera larga sin salida es una trampa, y la
 *     salida no puede estar escondida detrás de "cerrar la hoja".
 *  3. NO PEDIR VIGILANCIA. La subida es resumible de verdad (UpChunk manda el
 *     archivo por pedazos y retoma sola donde iba), así que se dice: podés
 *     seguir usando la app, y si se corta el internet no se pierde nada. Esa
 *     línea es la que le devuelve el teléfono a la persona.
 *
 * ── EL CORTE DE CONEXIÓN SE MUESTRA, NO SE ESCONDE ──────────────────────────
 * Cuando UpChunk avisa que se quedó sin red, la barra se queda quieta. Sin
 * decirlo, eso se lee como "se colgó" y la reacción natural es cerrar y volver a
 * empezar — o sea, tirar los 200 MB que ya habían subido. Con el aviso, la misma
 * barra quieta se lee como lo que es: está esperando, y va a seguir sola.
 */

export interface VideoUploadProgress {
  /** 0–100, tal cual lo reporta UpChunk. */
  pct: number;
  uploadedBytes: number;
  totalBytes: number;
  /** UpChunk detectó que no hay red. La subida está en pausa, no rota. */
  offline: boolean;
}

export interface VideoUploadProgressPanelProps {
  progress: VideoUploadProgress;
  /**
   * Cancelar. Ausente = esta subida no se puede cancelar (el camino viejo por
   * el bucket, que es un único request XHR): ahí no se pinta el botón en vez de
   * pintar uno que no hace nada.
   */
  onCancel?: () => void;
  className?: string;
}

export function VideoUploadProgressPanel({
  progress,
  onCancel,
  className,
}: VideoUploadProgressPanelProps) {
  const pct = Math.max(0, Math.min(100, Math.round(progress.pct)));
  const { offline, uploadedBytes, totalBytes } = progress;
  const hayTamaño = totalBytes > 0;

  return (
    <div className={cn("rounded-lg bg-surface-subtle p-3", className)}>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full",
            offline ? "bg-warning-bg text-warning-ink" : "bg-brand-tint text-brand-ink",
          )}
        >
          {offline ? (
            <WifiSlash size={16} weight="regular" aria-hidden="true" />
          ) : (
            <CloudArrowUp size={16} weight="regular" aria-hidden="true" />
          )}
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {VIDEO_COPY.subida.titulo}
        </p>
        {/*
          `numeric` es la clase de cifras tabulares del repo: sin ella el
          porcentaje baila de ancho en cada actualización y la fila entera
          tiembla durante minutos.
        */}
        <span className="numeric shrink-0 text-sm font-semibold text-foreground-secondary">
          {pct}%
        </span>
      </div>

      {/*
        La barra REAL (el progreso de UpChunk), no una animación decorativa.
        `aria-label` y no un `<label>` suelto: el valor ya viaja en
        `aria-valuenow`, así que un lector de pantalla lee "Subiendo tu video,
        34 %" sin que haya dos textos diciendo lo mismo en pantalla.

        Se anima sólo `width` con la duración corta del sistema: es la única
        propiedad que puede animarse acá sin mentir sobre el avance.
      */}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={VIDEO_COPY.subida.titulo}
        className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-surface"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-(--duration-base) ease-(--ease-out-premium)",
            offline ? "bg-warning" : "bg-brand",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/*
        `flex-wrap`: a 375 px el avance y el botón entran cómodos, pero con una
        traducción más larga o un tamaño de texto grande del sistema la fila se
        parte en dos renglones en vez de empujar la tarjeta y provocar scroll
        horizontal. Es la garantía barata contra el único desborde posible acá.
      */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {hayTamaño && (
          <p className="numeric min-w-0 flex-1 basis-24 truncate text-xs text-foreground-secondary">
            {(() => {
              const par = formatBytesPair(uploadedBytes, totalBytes);
              return VIDEO_COPY.subida.avance(par.subido, par.total);
            })()}
          </p>
        )}
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            // 44 px de área táctil aunque el texto sea chico: es la salida de una
            // espera larga y no puede pedir puntería.
            className="min-h-11 shrink-0"
            onClick={onCancel}
            // Corto en pantalla, completo para quien lo escucha. Ver `copy.ts`.
            aria-label={VIDEO_COPY.subida.cancelar}
          >
            {VIDEO_COPY.subida.cancelarCorto}
          </Button>
        )}
      </div>

      {/*
        La línea que cambia según el estado de la red. `role="status"` para que
        el corte y la vuelta se anuncien solos: son las dos novedades que
        importan durante la espera, y ninguna de las dos tiene un elemento propio
        que la persona pueda ir a buscar.
      */}
      <p
        role="status"
        className={cn(
          "mt-1.5 text-xs leading-relaxed",
          offline ? "font-medium text-warning-ink" : "text-foreground-muted",
        )}
      >
        {offline ? VIDEO_COPY.subida.sinConexion : VIDEO_COPY.subida.tranquilidad}
      </p>
    </div>
  );
}
