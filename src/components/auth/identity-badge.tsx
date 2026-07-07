import { ShieldCheck } from "@phosphor-icons/react/dist/ssr";

/**
 * Badge de identidad verificada sobre el avatar (esquina inf-derecha, §3.3).
 * Gramática propia del Escudo: escudo + verde de éxito de marca — nunca el
 * checkmark azul circular de Meta/X (que confunde la marca).
 */
export function IdentityBadge() {
  return (
    <span
      className="flex size-6 items-center justify-center rounded-full bg-success text-white ring-2 ring-surface"
      role="img"
      aria-label="Identidad verificada con documento"
    >
      <ShieldCheck size={14} weight="fill" aria-hidden="true" />
    </span>
  );
}
