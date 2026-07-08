import { ShieldCheck } from "@phosphor-icons/react/dist/ssr";

/**
 * Badge de identidad verificada sobre el avatar (esquina inf-derecha, §3.3).
 * Gramática propia del Escudo: escudo + verde de éxito de marca — nunca el
 * checkmark azul circular de Meta/X (que confunde la marca).
 *
 * text-on-success, nunca blanco literal: sobre el success de dark (#46b184) el
 * blanco da 2.66:1 — falla AA. El token elige el tono legible por tema.
 *
 * `cl-print-fill`: es el único portador de una tinta `on-*` que NO es un control,
 * así que el @media print no se lo lleva con `button`. Y `on-success` es claro por
 * definición — vive encima del verde. El navegador no imprime `background-color`,
 * de modo que sin este hook (`print-color-adjust: exact`) el escudo salía blanco
 * sobre papel blanco: 1.00:1. Con el relleno impreso conserva sus 4.97:1.
 */
export function IdentityBadge() {
  return (
    <span
      className="cl-print-fill flex size-6 items-center justify-center rounded-full bg-success text-on-success ring-2 ring-surface"
      role="img"
      aria-label="Identidad verificada con documento"
    >
      <ShieldCheck size={14} weight="fill" aria-hidden="true" />
    </span>
  );
}
