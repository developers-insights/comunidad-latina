import { Suspense } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ChartLineUp, Info } from "@phosphor-icons/react/dist/ssr";
import type { Database } from "@/lib/types/database.types";
import { EmptyState } from "@/components/ui";
import { MetricCard } from "@/components/admin/metrics/metric-card";
import {
  MetricsFilters,
  type CommunityOption,
} from "@/components/admin/metrics/metrics-filters";
import { MetricsSkeleton } from "@/components/admin/metrics/metrics-skeleton";
import { SecondaryStats } from "@/components/admin/metrics/secondary-stats";
import { TrendChart } from "@/components/admin/metrics/trend-chart";
import { COPY } from "@/lib/metrics/copy";
import { fetchMetricsOverview, isEmptyOverview } from "@/lib/metrics/queries";
import { isMetricsRange, METRIC_KEYS, type MetricsRange } from "@/lib/metrics/types";
import { requireStaff, type StaffRole } from "../guard";

export const metadata = { title: "Métricas" };

/**
 * Tablero de métricas (Semana 11 del plan): "un tablero simple para ver cuánta
 * gente entra, publica y se contacta".
 *
 * DOS CONTROLES DE ACCESO, NO UNO
 * -------------------------------
 *  1. `requireStaff("domain_admin")` — el mismo gate que el resto del panel:
 *     rol desde el JWT, verificado contra Supabase Auth, con redirect antes de
 *     renderizar nada.
 *  2. El chequeo de rol DENTRO de la RPC (0055).
 *
 * El (1) evita mostrar una pantalla que no corresponde. El (2) es el que de
 * verdad protege el dato: la RPC es `security definer`, o sea que corre sin
 * RLS, y se le puede pegar directo por PostgREST sin pasar nunca por esta
 * página. Si sólo existiera el (1), el gate sería decorativo.
 *
 * PRIVACIDAD (§5.4)
 * -----------------
 * Este tablero muestra CONTEOS. No lista personas, no muestra nombres y no hay
 * forma de llegar desde acá a "quién hizo qué". Es deliberado: el producto se
 * construyó anti-honeypot y un panel más rico no vale romper eso.
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** El cliente ya autenticado que devuelve `requireStaff`. */
type StaffClient = SupabaseClient<Database>;

interface Filters {
  days: MetricsRange;
  tenantId: string | null;
}

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Los filtros vienen de la URL, o sea del usuario. Se normalizan a valores
 * conocidos ANTES de tocar la base: la ventana cae al default si no es 7/30/90
 * y la comunidad se descarta si no tiene forma de uuid.
 *
 * Esto no es la barrera de seguridad — un uuid con forma válida de otro tenant
 * lo rechaza la RPC, que es donde tiene que rechazarse. Acá sólo se evita
 * mandarle basura a Postgres y comerse un error por algo que es un typo.
 */
function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const rawDays = Number.parseInt(firstValue(sp.dias), 10);
  const rawTenant = firstValue(sp.comunidad);
  return {
    days: isMetricsRange(rawDays) ? rawDays : 30,
    tenantId: UUID_RE.test(rawTenant) ? rawTenant : null,
  };
}

export default async function MetricasPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase, role, tenantId: jwtTenantId } = await requireStaff("domain_admin");
  const filters = parseFilters(await searchParams);

  // El domain_admin no elige comunidad: tiene una sola y la RPC se la impone
  // igual. Mandarle `null` es lo correcto — la función resuelve su tenant desde
  // el JWT, no desde la URL.
  const effectiveTenantId = role === "global_admin" ? filters.tenantId : jwtTenantId;

  const communities =
    role === "global_admin" ? await loadCommunities(supabase) : ([] as CommunityOption[]);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-2xl font-bold text-foreground">{COPY.title}</h2>
          <p className="text-sm text-foreground-secondary">{COPY.intro}</p>
        </div>
        <MetricsFilters
          days={filters.days}
          tenantId={role === "global_admin" ? filters.tenantId : null}
          communities={communities}
        />
      </section>

      {/* La key remonta el Suspense en cada cambio de filtro: vuelve el
          esqueleto en vez de dejar congelados los números del filtro anterior,
          que se leerían como si fueran los nuevos. */}
      <Suspense key={`${filters.days}:${effectiveTenantId ?? "todas"}`} fallback={<MetricsSkeleton />}>
        <MetricsContent
          supabase={supabase}
          role={role}
          days={filters.days}
          tenantId={role === "global_admin" ? filters.tenantId : null}
        />
      </Suspense>
    </div>
  );
}

