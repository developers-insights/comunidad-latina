import Link from "next/link";
import { HouseLine, Info } from "@phosphor-icons/react/dist/ssr";
import { Bubble, Chip, buttonVariants } from "@/components/ui";
import { COMUNIDAD_ACCENT_MANOS, ComunidadHeading } from "@/components/comunidad";
import {
  COMUNIDAD_COPY,
  SPACE_ACTIVITIES,
  SPACE_ACTIVITY_LABEL,
} from "@/lib/comunidad";
import { cn } from "@/lib/utils";
import { SectionTopBar } from "@/components/shell";

export const metadata = { title: "Espacio comunitario" };

const E = COMUNIDAD_COPY.registros.espacio.portada;

/**
 * =============================================================================
 * ESPACIO COMUNITARIO — la pantalla de destino de la tarjeta nueva
 * =============================================================================
 *
 * La séptima tarjeta de la portada de Comunidad (0131) NO lleva a un listado, y
 * es una decisión, no una etapa: el cliente pidió el botón sabiendo que arranca
 * sin nadie anotado («al principio no se van a registrar, pero por lo menos ya
 * tenemos el botón», 1:00:45–1:06:00), y un listado vacío detrás de un cuadrado
 * de la grilla se lee como una sección rota.
 *
 * Entonces la tarjeta lleva ACÁ: cuatro párrafos que explican de qué se trata y
 * un botón. Nada más. Sin sección de «cómo funciona» en tres pasos, sin
 * testimonios inventados, sin contador de espacios: el único contenido honesto
 * que hay hoy es la explicación y la invitación.
 *
 * Los chips de actividades no son decoración: son EXACTAMENTE las opciones que
 * va a encontrar en el formulario, así que ver la lista acá es ver de qué se
 * trata sin tener que entrar. Se dibujan con el `<Chip>` del sistema y sin
 * interacción — son texto, no controles.
 */
export default function EspacioComunitarioPage() {
  return (
    <>
      <SectionTopBar fallbackHref="/comunidad" />

      <ComunidadHeading
        icon={<HouseLine size={30} weight="fill" aria-hidden="true" />}
        title={E.title}
        subtitle={E.subtitle}
      />

      <p className="mt-5 text-sm leading-relaxed text-foreground-secondary">{E.body}</p>

      <section aria-labelledby="espacio-usos" className="mt-6">
        <h2
          id="espacio-usos"
          className="text-xs font-semibold uppercase tracking-wide text-foreground-muted"
        >
          Para qué se suele prestar
        </h2>
        <ul className="mt-2.5 flex flex-wrap gap-2">
          {SPACE_ACTIVITIES.map((actividad) => (
            <li key={actividad}>
              <Chip variant="neutral" size="md">
                {SPACE_ACTIVITY_LABEL[actividad]}
              </Chip>
            </li>
          ))}
        </ul>
      </section>

      <Bubble
        accent={COMUNIDAD_ACCENT_MANOS}
        tone="accentSoft"
        shape="tile"
        size="none"
        className="mt-6 flex items-start gap-2.5 p-4"
      >
        <Info
          size={18}
          weight="fill"
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-[var(--bubble-ink)]"
        />
        <p className="text-sm leading-relaxed text-foreground-secondary">{E.nota}</p>
      </Bubble>

      <Link
        href="/comunidad/espacio/ofrecer"
        className={cn(buttonVariants({ variant: "primary", size: "md" }), "mt-6 w-full")}
      >
        {E.cta}
      </Link>
    </>
  );
}
