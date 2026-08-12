import Link from "next/link";
import { ArrowLeft, Info, SlidersHorizontal, UserCirclePlus } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, NavTabs, type NavTabItem } from "@/components/ui";
import { getTenant } from "@/lib/tenant/resolve";
import { requireStaff } from "../../guard";
import {
  DEFAULT_FILTER,
  QUEUE_FILTERS,
  QUEUE_LIMIT,
  fetchCreatorRequestQueue,
  resolveQueueFilter,
  type QueueFilterId,
} from "./queries";
import { SolicitudCard, type CreatorRequestCardData } from "./solicitud-card";

export const metadata = { title: "Solicitudes de creador" };

/**
 * =============================================================================
 * COLA DE SOLICITUDES DE CREADOR (domain_admin+)
 * =============================================================================
 *
 * EL AGUJERO QUE TAPA ESTA PANTALLA. `request_creator_activation` (0032) deja a
 * la persona en `platform_review_pending` y
 * `admin_resolve_creator_activation` existe desde la misma migración… pero no
 * la invocaba NINGUNA pantalla. O sea: las solicitudes entraban y se quedaban
 * ahí para siempre. El onboarding de creadores estaba cortado en el último
 * paso, y el corte no se veía porque del lado del usuario la pantalla decía,
 * correctamente, "en revisión".
 *
 * ES OTRA COSA QUE `/admin/creadores`. Ese panel define los UMBRALES —las
 * reglas—; este resuelve CASOS. Se separan por la misma razón por la que la
 * cola de integridad no es una pestaña de moderación: cambiar una regla afecta
 * a todo el mundo hacia adelante, resolver un caso afecta a una persona ahora.
 * Los dos se enlazan mutuamente, pero no se mezclan.
 *
 * ROL: `domain_admin`, igual que su panel hermano. La RPC de la base se
 * conforma con `moderator` (`app.is_staff()`), así que acá la app es MÁS
 * estricta que la base — a propósito: es el mismo rango que ya exige el panel
 * de umbrales y el que muestra el nav para esta sección. Ser más estricto en la
 * app es seguro; al revés no.
 *
 * TENANT: el del JWT. El Host header es cosmético, mismo criterio que
 * /admin/dominio y /admin/creadores.
 * =============================================================================
 */

