"use client";

import { ArrowClockwise } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";

/**
 * Botón "Reintentar" de la página /~offline (módulo PWA).
 * Recarga la navegación: si volvió la señal, el SW deja pasar la request
 * real; si no, vuelve a caer en el fallback sin romper nada.
 */
export function RetryButton({ label }: { label: string }) {
  return (
    <Button
      variant="primary"
      size="lg"
      onClick={() => window.location.reload()}
    >
      <ArrowClockwise size={20} aria-hidden="true" />
      {label}
    </Button>
  );
}
