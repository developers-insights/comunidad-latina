import { cn } from "@/lib/utils";

/**
 * Dots de progreso del onboarding (§4.a): el paso activo se estira a pill
 * con color de marca; los demás quedan neutros.
 */
export function ProgressDots({
  total,
  current,
  className,
}: {
  total: number;
  /** Paso actual, 1-indexado. */
  current: number;
  className?: string;
}) {
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current}
      aria-label={`Paso ${current} de ${total}`}
      className={cn("flex items-center justify-center gap-2", className)}
    >
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={cn(
            "h-2 rounded-full transition-all duration-(--duration-base) ease-(--ease-out-premium)",
            index + 1 === current ? "w-6 bg-brand" : "w-2 bg-border",
          )}
        />
      ))}
    </div>
  );
}

export function ProgressBar({
  value,
  label,
  className,
}: {
  /** 0–100. */
  value: number;
  /** Nombre accesible de la barra (ej. "Progreso de tu perfil"). */
  label: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
      className={cn(
        "h-2 w-full overflow-hidden rounded-full bg-surface-subtle",
        className,
      )}
    >
      <div
        className="h-full rounded-full bg-brand transition-[width] duration-(--duration-slow) ease-(--ease-out-premium)"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
