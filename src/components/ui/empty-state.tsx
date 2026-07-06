import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  /** Ícono Phosphor grande (32px+) o ilustración de línea — nunca clip-art. */
  icon?: React.ReactNode;
  /** Ilustración opcional (src de /public/images). Reemplaza al ícono. */
  illustration?: string;
  title: string;
  /** Mensaje cálido que orienta — nunca "No hay contenido" seco (§3.5). */
  message: string;
  /** Acción concreta que resuelve el vacío (un <Button /> o link). */
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  illustration,
  title,
  message,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-sm flex-col items-center gap-4 px-6 py-12 text-center",
        className,
      )}
    >
      {illustration ? (
        // eslint-disable-next-line @next/next/no-img-element -- ilustración decorativa local, sin impacto LCP
        <img
          src={illustration}
          alt=""
          aria-hidden="true"
          className="h-32 w-auto max-w-full"
        />
      ) : icon ? (
        <span
          aria-hidden="true"
          className="flex size-16 items-center justify-center rounded-full bg-surface-subtle text-foreground-muted [&>svg]:size-8"
        >
          {icon}
        </span>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <h3 className="font-display text-lg font-semibold text-foreground">
          {title}
        </h3>
        <p className="text-sm text-foreground-secondary">{message}</p>
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
