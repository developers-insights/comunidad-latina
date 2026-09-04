"use client";

import Link from "next/link";
import { ArrowRight, Briefcase, SealCheck, Toolbox } from "@phosphor-icons/react/dist/ssr";
import { COPY } from "@/components/empleos/copy";
import type { EmpleosKind } from "@/components/empleos/helpers";
import { cn } from "@/lib/utils";

const C = COPY.kindPicker;
const ACCENT = "var(--accent-empleos)";

/**
 * PRIMER PASO DE /empleos/publicar: ¿empleo o servicio?
 *
 * Lo propuso Nacho en la call del 3/9 y el cliente lo aprobó en el acto
 * ("excelente"). No es una bifurcación técnica: es la pantalla que resuelve la
 * confusión real de la sección, donde "trabajo" nombra las dos cosas.
 *
 * ── DECISIONES DE DISEÑO, Y POR QUÉ ─────────────────────────────────────────
 *
 * · DOS TARJETAS GRANDES, no un desplegable ni dos chips. Es una decisión que se
 *   toma UNA vez y cambia todo lo que sigue: merece el ancho de la pantalla y un
 *   área táctil que no se falla con el pulgar en un colectivo.
 *
 * · CADA OPCIÓN SE EXPLICA DESDE QUIÉN SOS. "Busco gente para trabajar" y
 *   "Ofrezco lo que sé hacer" se responden sin pensar; "aviso de demanda" y
 *   "aviso de oferta" obligan a traducir. Debajo, un ejemplo entre comillas con
 *   las palabras del propio cliente ("Soy jardinero, disponible sábados y
 *   domingos") — un ejemplo concreto desambigua más que tres líneas de ayuda.
 *
 * · LA TERCERA PUERTA NO ES UN TERCER BOTÓN. Quien tiene matrícula publica en
 *   Profesionales, con verificación de licencia. Va como una línea al pie, no
 *   como opción: ponerla al mismo nivel invitaría a que cualquiera se anote ahí,
 *   que es justo lo que el cliente quiso evitar ("gente con licencia").
 *
 * · SIN ILUSTRACIONES NI GRADIENTES DE RELLENO. El único color es el acento del
 *   módulo, y sólo en el ícono, el borde al tocar y el anillo de foco. La
 *   jerarquía la hacen el tamaño y el espacio, no una decoración.
 */
export function KindPicker({ onSelect }: { onSelect: (kind: EmpleosKind) => void }) {
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {C.title}
        </h1>
        <p className="text-sm text-foreground-secondary">{C.intro}</p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <KindOption
          icon={<Briefcase weight="fill" />}
          title={C.job.title}
          body={C.job.body}
          hint={C.job.hint}
          example={C.job.example}
          onClick={() => onSelect("job")}
        />
        <KindOption
          icon={<Toolbox weight="fill" />}
          title={C.service.title}
          body={C.service.body}
          hint={C.service.hint}
          example={C.service.example}
          onClick={() => onSelect("service")}
        />
      </div>

      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-border-subtle bg-surface-subtle px-4 py-3 text-sm text-foreground-secondary">
        <SealCheck size={16} aria-hidden="true" className="shrink-0" style={{ color: ACCENT }} />
        {C.professionalNote}{" "}
        <Link
          href="/profesionales"
          className={cn(
            "font-semibold text-foreground underline decoration-border-strong underline-offset-4",
            "transition-colors duration-(--duration-fast) hover:decoration-foreground",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          )}
        >
          {C.professionalLink}
        </Link>
      </p>
    </div>
  );
}

function KindOption({
  icon,
  title,
  body,
  hint,
  example,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  hint: string;
  example: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 text-left",
        // El movimiento es corto y con física, no un rebote: la tarjeta sube un
        // pelo al pasar y se hunde al tocar, que es lo que hace que se sienta un
        // objeto y no un rectángulo pintado.
        "transition-[border-color,box-shadow,transform] duration-(--duration-fast) ease-(--ease-spring)",
        "hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[0_10px_28px_-18px_rgb(0_0_0/0.45)]",
        "active:translate-y-0 active:scale-[0.99]",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
      )}
    >
      {/* Ícono a la izquierda, flecha a la derecha: la fila de arriba ya dice
          "esto es una opción y te lleva a algún lado", sin repetir el título
          abajo como un botón dentro del botón. */}
      <span className="flex items-start justify-between gap-3">
        <span
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-xl [&>svg]:size-6"
          style={{
            backgroundColor: `color-mix(in oklab, ${ACCENT} 14%, transparent)`,
            color: ACCENT,
          }}
        >
          {icon}
        </span>
        <ArrowRight
          size={18}
          weight="bold"
          aria-hidden="true"
          className={cn(
            "mt-1 shrink-0 text-foreground-muted",
            "transition-transform duration-(--duration-fast) ease-(--ease-spring)",
            "group-hover:translate-x-0.5 group-hover:text-foreground",
          )}
        />
      </span>

      <span className="flex flex-col gap-1">
        <span className="font-display text-lg font-bold leading-snug text-foreground">
          {title}
        </span>
        <span className="text-sm font-semibold text-foreground-secondary">{body}</span>
        <span className="text-sm leading-snug text-foreground-muted">{hint}</span>
      </span>

      <span className="mt-auto text-xs leading-snug text-foreground-muted">{example}</span>
    </button>
  );
}
