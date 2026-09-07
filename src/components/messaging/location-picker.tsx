"use client";

import { useEffect, useState } from "react";
import { MapPin, NavigationArrow } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Spinner } from "@/components/ui/spinner";
import { COPY_COMPOSER } from "./copy-composer";

/**
 * MANDAR LA UBICACIÓN — un punto, no un rastreo.
 *
 * ─── SIN MAPA, Y NO POR PEREZA ──────────────────────────────────────────────
 * El CSP de este sitio (`next.config.ts`) no permite `img-src` ni `connect-src`
 * de ningún proveedor de mapas, y abrirlo para pintar una miniatura significa
 * que cada ubicación compartida le avisa a un tercero que alguien la miró,
 * junto con la coordenada. Un punto con su nombre alcanza para encontrarse, y
 * la burbuja del mensaje puede ofrecer "abrir en el mapa" con el enlace
 * `geo:`/Maps del propio teléfono cuando alguien lo quiera.
 *
 * ─── EL PERMISO SE PIDE AL TOCAR EL BOTÓN ───────────────────────────────────
 * `getCurrentPosition` corre desde el gesto. Y el error se traduce ACÁ a un
 * mensaje que dice qué pasó y qué hacer, en vez de dejar salir el código 1/2/3
 * del navegador — mismo criterio que `components/zona/zona-ubicacion.tsx`.
 */

type Estado =
  | { fase: "listo" }
  | { fase: "buscando" }
  | { fase: "encontrado"; lat: number; lng: number }
  | { fase: "error"; mensaje: string };

const TIMEOUT_MS = 10_000;
/** Cinco minutos: nadie se movió tanto, y así no se enciende el GPS de nuevo. */
const MAX_AGE_MS = 5 * 60 * 1000;

export interface LocationPickerProps {
  open: boolean;
  onClose: () => void;
  onEnviar: (punto: { lat: number; lng: number; etiqueta?: string }) => void;
}

export function LocationPicker({ open, onClose, onEnviar }: LocationPickerProps) {
  const [estado, setEstado] = useState<Estado>({ fase: "listo" });
  const [etiqueta, setEtiqueta] = useState("");

  // Diferido un frame: un `setState` sincrónico dentro de un efecto encadena
  // renders (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (open) return;
    const cuadro = requestAnimationFrame(() => {
      setEstado({ fase: "listo" });
      setEtiqueta("");
    });
    return () => cancelAnimationFrame(cuadro);
  }, [open]);

  function ubicar() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setEstado({ fase: "error", mensaje: COPY_COMPOSER.ubicacion.sinSoporte });
      return;
    }
    setEstado({ fase: "buscando" });
    navigator.geolocation.getCurrentPosition(
      (posicion) => {
        setEstado({
          fase: "encontrado",
          lat: posicion.coords.latitude,
          lng: posicion.coords.longitude,
        });
      },
      (error) => {
        const mensaje =
          error.code === error.PERMISSION_DENIED
            ? COPY_COMPOSER.ubicacion.denegado
            : error.code === error.TIMEOUT
              ? COPY_COMPOSER.ubicacion.demoro
              : COPY_COMPOSER.ubicacion.noDisponible;
        setEstado({ fase: "error", mensaje });
      },
      { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: MAX_AGE_MS },
    );
  }

  function enviar() {
    if (estado.fase !== "encontrado") return;
    const limpia = etiqueta.trim();
    onEnviar({
      lat: estado.lat,
      lng: estado.lng,
      ...(limpia ? { etiqueta: limpia } : {}),
    });
    onClose();
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={COPY_COMPOSER.ubicacion.titulo}
      keyboardAware
    >
      <p className="text-sm text-foreground-muted">{COPY_COMPOSER.ubicacion.ayuda}</p>

      <div
        className={cn(
          // `cl-print-hide`: el azulejo verde lleva `text-on-success`, que sin
          // su relleno es invisible en papel, y no es un <button>.
          "cl-print-hide mt-4 flex items-center gap-3 rounded-2xl px-4 py-3.5",
          "ring-1 ring-inset ring-border-subtle",
          estado.fase === "encontrado" ? "bg-success-bg" : "bg-surface-subtle",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-[14px]",
            estado.fase === "encontrado"
              ? "bg-success text-on-success"
              : "bg-surface text-foreground-muted",
          )}
        >
          {estado.fase === "buscando" ? (
            <Spinner size={18} />
          ) : (
            <MapPin size={20} weight="fill" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          {estado.fase === "encontrado" ? (
            <>
              <p className="text-sm font-semibold text-success-ink">
                {COPY_COMPOSER.ubicacion.listo}
              </p>
              <p className="font-mono text-xs tabular-nums text-success-ink/80">
                {estado.lat.toFixed(4)}, {estado.lng.toFixed(4)}
              </p>
            </>
          ) : estado.fase === "buscando" ? (
            <p className="text-sm text-foreground-secondary">
              {COPY_COMPOSER.ubicacion.buscando}
            </p>
          ) : estado.fase === "error" ? (
            <p role="alert" className="text-sm text-foreground-secondary">
              {estado.mensaje}
            </p>
          ) : (
            <p className="text-sm text-foreground-secondary">
              {COPY_COMPOSER.ubicacion.pedir}
            </p>
          )}
        </div>
        {estado.fase !== "buscando" && (
          <button
            type="button"
            onClick={ubicar}
            aria-label={COPY_COMPOSER.ubicacion.pedir}
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-full",
              "bg-brand text-brand-foreground shadow-xs",
              "transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring)",
              "hover:bg-brand-hover active:scale-[0.92]",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              "motion-reduce:transition-none motion-reduce:active:scale-100",
            )}
          >
            <NavigationArrow size={18} weight="fill" aria-hidden="true" />
          </button>
        )}
      </div>

      {estado.fase === "encontrado" && (
        <>
          <label
            htmlFor="ubicacion-etiqueta"
            className="mt-4 block text-sm font-medium text-foreground"
          >
            {COPY_COMPOSER.ubicacion.etiqueta}
          </label>
          <input
            id="ubicacion-etiqueta"
            type="text"
            value={etiqueta}
            maxLength={120}
            placeholder={COPY_COMPOSER.ubicacion.etiquetaPlaceholder}
            onChange={(event) => setEtiqueta(event.target.value)}
            className="mt-1.5 min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground placeholder:text-placeholder focus:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          />
          <button
            type="button"
            onClick={enviar}
            className="mt-4 min-h-11 w-full rounded-full bg-brand px-6 text-sm font-semibold text-brand-foreground shadow-xs transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring) hover:bg-brand-hover active:scale-[0.98] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            {COPY_COMPOSER.ubicacion.enviar}
          </button>
        </>
      )}
    </BottomSheet>
  );
}