const COPY = {
  title: "Solicitudes para ser creador",
  intro:
    "Quienes ya mandaron su solicitud y esperan una respuesta del equipo. Abajo de cada una ves qué requisitos cumple y cuáles no, medidos contra los cortes que tiene tu comunidad hoy.",
  backToThresholds: "Requisitos para ser creador",
  thresholdsHint:
    "¿Los cortes te parecen mal calibrados? Se cambian en el panel de requisitos y rigen desde que guardás.",
  navLabel: "Estado de las solicitudes",
  configError:
    "No pudimos leer los requisitos configurados de tu comunidad, así que abajo se evalúa con los que trae el sistema por defecto. Recargá la página antes de decidir: podrías estar mirando cortes que no son los que rigen.",
  queueError:
    "No pudimos leer las solicitudes en este momento. No es que no haya: es que la consulta falló. Recargá la página.",
  truncated: `Mostramos las primeras ${QUEUE_LIMIT}. Resolvé estas y recargá para ver las que siguen.`,
  blindSpotsTitle: "Lo que este panel no puede verificar",
  empty: {
    pendientes: {
      title: "No hay nada esperando",
      message:
        "Cuando alguien de tu comunidad mande su solicitud para recibir trabajos pagos, aparece acá.",
    },
    esperando: {
      title: "Nadie quedó esperando",
      message:
        "Acá van las solicitudes a las que les pediste más datos, mientras la persona responde.",
    },
    resueltas: {
      title: "Todavía no resolviste ninguna",
      message: "Las solicitudes aprobadas, rechazadas y suspendidas quedan acá como historial.",
    },
  } satisfies Record<QueueFilterId, { title: string; message: string }>,
} as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SolicitudesCreadorPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { supabase, tenantId: jwtTenantId } = await requireStaff("domain_admin");
  const [tenant, sp] = await Promise.all([getTenant(), searchParams]);
  const tenantId = jwtTenantId ?? tenant.id;

  const filter = resolveQueueFilter(sp.estado);
  const queue = await fetchCreatorRequestQueue(supabase, tenantId, filter);

  // El mapeo es explícito y no un spread: la tarjeta es un Client Component y
  // solo tiene que cruzar la frontera lo que la tarjeta dibuja.
  const cards: CreatorRequestCardData[] = queue.requests.map((request) => ({
    profileId: request.profileId,
    displayName: request.displayName,
    username: request.username,
    avatarUrl: request.avatarUrl,
    memberSince: request.memberSince,
    status: request.status,
    statusUpdatedAt: request.statusUpdatedAt,
    waitedDays: request.waitedDays,
    headline: request.headline,
    categories: request.categories,
    rateHint: request.rateHint,
    portfolioItems: request.portfolioItems,
    creatorTermsAcceptedAt: request.creatorTermsAcceptedAt,
    checks: request.eligibility.checks,
  }));

  const tabs: NavTabItem[] = QUEUE_FILTERS.map((item) => ({
    id: item.id,
    label: item.label,
    href: item.id === DEFAULT_FILTER ? "?" : `?estado=${item.id}`,
    count: queue.counts[item.id],
  }));

  const empty = COPY.empty[filter];

  return (
    <section aria-labelledby="solicitudes-title" className="flex flex-col gap-4">
      <header>
        <Link
          href="/admin/creadores"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-foreground-secondary transition-colors duration-(--duration-fast) ease-(--ease-out-premium) hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          {COPY.backToThresholds}
        </Link>
        <h2 id="solicitudes-title" className="mt-1 font-display text-2xl font-bold text-foreground">
          {COPY.title}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">{COPY.intro}</p>
        <p className="mt-2 flex items-start gap-1.5 text-sm text-foreground-muted">
          <SlidersHorizontal
            size={16}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-foreground-muted"
          />
          <span>
            {COPY.thresholdsHint}{" "}
            <Link
              href="/admin/creadores"
              className="font-medium text-brand-ink underline underline-offset-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
            >
              {COPY.backToThresholds}
            </Link>
          </span>
        </p>
      </header>

      <NavTabs items={tabs} active={filter} label={COPY.navLabel} />

      {queue.configFailed && (
        <p
          role="alert"
          className="rounded-md bg-warning-bg px-3 py-2.5 text-sm leading-relaxed text-warning-ink"
        >
          {COPY.configError}
        </p>
      )}

      {queue.failed && (
        <p
          role="alert"
          className="rounded-md bg-danger-bg px-3 py-2.5 text-sm leading-relaxed text-danger-ink"
        >
          {COPY.queueError}
        </p>
      )}

      {queue.truncated && (
        <p className="text-xs leading-relaxed text-foreground-muted">{COPY.truncated}</p>
      )}

      {cards.length === 0 && !queue.failed ? (
        <EmptyState icon={<UserCirclePlus />} title={empty.title} message={empty.message} />
      ) : (
        <div className="flex flex-col gap-3">
          {cards.map((request) => (
            <SolicitudCard key={request.profileId} request={request} />
          ))}
        </div>
      )}

      {/*
        Los puntos ciegos van AL FINAL y no escondidos: un panel que no puede
        medir algo tiene que decirlo, si no el moderador cree que el "no cumple"
        que ve es la foto completa.
      */}
      {queue.blindSpots.length > 0 && (
        <section className="rounded-lg border border-border-subtle px-3 py-2.5">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            <Info size={14} weight="fill" aria-hidden="true" className="text-info" />
            {COPY.blindSpotsTitle}
          </h3>
          <ul className="mt-1.5 flex flex-col gap-1">
            {queue.blindSpots.map((spot) => (
              <li key={spot} className="text-xs leading-relaxed text-foreground-secondary">
                {spot}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
