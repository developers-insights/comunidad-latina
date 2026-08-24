import {
  ArrowSquareOut,
  Buildings,
  Clock,
  CurrencyDollar,
  Globe,
  MapPin,
  NavigationArrow,
  Phone,
  Translate,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import { BezelCard, Chip } from "@/components/ui";
import { COMUNIDAD_COPY, mapsHref, telHref, type CommunityResource } from "@/lib/comunidad";
import { cn, formatDate } from "@/lib/utils";

const C = COMUNIDAD_COPY.recursos;

/**
 * Ficha de un recurso de ayuda.
 *
 * ── LO QUE ESTA CARD PROMETE ────────────────────────────────────────────────
 * Que nadie pueda confundir lo que dice el recurso con lo que dice la
 * plataforma. Por eso el pie de procedencia —quién lo publica, el enlace y
 * cuándo lo revisamos— NO es condicional: se renderiza siempre, porque la
 * ficha ni siquiera llega hasta acá sin fuente (`toCommunityResource` la
 * descarta antes, y la base la exige NOT NULL).
 *
 * ── JERARQUÍA ───────────────────────────────────────────────────────────────
 * Nombre → qué ofrece → CÓMO LLEGAR. Los tres botones de contacto son lo más
 * grande y lo único con color: quien abre esta pantalla no viene a leer, viene
 * a llamar. Los detalles (horario, costo, requisitos, idiomas) van después,
 * porque se leen una vez y se decide; el teléfono se toca.
 *
 * ── ACCESIBILIDAD ───────────────────────────────────────────────────────────
 *  · Cada acción es un `<a>` real con etiqueta de texto, nunca un ícono solo.
 *  · `min-h-11` (44px) en todo lo tocable.
 *  · Los metadatos llevan ícono Y etiqueta: el color y la forma nunca son el
 *    único portador del significado.
 */
const ACTION = cn(
  "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border px-3",
  "text-sm font-semibold",
  "transition-[background-color,border-color,transform] duration-(--duration-fast) ease-(--ease-spring)",
  "active:scale-[0.98]",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
);

const ACTION_PRIMARY = cn(
  ACTION,
  "border-[color-mix(in_oklab,var(--accent-comunidad)_40%,transparent)]",
  "bg-[color-mix(in_oklab,var(--accent-comunidad)_14%,var(--color-surface))]",
  "text-foreground hover:bg-[color-mix(in_oklab,var(--accent-comunidad)_22%,var(--color-surface))]",
);

const ACTION_SECONDARY = cn(
  ACTION,
  "border-border bg-surface text-foreground-secondary hover:bg-surface-subtle hover:text-foreground",
);

function Meta({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2 text-sm leading-relaxed">
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-foreground-muted">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="font-medium text-foreground-secondary">{label}: </span>
        <span className="text-foreground-secondary">{value}</span>
      </span>
    </div>
  );
}

export function RecursoCard({ recurso }: { recurso: CommunityResource }) {
  const tel = telHref(recurso.phone);
  const maps = mapsHref(recurso.address);

  return (
    <BezelCard coreClassName="flex flex-col gap-4 p-5">
      <div className="space-y-2">
        <h3 className="font-display text-lg font-semibold leading-snug text-foreground">
          {recurso.name}
        </h3>

        {(recurso.areaLabel || recurso.address) && (
          <p className="flex items-start gap-1.5 text-sm text-foreground-muted">
            <MapPin size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>{recurso.areaLabel ?? recurso.address}</span>
          </p>
        )}

        {recurso.description && (
          <p className="text-sm leading-relaxed text-foreground-secondary">
            {recurso.description}
          </p>
        )}
      </div>

      {/* Contacto: lo que se viene a hacer acá. Apilado en el celular y en fila
          desde `sm`: tres botones en 375px quedarían por debajo del ancho
          táctil cómodo, y este es justo el control que no se puede errar. */}
      {(tel || recurso.website || maps) && (
        <div className="flex flex-col gap-2 sm:flex-row">
          {tel && (
            <a href={tel} className={ACTION_PRIMARY}>
              <Phone size={18} weight="fill" aria-hidden="true" />
              {C.contact.call}
            </a>
          )}
          {recurso.website && (
            <a
              href={recurso.website}
              target="_blank"
              rel="noopener noreferrer"
              className={ACTION_SECONDARY}
            >
              <Globe size={18} aria-hidden="true" />
              {C.contact.website}
            </a>
          )}
          {maps && (
            <a
              href={maps}
              target="_blank"
              rel="noopener noreferrer"
              className={ACTION_SECONDARY}
            >
              <NavigationArrow size={18} aria-hidden="true" />
              {C.contact.directions}
            </a>
          )}
        </div>
      )}

      {(recurso.hoursNote ||
        recurso.costNote ||
        recurso.requirementsNote ||
        recurso.languages.length > 0) && (
        <div className="space-y-1.5 border-t border-border-subtle pt-3">
          {recurso.hoursNote && (
            <Meta
              icon={<Clock size={16} />}
              label={C.contact.hours}
              value={recurso.hoursNote}
            />
          )}
          {recurso.costNote && (
            <Meta
              icon={<CurrencyDollar size={16} />}
              label={C.contact.cost}
              value={recurso.costNote}
            />
          )}
          {recurso.requirementsNote && (
            <Meta
              icon={<WarningCircle size={16} />}
              label={C.contact.requirements}
              value={recurso.requirementsNote}
            />
          )}
          {recurso.languages.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <Translate size={16} aria-hidden="true" className="text-foreground-muted" />
              <span className="text-sm font-medium text-foreground-secondary">
                {C.contact.languages}:
              </span>
              {recurso.languages.map((idioma) => (
                <Chip key={idioma} size="sm">
                  {idioma}
                </Chip>
              ))}
            </div>
          )}
        </div>
      )}

      {/* PROCEDENCIA — nunca condicional. Ver la cabecera del archivo. */}
      <footer className="border-t border-border-subtle pt-3">
        <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-xs leading-relaxed text-foreground-muted">
          {/* `Buildings` y NO `SealCheck`. El sello con tilde es, en toda la
              app, la marca de un plan contratado (el check azul, la Presencia
              Verificada), y esta línea no certifica nada: dice quién publicó el
              recurso y cuándo lo miramos nosotros. Un sello acá contradecía la
              promesa de la card —que no se confunda lo que dice el recurso con
              lo que dice la plataforma— justo en el renglón que existe para
              cumplirla. Una institución es lo que la línea nombra. */}
          <Buildings
            size={14}
            weight="fill"
            aria-hidden="true"
            className="translate-y-0.5 text-brand-ink"
          />
          <span>{C.sourceLabel}</span>
          <a
            href={recurso.source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          >
            {recurso.source.name}
            <ArrowSquareOut size={12} aria-hidden="true" />
            <span className="sr-only">{C.openSource}</span>
          </a>
          <span>· {C.checkedLabel(formatDate(recurso.source.checkedAt, { style: "medium" }))}</span>
        </p>
      </footer>
    </BezelCard>
  );
}
