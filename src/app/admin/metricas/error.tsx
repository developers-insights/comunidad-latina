"use client";

import { useEffect } from "react";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { COPY } from "@/lib/metrics/copy";

/**
 * Error boundary del tablero.
 *
 * Muestra un mensaje humano y un botón que REINTENTA de verdad (reset() vuelve
 * a renderizar el segmento, no recarga la página entera). El detalle técnico va
 * a la consola del servidor, nunca a pantalla: el mensaje de una RPC puede
 * mencionar roles o ids de comunidades y eso no se le muestra a nadie.
 */
export default function MetricasError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[metricas] la pantalla falló", { digest: error.digest });
  }, [error]);

  return (
    <div
      role="alert"
      className="mx-auto flex w-full max-w-sm flex-col items-center gap-4 px-6 py-12 text-center"
    >
      <WarningCircle size={40} className="text-warning-ink" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-lg font-semibold text-foreground">{COPY.errorTitle}</h2>
        <p className="text-sm text-foreground-secondary">{COPY.errorMessage}</p>
      </div>
      <Button onClick={reset}>{COPY.errorRetry}</Button>
    </div>
  );
}
