import Link from "next/link";
import {
  ArrowRight,
  ChartLineUp,
  Receipt,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import { Banner, EmptyState } from "@/components/ui";
import { CommunitySwitcher } from "@/components/admin/community-switcher";
import { decodeCursor, encodeCursor } from "@/components/listings/helpers";
import { isStripeConfigured } from "@/lib/config/services";
import { PRODUCT_COPY, formatCents, isPriceProduct } from "@/lib/pricing";
import {
  getRevenueEvents,
  getRevenueSummary,
  type RevenueSummaryRow,
} from "@/lib/pricing/revenue";
import { formatDate } from "@/lib/utils";
import { requireStaff } from "../../guard";
import { COMMUNITY_PARAM, firstParam, listCommunities } from "../../scope";
import { PERIOD_DAYS, PERIOD_LABEL, parsePeriod, periodRange, type PeriodDays } from "./periodo";

export const metadata = { title: "Pagos e ingresos" };

/**
 * PAGOS E INGRESOS (solo `global_admin`).
 *
 * Lo que el pliego pide y hasta ahora sólo se podía mirar en Supabase o en el
 * dashboard de Stripe. La fuente es `payment_events`, que guarda cada webhook
 * de Stripe desde la migración 0008.
 *
 * DE DÓNDE SALEN LOS NÚMEROS. De `admin_revenue_summary` y
 * `admin_revenue_events` (0074), no de un select. `payment_events` tiene sus
 * cuatro policies en `false` —nadie con un JWT lee esa tabla, ni el súper
 * admin— porque el payload crudo trae mail del comprador, datos de facturación
 * y resultados de verificación de identidad. Las funciones devuelven montos y
 * tipos de evento; el payload no sale de la base.
 *
 * VACÍO, NUNCA CERO. Es la regla que gobierna toda la pantalla:
 *  · Si la consulta FALLA, se dice que falló. No se dibuja "USD 0".
 *  · Si un evento de dinero no tiene monto legible, se cuenta aparte y se
 *    muestra el hueco ("N pagos sin monto legible"). No suma cero.
 *  · Si no hay ningún pago todavía, el estado vacío lo dice y explica por qué
 *    —Stripe está en modo degradado en este entorno— en vez de mostrar una
 *    grilla de ceros que se leería como "vendimos nada".
 * Un cero falso en un tablero de ingresos es peor que un hueco: el hueco se
 * investiga, el cero se cree.
 *
 * PAGINACIÓN KEYSET, jamás offset (§6 de ARQUITECTURA): el cursor es el par
 * (received_at, id) del último evento de la página.
 */

const COPY = {
  title: "Pagos e ingresos",
  intro:
    "Lo que entró por Presencia Verificada, impulsos, campañas y membresías. Sale de los eventos de pago que registra la plataforma.",
  degradedTitle: "Los pagos están en modo degradado",
  degradedBody:
    "Este entorno no tiene credenciales de Stripe válidas, así que no se están cobrando ni registrando pagos nuevos. Lo que se ve acá es lo que haya quedado registrado, sin inventar nada.",
  periodLegend: "Período",
  emptyTitle: "Todavía no hay pagos registrados",
  emptyMessage:
    "En cuanto se procese el primer cobro, aparece acá con su comunidad, su producto y su monto.",
  errorTitle: "No pudimos calcular los ingresos",
  errorMessage:
    "La consulta falló de nuestro lado. Preferimos dejarlo en blanco antes que mostrarte un número que no podemos garantizar.",
  detailTitle: "Detalle de los pagos",
  detailIntro: "Del más reciente al más viejo. No incluye datos de la persona que pagó.",
  more: "Ver más",
  platform: "Sin comunidad",
  unclassified: "Sin clasificar",
  unreadable: (n: number) =>
    n === 1
      ? "1 pago quedó sin monto legible y no está sumado."
      : `${n} pagos quedaron sin monto legible y no están sumados.`,
  noCurrency: "Sin moneda",
  refundLabel: "Devolución",
  failedLabel: "El webhook no lo pudo procesar",
  totalLabel: "Neto del período",
} as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const PAGE_SIZE = 30;

export default async function IngresosPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase } = await requireStaff("global_admin");
  const sp = await searchParams;

  const communities = await listCommunities(supabase);
  const requested = firstParam(sp[COMMUNITY_PARAM]);
  // Acá "todas" es un estado legítimo y además el default: el súper admin
  // quiere ver la plataforma entera antes que una comunidad puntual. Un uuid
  // desconocido cae a "todas" en vez de a una comunidad cualquiera.
  const tenantId = communities.some((community) => community.id === requested)
    ? (requested as string)
    : null;

  const days = parsePeriod(firstParam(sp.dias));
  const { from, to } = periodRange(days);
  const cursor = decodeCursor(firstParam(sp.cursor) ?? undefined);

  const [summary, detail] = await Promise.all([
    getRevenueSummary(supabase, { tenantId, from, to }),
    getRevenueEvents(supabase, { tenantId, from, to, cursor, limit: PAGE_SIZE + 1 }),
  ]);

  // `null` es "la consulta falló" y se dibuja como error; `[]` es "no hubo
  // pagos" y se dibuja como estado vacío. Nunca se colapsan en lo mismo.
  const summaryRows = summary.rows;
  const allEvents = detail.rows;
  const hasMore = (allEvents?.length ?? 0) > PAGE_SIZE;
  const events = allEvents === null ? null : hasMore ? allEvents.slice(0, PAGE_SIZE) : allEvents;
  const last = events?.[events.length - 1];

  const communityName = new Map(communities.map((community) => [community.id, community.name]));

  const hrefFor = (next: { tenant?: string | null; days?: PeriodDays; cursor?: string | null }) => {
    const search = new URLSearchParams();
    const tenant = next.tenant === undefined ? tenantId : next.tenant;
    if (tenant) search.set(COMMUNITY_PARAM, tenant);
    const nextDays = next.days ?? days;
    if (nextDays !== 30) search.set("dias", String(nextDays));
    if (next.cursor) search.set("cursor", next.cursor);
    const qs = search.toString();
    return qs ? `/admin/global/ingresos?${qs}` : "/admin/global/ingresos";
  };

  const unreadableTotal = (summaryRows ?? []).reduce((acc, row) => acc + (row.unreadable ?? 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-foreground">{COPY.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">{COPY.intro}</p>
        </div>

        {!isStripeConfigured && (
          <Banner variant="warning">
            <span>
              <strong className="font-semibold">{COPY.degradedTitle}.</strong> {COPY.degradedBody}
            </span>
          </Banner>
        )}

        <CommunitySwitcher
          basePath="/admin/global/ingresos"
          communities={communities}
          activeTenantId={tenantId}
          isForeign={false}
          keep={{ dias: days === 30 ? undefined : String(days) }}
          allowAll
        />

        <nav aria-label={COPY.periodLegend} className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-foreground-muted">{COPY.periodLegend}</span>
          {PERIOD_DAYS.map((option) => {
            const active = option === days;
            return (
              <Link
                key={option}
                href={hrefFor({ days: option, cursor: null })}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "inline-flex min-h-11 items-center rounded-full border border-brand-subtle bg-brand-tint px-4 text-sm font-semibold text-brand-ink"
                    : "inline-flex min-h-11 items-center rounded-full border border-border bg-surface px-4 text-sm font-medium text-foreground-secondary transition-colors duration-(--duration-fast) ease-(--ease-out-premium) hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
                }
              >
                {PERIOD_LABEL[option]}
              </Link>
            );
          })}
        </nav>
      </header>

      {summaryRows === null ? (
        <p
          role="alert"
          className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-warning-ink"
        >
          <strong className="font-semibold">{COPY.errorTitle}.</strong> {COPY.errorMessage}
        </p>
      ) : summaryRows.length === 0 ? (
        <EmptyState icon={<ChartLineUp />} title={COPY.emptyTitle} message={COPY.emptyMessage} />
      ) : (
        <>
          {unreadableTotal > 0 && (
            <p className="flex items-start gap-1.5 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-warning-ink">
              <WarningCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>{COPY.unreadable(unreadableTotal)}</span>
            </p>
          )}

          <SummaryTable rows={summaryRows} communityName={communityName} />
        </>
      )}

      <section className="flex flex-col gap-3 border-t border-border pt-6">
        <div>
          <h3 className="flex items-center gap-1.5 font-display text-base font-semibold text-foreground">
            <Receipt size={16} aria-hidden="true" />
            {COPY.detailTitle}
          </h3>
          <p className="mt-0.5 text-sm leading-relaxed text-foreground-secondary">
            {COPY.detailIntro}
          </p>
        </div>

        {events === null ? (
          <p
            role="alert"
            className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-warning-ink"
          >
            <strong className="font-semibold">{COPY.errorTitle}.</strong> {COPY.errorMessage}
          </p>
        ) : events.length === 0 ? (
          <p className="text-sm text-foreground-muted">{COPY.emptyMessage}</p>
        ) : (
          <>
            <ol className="flex flex-col gap-2">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg border border-border bg-surface px-4 py-3 shadow-xs"
                >
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm font-medium text-foreground">
                      {productLabel(event.product)}
                      <span className="font-normal text-foreground-secondary">
                        {" · "}
                        {event.tenant_id
                          ? (communityName.get(event.tenant_id) ?? "Comunidad")
                          : COPY.platform}
                      </span>
                    </p>
                    <p className="text-xs text-foreground-muted">
                      <time dateTime={event.received_at}>
                        {formatDate(event.received_at, { withTime: true })}
                      </time>
                      {event.failed && (
                        <span className="text-warning-ink"> · {COPY.failedLabel}</span>
                      )}
                    </p>
                  </div>

                  <p className="text-sm font-semibold tabular-nums text-foreground">
                    {event.amount_cents === null || event.currency === null ? (
                      // El hueco se dibuja como hueco. Una raya no se confunde
                      // con un cero, y eso es exactamente lo que se busca.
                      <span className="font-normal text-foreground-muted">— sin monto legible</span>
                    ) : event.amount_cents < 0 ? (
                      <span className="text-warning-ink">
                        {formatCents(event.amount_cents, event.currency)}{" "}
                        <span className="text-xs font-normal">({COPY.refundLabel})</span>
                      </span>
                    ) : (
                      formatCents(event.amount_cents, event.currency)
                    )}
                  </p>
                </li>
              ))}
            </ol>

            {hasMore && last && (
              <div className="flex justify-center">
                <Link
                  href={hrefFor({ cursor: encodeCursor(last.received_at, last.id) })}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-surface px-5 text-sm font-medium text-foreground transition-colors duration-(--duration-fast) ease-(--ease-out-premium) hover:border-border-strong focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
                >
                  {COPY.more}
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function productLabel(product: string): string {
  return isPriceProduct(product) ? PRODUCT_COPY[product].label : COPY.unclassified;
}

/**
 * El resumen, agrupado por comunidad.
 *
 * No hay un "total general" de la plataforma a propósito: mientras haya más de
 * una moneda, un total único obligaría a inventar un tipo de cambio. Se suma
 * por moneda, y si mañana hay dos, se ven las dos.
 */
function SummaryTable({
  rows,
  communityName,
}: {
  rows: readonly RevenueSummaryRow[];
  communityName: ReadonlyMap<string, string>;
}) {
  const byTenant = new Map<string, RevenueSummaryRow[]>();
  for (const row of rows) {
    const key = row.tenant_id ?? "";
    const list = byTenant.get(key) ?? [];
    list.push(row);
    byTenant.set(key, list);
  }

  return (
    <div className="flex flex-col gap-4">
      {[...byTenant.entries()].map(([tenantKey, tenantRows]) => {
        const totals = new Map<string, number>();
        for (const row of tenantRows) {
          if (row.net_cents === null || row.currency === null) continue;
          totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.net_cents);
        }

        return (
          <section key={tenantKey || "sin-comunidad"} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="font-display text-base font-semibold text-foreground">
                {tenantKey ? (communityName.get(tenantKey) ?? "Comunidad") : COPY.platform}
              </h3>
              <p className="text-sm tabular-nums text-foreground-secondary">
                <span className="text-xs text-foreground-muted">{COPY.totalLabel}: </span>
                {totals.size === 0 ? (
                  <span className="text-foreground-muted">—</span>
                ) : (
                  [...totals.entries()]
                    .map(([currency, cents]) => formatCents(cents, currency))
                    .join(" · ")
                )}
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] border-collapse text-sm">
                <caption className="sr-only">
                  Ingresos por producto de{" "}
                  {tenantKey ? (communityName.get(tenantKey) ?? "la comunidad") : COPY.platform}
                </caption>
                <thead>
                  <tr className="border-b border-border text-left text-xs font-medium text-foreground-muted">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Producto
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      Neto
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      Pagos
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Devoluciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tenantRows.map((row) => (
                    <tr
                      key={`${row.product}-${row.currency ?? "sin"}`}
                      className="border-b border-border last:border-0"
                    >
                      <td className="py-2 pr-3 text-foreground">
                        {productLabel(row.product)}
                        {row.currency === null && (
                          <span className="text-foreground-muted"> · {COPY.noCurrency}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right font-medium tabular-nums text-foreground">
                        {row.net_cents === null || row.currency === null ? (
                          <span className="font-normal text-foreground-muted">—</span>
                        ) : (
                          formatCents(row.net_cents, row.currency)
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-foreground-secondary">
                        {row.payments}
                      </td>
                      <td className="py-2 text-right tabular-nums text-foreground-secondary">
                        {row.refunds}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
