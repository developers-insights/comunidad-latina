import { ShieldCheck } from "@phosphor-icons/react/dist/ssr";

/**
 * Badge de identidad verificada sobre el avatar (esquina inf-derecha, §3.3).
 * Gramática propia del Escudo: escudo + verde de éxito de marca — nunca el
 * checkmark azul circular de Meta/X (que confunde la marca).
 *
 * text-on-success, nunca blanco literal: sobre el success de dark (#46b184) el
 * blanco da 2.66:1 — falla AA. El token elige el tono legible por tema.
 */
export function IdentityBadge() {
  return (
    <span
      className="flex size-6 items-center justify-center rounded-full bg-success text-on-success ring-2 ring-surface"
      role="img"
      aria-label="Identidad verificada con documento"
    >
      <ShieldCheck size={14} weight="fill" aria-hidden="true" />
    </span>
  );
}
