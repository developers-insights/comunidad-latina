import Link from "next/link";
import { ClipboardText, Info } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, NavTabs, type NavTabItem } from "@/components/ui";
import { getTenant } from "@/lib/tenant/resolve";
import { requireStaff } from "../../guard";
import {
  DEFAULT_STATUS,
  KIND_TABS,
  QUEUE_LIMIT,
  STATUS_FILTERS,
  fetchRegistrosQueue,
  resolveKind,
  resolveStatusFilter,
} from "./queries";
import { RegistroAdminCard } from "./registro-card";

export const metadata = { title: "Registros de la comunidad" };

/**
 * =============================================================================
 * REGISTROS PRIVADOS DE COMUNIDAD (domain_admin+)
 * =============================================================================
 *
 * Los cuatro formularios que no publican nada: voluntarios que se anotan, gente
 * que pide voluntarios, lugares que quieren estar en el directorio y negocios
 * que prestan su espacio. Es la única pantalla donde esa información existe.
 *
 * ── POR QUÉ NO ES `moderator` COMO "PEDIR AYUDA" ────────────────────────────
 * Porque acá no se decide sobre un texto público: se leen teléfonos y correos de
 * vecinos. Es el mismo criterio con el que /admin/empleos pide `domain_admin`
 * para ver un currículum, y el mismo rol que exige la policy de la 0131 — así
 * que el nav, esta pantalla, las actions y el SQL piden todos lo mismo.
 *
 * ── ES UNA COLA DE LLAMADAS, NO DE MODERACIÓN ───────────────────────────────
 * Y eso cambia el orden y los botones. Lo más NUEVO primero (quien acaba de
 * dejar sus datos todavía se acuerda), el teléfono como enlace `tel:`, y estados
 * que describen una conversación —«ya lo contacté»— en vez de un veredicto.
 *
 * ── TENANT ──────────────────────────────────────────────────────────────────
 * El del JWT. El Host header es cosmético, mismo criterio que el resto del panel.
 * =============================================================================
 */

const COPY = {
  title: "Registros de la comunidad",
  intro:
    "Quién se anotó de voluntario, quién pide voluntarios, qué lugares quieren estar en el directorio y qué negocios prestan su espacio. Nada de esto es público: sirve para llamarlos.",
  navLabel: "Qué formulario estás mirando",
  filtroLabel: "Estado",
  queueError:
    "No pudimos leer esta sección en este momento. No es que no haya: es que la consulta falló. Recargá la página.",
  truncated: `Mostramos los primeros ${QUEUE_LIMIT}. Resolvé estos y recargá para ver los que siguen.`,
  privacidadTitle: "Cómo se tratan estos datos",
  privacidad: [
    "El teléfono y el correo de acá no se publican en ningún lado y no se comparten con quien pide voluntarios: la comunicación la hace el equipo.",
    "Antes de avisarle a un voluntario, revisá que el pedido sea voluntariado real y no un trabajo sin paga.",
    "Los registros descartados se borran solos a los 180 días. Los que siguen abiertos, no: son la lista con la que trabajás.",
    "Quien se anotó puede retirar sus datos cuando quiera desde el formulario. Si te lo pide por teléfono, descartalo y avisale que ya está.",
  ],
  empty: {
    title: "Todavía no hay registros de este tipo",
    message:
      "Cuando alguien complete el formulario, aparece acá apenas lo manda — y con su teléfono, para que puedas llamarlo.",
  },
} as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function RegistrosAdminPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { supabase, tenantId: jwtTenantId } = await requireStaff("domain_admin");
  const [tenant, sp] = await Promise.all([getTenant(), searchParams]);
  const tenantId = jwtTenantId ?? tenant.id;

  const kind = resolveKind(sp.tipo);
  const filtro = resolveStatusFilter(sp.estado);
  const cola = await fetchRegistrosQueue(supabase, tenantId, kind, filtro);

  const sufijoEstado = filtro === DEFAULT_STATUS ? "" : `&estado=${filtro}`;
  const tabs: NavTabItem[] = KIND_TABS.map((item) => ({
    id: item.id,
    label: item.label,
    href: `?tipo=${item.id}${sufijoEstado}`,
    count: cola.pendientesPorKind[item.id],
  }));

  return (
    <section aria-labelledby="registros-title" className="flex flex-col gap-4">
      <header>
        <h2
          id="registros-title"
          className="flex items-center gap-2 font-display text-2xl font-bold text-foreground"
        >
          <ClipboardText size={24} weight="fill" aria-hidden="true" className="text-brand-ink" />
          {COPY.title}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">{COPY.intro}</p>
      </header>

      <NavTabs items={tabs} active={kind} label={COPY.navLabel} />

      {/* El filtro por estado es un segundo eje y NO otra fila de pestañas: son
          enlaces chicos, para que el ojo no compita entre dos barras iguales. */}
      <nav aria-label={COPY.filtroLabel} className="flex flex-wrap gap-x-3 gap-y-1">
        {STATUS_FILTERS.map((item) => {
          const activo = item.id === filtro;
          const href =
            item.id === DEFAULT_STATUS ? `?tipo=${kind}` : `?tipo=${kind}&estado=${item.id}`;
          return (
            <Link
              key={item.id}
              href={href}
              aria-current={activo ? "page" : undefined}
              className={
                activo
                  ? "min-h-11 py-2 text-sm font-semibold text-foreground underline decoration-brand decoration-2 underline-offset-4"
                  : "min-h-11 py-2 text-sm text-foreground-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
              }
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {cola.failed && (
        <p
          role="alert"
          className="rounded-md bg-danger-bg px-3 py-2.5 text-sm leading-relaxed text-danger-ink"
        >
          {COPY.queueError}
        </p>
      )}

      {cola.truncated && (
        <p className="text-xs leading-relaxed text-foreground-muted">{COPY.truncated}</p>
      )}

      {cola.items.length === 0 && !cola.failed ? (
        <EmptyState
          icon={<ClipboardText />}
          title={COPY.empty.title}
          message={COPY.empty.message}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {cola.items.map((registro) => (
            <RegistroAdminCard key={registro.id} registro={registro} />
          ))}
        </div>
      )}

      {/*
        Las reglas de trato de estos datos, escritas y a la vista. Va AL FINAL
        para no tapar la cola, pero va: es una pantalla con teléfonos de vecinos
        y quien la abre tiene que saber qué puede y qué no puede hacer con ellos
        sin tener que preguntarle a nadie.
      */}
      <section className="rounded-lg border border-border-subtle px-3 py-2.5">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          <Info size={14} weight="fill" aria-hidden="true" className="text-info" />
          {COPY.privacidadTitle}
        </h3>
        <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4">
          {COPY.privacidad.map((regla) => (
            <li key={regla} className="text-xs leading-relaxed text-foreground-secondary">
              {regla}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