async function loadCommunities(supabase: StaffClient): Promise<CommunityOption[]> {
  const { data } = await supabase.from("tenants").select("id, name").order("created_at");
  return [
    { id: null, name: COPY.allCommunities },
    ...(data ?? []).map((t) => ({ id: t.id, name: t.name })),
  ];
}

/**
 * El cliente de Supabase viaja como prop desde la página, ya verificada. No se
 * vuelve a llamar a `requireStaff` acá: sería una segunda ida a Supabase Auth
 * por render para repetir una respuesta que ya tenemos, y la barrera que de
 * verdad protege el dato no es esta — es el chequeo de rol dentro de la RPC,
 * que corre igual venga la llamada de donde venga.
 */
async function MetricsContent({
  supabase,
  role,
  days,
  tenantId,
}: {
  supabase: StaffClient;
  role: StaffRole;
  days: MetricsRange;
  tenantId: string | null;
}) {
  const result = await fetchMetricsOverview(supabase, { tenantId, days });

  if (!result.ok) {
    // `forbidden` no debería llegar acá (el gate de arriba ya filtró), pero si
    // llega es porque la RPC dijo que no: se respeta esa respuesta en vez de
    // insistir. Para el que mira, las dos cosas son "no hay números"; el
    // detalle queda en el log, no en pantalla.
    return (
      <p role="alert" className="text-sm text-warning-ink">
        {COPY.errorMessage}
      </p>
    );
  }

  const { data } = result;

  if (isEmptyOverview(data)) {
    return (
      <>
        <EmptyState
          icon={<ChartLineUp />}
          title={COPY.emptyTitle}
          message={COPY.emptyMessage}
          className="py-10"
        />
        <FinePrint />
      </>
    );
  }

  const seriesByKey = {
    active: data.series.map((p) => p.active),
    publishers: data.series.map((p) => p.publishers),
    contacters: data.series.map((p) => p.contacters),
  };

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {METRIC_KEYS.map((key) => (
          <MetricCard
            key={key}
            metric={key}
            value={data.totals[key]}
            previous={data.previous[key]}
            series={seriesByKey[key]}
            days={data.days}
          />
        ))}
      </div>

      <section aria-labelledby="metricas-serie" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 id="metricas-serie" className="font-display text-lg font-semibold text-foreground">
            {COPY.chartTitle}
          </h3>
          <p className="text-sm text-foreground-secondary">{COPY.chartIntro}</p>
        </div>
        <TrendChart series={data.series} />
      </section>

      <section aria-labelledby="metricas-contexto" className="flex flex-col gap-3">
        <h3 id="metricas-contexto" className="font-display text-lg font-semibold text-foreground">
          {COPY.secondaryTitle}
        </h3>
        <SecondaryStats data={data} />
      </section>

      <FinePrint />

      {role === "global_admin" && !tenantId && (
        <p className="text-xs text-foreground-muted">
          Estás viendo todas las comunidades sumadas. Elegí una arriba para verla sola.
        </p>
      )}
    </>
  );
}

/**
 * Las advertencias de lectura, al pie y siempre visibles. Son parte del dato:
 * sin ellas, "hoy" parece un día flojo cuando en realidad va por la mitad.
 */
function FinePrint() {
  return (
    <section
      aria-labelledby="metricas-letra-chica"
      className="flex gap-3 rounded-lg border border-border-subtle bg-surface-subtle p-4"
    >
      <Info size={18} className="mt-0.5 shrink-0 text-foreground-muted" aria-hidden="true" />
      <div className="flex flex-col gap-1.5">
        <h3 id="metricas-letra-chica" className="text-sm font-semibold text-foreground-secondary">
          {COPY.finePrintTitle}
        </h3>
        <ul className="flex list-disc flex-col gap-1 ps-4 text-xs leading-relaxed text-foreground-muted">
          {COPY.finePrint.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
