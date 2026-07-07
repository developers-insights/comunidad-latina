import { SealCheck } from "@phosphor-icons/react/dist/ssr";

/**
 * Badge de identidad verificada sobre el avatar (esquina inf-derecha, §3.3).
 * Ícono propio — nunca el checkmark azul de Meta/X.
 */
export function IdentityBadge() {
  return (
    <span
      className="flex size-6 items-center justify-center rounded-full bg-info text-white ring-2 ring-surface"
      role="img"
      aria-label="Identidad verificada con documento"
    >
      <SealCheck size={14} weight="fill" aria-hidden="true" />
    </span>
  );
}
