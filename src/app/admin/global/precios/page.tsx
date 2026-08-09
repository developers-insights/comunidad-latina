import { ClockCounterClockwise, Tag } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import { CommunitySwitcher } from "@/components/admin/community-switcher";
import { PriceEditor } from "@/components/admin/price-editor";
import { PRODUCT_COPY, formatCents, isPriceProduct } from "@/lib/pricing";
import { getPriceHistory, getTenantPrices } from "@/lib/pricing/read";
import { formatDate } from "@/lib/utils";
import { requireStaff } from "../../guard";
import { COMMUNITY_PARAM, firstParam, resolveAdminScope } from "../../scope";

export const metadata = { title: "Planes y precios" };

/**
 * PLANES Y PRECIOS POR COMUNIDAD (solo `global_admin`).
 *
 * El pliego lo pide con todas las letras: "configurar planes y precios por
 * dominio". Hasta la migración 0072 los montos eran constantes en
 * `src/lib/stripe/index.ts`, marcadas como precios de ejemplo, y cambiar uno
 * era un commit y un deploy — el mismo para las cuatro comunidades. Esta es la
 * pantalla que faltaba.
 *
 * NO HAY "TODAS" EN EL SELECTOR. Un precio pertenece a UNA comunidad: mostrar
 * catorce casillas sin decir de quién son es la forma más corta de cambiarle la
 * tarifa a la comunidad equivocada. El selector obliga a elegir, y el nombre de
 * la comunidad aparece en cada confirmación de guardado.
 *
 * LO QUE VE QUIEN ENTRA, EN ORDEN
 *   1. De qué comunidad son estos precios.
 *   2. Los catorce precios vigentes, agrupados por producto, con etiqueta
 *      "Por defecto" en los que todavía salen del código.
 *   3. Los últimos cambios, con el valor viejo y el nuevo — que es lo que hace
 *      falta el día que alguien pregunta por qué le cobraron distinto.
 */

const COPY = {
  title: "Planes y precios",
  intro:
    "Lo que cobra esta comunidad por cada producto. Se guarda en centavos, con la moneda escrita — igual que lo cobra Stripe.",
  fallbackNote:
    "Los precios marcados como “Por defecto” todavía salen de los valores de fábrica. En cuanto guardes uno, pasa a valer el que fijaste acá.",
  noCommunityTitle: "Elegí una comunidad",
  noCommunityMessage:
    "Los precios son de cada comunidad, no de la plataforma. Elegí cuál querés configurar.",
  historyTitle: "Últimos cambios",
  historyIntro:
    "Cambiar un precio no borra el anterior. Este registro es lo que permite explicar un cobro viejo.",
  historyEmpty: "Todavía nadie cambió un precio en esta comunidad.",
  historyBroken: "No pudimos leer el historial en este momento.",
  historyCreated: "quedó fijado en",
  historyChanged: "pasó de",
  historyTo: "a",
  unknownActor: "Alguien del equipo",
} as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PreciosPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireStaff("global_admin");
  const sp = await searchParams;

  const scope = await resolveAdminScope(ctx, firstParam(sp[COMMUNITY_PARAM]));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-foreground">{COPY.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">{COPY.intro}</p>
          <p className="mt-2 text-xs leading-relaxed text-foreground-muted">{COPY.fallbackNote}</p>
        </div>
        <CommunitySwitcher
          basePath="/admin/global/precios"
          communities={scope.communities}
          activeTenantId={scope.tenantId}
          isForeign={scope.isForeign}
        />
      </header>

      {scope.tenantId === null ? (
        <EmptyState
          icon={<Tag />}
          title={COPY.noCommunityTitle}
          message={COPY.noCommunityMessage}
        />
      ) : (
        <>
          <PriceEditor
            tenantId={scope.tenantId}
            tenantName={scope.tenantName ?? "esta comunidad"}
            prices={await getTenantPrices(ctx.supabase, scope.tenantId)}
          />
          <PriceHistory supabase={ctx.supabase} tenantId={scope.tenantId} />
        </>
      )}
    </div>
  );
}

/**
 * El historial, en una sola frase por cambio.
 *
 * `null` (no se pudo leer) y `[]` (no hubo cambios) se dibujan DISTINTO a
 * propósito: decir "todavía nadie cambió un precio" cuando en realidad la
 * consulta falló es exactamente la clase de mentira por omisión que un registro
 * de cambios de precio no se puede permitir.
 */
async function PriceHistory({
  supabase,
  tenantId,
}: {
  supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"];
  tenantId: string;
}) {
  const rows = await getPriceHistory(supabase, tenantId);

  const actorIds = [
    ...new Set((rows ?? []).map((row) => row.changed_by).filter((id): id is string => Boolean(id))),
  ];
  const { data: actors } = actorIds.length
    ? await supabase.from("profiles").select("id, display_name").in("id", actorIds)
    : { data: [] as Array<{ id: string; display_name: string }> };
  const actorName = new Map((actors ?? []).map((row) => [row.id, row.display_name]));

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-6">
      <div>
        <h3 className="flex items-center gap-1.5 font-display text-base font-semibold text-foreground">
          <ClockCounterClockwise size={16} aria-hidden="true" />
          {COPY.historyTitle}
        </h3>
        <p className="mt-0.5 text-sm leading-relaxed text-foreground-secondary">
          {COPY.historyIntro}
        </p>
      </div>

      {rows === null ? (
        <p
          role="alert"
          className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-warning-ink"
        >
          {COPY.historyBroken}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-foreground-muted">{COPY.historyEmpty}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rows.map((row) => {
            const productLabel = isPriceProduct(row.product)
              ? PRODUCT_COPY[row.product].label
              : row.product;
            const isCreation = row.old_amount_cents === null;

            return (
              <li
                key={row.id}
                className="flex flex-col gap-0.5 rounded-lg border border-border bg-surface px-4 py-2.5 shadow-xs"
              >
                <p className="text-sm leading-snug text-foreground">
                  <span className="font-medium">{productLabel}</span>{" "}
                  <span className="text-foreground-secondary">
                    · {row.variant} · {row.billing_interval}
                  </span>
                </p>
                <p className="text-sm tabular-nums text-foreground-secondary">
                  {isCreation ? (
                    <>
                      {COPY.historyCreated}{" "}
                      <strong className="font-semibold text-foreground">
                        {formatCents(row.new_amount_cents, row.new_currency)}
                      </strong>
                    </>
                  ) : (
                    <>
                      {COPY.historyChanged}{" "}
                      {formatCents(row.old_amount_cents ?? 0, row.old_currency ?? row.new_currency)}{" "}
                      {COPY.historyTo}{" "}
                      <strong className="font-semibold text-foreground">
                        {formatCents(row.new_amount_cents, row.new_currency)}
                      </strong>
                    </>
                  )}
                </p>
                <p className="text-xs text-foreground-muted">
                  {(row.changed_by ? actorName.get(row.changed_by) : null) ?? COPY.unknownActor} ·{" "}
                  <time dateTime={row.changed_at}>
                    {formatDate(row.changed_at, { withTime: true })}
                  </time>
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
