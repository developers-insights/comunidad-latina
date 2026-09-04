import Link from "next/link";
import { ChatCircleDots } from "@phosphor-icons/react/dist/ssr";
import { COMUNIDAD_COPY, isHelpTopic } from "@/lib/comunidad";
import { cn } from "@/lib/utils";

/**
 * =============================================================================
 * EL PUENTE DEL DIRECTORIO AL TABLÓN
 * =============================================================================
 *
 * ── QUÉ ERA ESTO ANTES ──────────────────────────────────────────────────────
 * Las dos puertas de "Ayuda mutua": «Quiero ayudar» y «Necesito manos», una al
 * lado de la otra. El cliente las sacó el 2026-09-03 —«necesito manos» para una
 * mudanza es responsabilidad legal de la plataforma si alguien se lastima, y el
 * flujo «Quiero ayudar → ¿sobre qué tema?» además lo confundió—. Los dos
 * botones no existen más en ningún lado de la app.
 *
 * ── POR QUÉ EL ARCHIVO Y EL NOMBRE SIGUEN ACÁ ───────────────────────────────
 * `<OfrecerEnTema>` lo monta `comunidad/recursos/page.tsx`, que es de otro
 * frente y no se toca en esta ronda. Cambiarle el nombre acá rompería esa
 * pantalla en el build. Se conserva la firma exacta y se cambia lo que hace;
 * quien tome ese archivo después lo renombra a `<PreguntarleALaComunidad>` en
 * el mismo commit en el que cambie el import.
 *
 * ── QUÉ HACE AHORA ──────────────────────────────────────────────────────────
 * Es el puente que le faltaba al directorio: alguien mira las fichas de un tema
 * y no encuentra lo suyo (o directamente no hay fichas cargadas — hoy el
 * directorio está vacío). En vez de un callejón, hay una puerta al tablón con
 * ese tema ya puesto.
 *
 * `isHelpTopic` decide si aparece. Devuelve `null` en los temas que el tablón
 * no acepta (migración, legal, emergencias, consulados, adicciones, medicinas),
 * y la pantalla no dibuja NINGÚN cartel explicando por qué: decirle a alguien
 * que está buscando una clínica que "acá no podés preguntar" sería contestarle
 * una pregunta que no hizo. Los motivos están en §2 de la 0130.
 */
export function OfrecerEnTema({ topic, className }: { topic: string; className?: string }) {
  if (!isHelpTopic(topic)) return null;

  return (
    <Link
      href={`/comunidad/pedir-ayuda?tema=${topic}`}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-3",
        "text-sm font-semibold",
        "border-[color-mix(in_oklab,var(--accent-comunidad-manos)_40%,transparent)]",
        "bg-[color-mix(in_oklab,var(--accent-comunidad-manos)_14%,var(--color-surface))]",
        "text-foreground hover:bg-[color-mix(in_oklab,var(--accent-comunidad-manos)_22%,var(--color-surface))]",
        "transition-[background-color,border-color,transform] duration-(--duration-fast) ease-(--ease-spring)",
        "active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        className,
      )}
    >
      <ChatCircleDots size={18} weight="fill" aria-hidden="true" />
      {COMUNIDAD_COPY.pedirAyuda.desdeRecursos}
    </Link>
  );
}
