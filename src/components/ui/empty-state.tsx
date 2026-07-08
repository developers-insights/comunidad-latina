import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  /** Ícono Phosphor grande (32px+) o ilustración de línea — nunca clip-art. */
  icon?: React.ReactNode;
  /**
   * Ilustración opcional (src de /public/images). Reemplaza al ícono.
   *
   * CONTRATO: tiene que ser un PNG con canal alpha y tinta de doble tema. La
   * ilustración se dibuja sobre el fondo de la página, así que un asset OPACO
   * pinta su propio rectángulo y en dark queda un bloque encendido flotando
   * (le pasó a empty-state-search.png: beige #ede9e2, 15.08:1 contra el canvas
   * oscuro, en nueve pantallas). Un fondo plano no se arregla con un contenedor:
   * una placa clara sobre una página oscura sigue siendo una placa clara.
   * El asset lleva el fondo recortado y la tinta calibrada para leerse igual en
   * los dos temas — ver public/images/MANIFEST.json.
   */
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
        // Va desnuda a propósito: el asset ya es transparente, así que el fondo
        // de la página ES el fondo del dibujo y no hace falta placa ni borde.
        // Tampoco se pinta con `mask-image` + `bg-*` para que la tinta salga de
        // un token: en forced-colors el `background-color` se fuerza a Canvas y
        // la ilustración desaparecería, mientras que un <img> se respeta. Y
        // ~offline/page.tsx dibuja este mismo PNG con un <img> pelado — un solo
        // camino de render, imposible que se desincronicen.
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
