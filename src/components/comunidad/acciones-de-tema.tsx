import Link from "next/link";
import { HandHeart, Megaphone, Storefront } from "@phosphor-icons/react/dist/ssr";
import { isResourceTopic, type ResourceTopic } from "@/lib/comunidad";
import { cn } from "@/lib/utils";
import {
  COMUNIDAD_ACCENT_ACOPIO,
  COMUNIDAD_ACCENT_COMIDA,
  COMUNIDAD_ACCENT_VOLUNTARIOS,
} from "./heading";

/**
 * =============================================================================
 * LAS PUERTAS DE CADA TEMA DEL DIRECTORIO (0131)
 * =============================================================================
 *
 * Tres de las seis tarjetas de la portada de Comunidad terminan en la MISMA
 * pantalla filtrada (`/comunidad/recursos?tema=`), y hasta la 0131 las tres eran
 * un callejón: fichas curadas por el equipo y nada que hacer si no había ninguna
 * — que es el estado real hoy, porque el directorio está vacío en producción.
 *
 * El cliente pidió la salida de ese callejón con dos frases:
 *   · «Centro de acopio igual: los negocios entran ahí, debe haber una forma de
 *     registrarse» (39:30) → "Registrar mi lugar" en Acopio y en Comida.
 *   · «El voluntario tiene que poder registrarse… y quien necesita voluntarios
 *     llena un formulario» (39:20 y 45:40) → las DOS puertas en Voluntarios.
 *
 * Los temas que no tienen formulario propio (salud, migración, consulados…) no
 * dibujan nada: un cartel explicando por qué no se puede registrar una clínica
 * sería contestar una pregunta que nadie hizo.
 *
 * ── POR QUÉ NO SON BOTONES PRIMARIOS ────────────────────────────────────────
 * Porque no son la acción principal de la pantalla. Quien entra a "Bancos de
 * comida" viene a BUSCAR uno; registrar el propio es lo que hace una persona de
 * cada cien. La pastilla con el acento del tema se ve y se toca sin competir con
 * las fichas, que son el contenido.
 */

/**
 * La receta visual de una puerta de tema. Una sola, para que las tres se vean
 * igual — y la usa también `<PreguntarleALaComunidad>`, que es la cuarta puerta
 * del mismo lugar. El color entra por `--accion-accent` (ver `accionPillStyle`)
 * y no por una clase: Tailwind no puede generar una clase con un valor que se
 * decide en runtime.
 */
export function accionPillClass(): string {
  return cn(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-3",
    "text-sm font-semibold",
    "border-[color-mix(in_oklab,var(--accion-accent)_40%,transparent)]",
    "bg-[color-mix(in_oklab,var(--accion-accent)_14%,var(--color-surface))]",
    "text-foreground hover:bg-[color-mix(in_oklab,var(--accion-accent)_22%,var(--color-surface))]",
    "transition-[background-color,border-color,transform] duration-(--duration-fast) ease-(--ease-spring)",
    "active:scale-[0.98]",
    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
  );
}

/** El acento como custom property, para que la receta de arriba lo pueda leer. */
export function accionPillStyle(accent: string): React.CSSProperties {
  return { "--accion-accent": accent } as React.CSSProperties;
}

const COPY = {
  voluntario: "Anotarme como voluntario",
  pedirVoluntarios: "Necesito voluntarios",
  registrarLugar: "Registrar mi lugar",
} as const;

export function AccionesDeTema({
  topic,
  className,
}: {
  topic: ResourceTopic | string;
  className?: string;
}) {
  if (!isResourceTopic(topic)) return null;

  if (topic === "voluntariado") {
    return (
      <div className={cn("flex flex-wrap gap-2", className)}>
        <Link
          href="/comunidad/voluntarios/registrarme"
          className={accionPillClass()}
          style={accionPillStyle(COMUNIDAD_ACCENT_VOLUNTARIOS)}
        >
          <HandHeart size={18} weight="fill" aria-hidden="true" />
          {COPY.voluntario}
        </Link>
        <Link
          href="/comunidad/voluntarios/pedir"
          className={accionPillClass()}
          style={accionPillStyle(COMUNIDAD_ACCENT_VOLUNTARIOS)}
        >
          <Megaphone size={18} weight="fill" aria-hidden="true" />
          {COPY.pedirVoluntarios}
        </Link>
      </div>
    );
  }

  if (topic === "comida" || topic === "acopio") {
    const accent = topic === "comida" ? COMUNIDAD_ACCENT_COMIDA : COMUNIDAD_ACCENT_ACOPIO;
    return (
      <div className={cn("flex flex-wrap gap-2", className)}>
        <Link
          href="/comunidad/recursos/registrar"
          className={accionPillClass()}
          style={accionPillStyle(accent)}
        >
          <Storefront size={18} weight="fill" aria-hidden="true" />
          {COPY.registrarLugar}
        </Link>
      </div>
    );
  }

  return null;
}
