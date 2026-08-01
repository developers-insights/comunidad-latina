import Link from "next/link";
import { COPY } from "@/lib/metrics/copy";
import { METRICS_RANGES, type MetricsRange } from "@/lib/metrics/types";
import { cn } from "@/lib/utils";

/**
 * Filtros del tablero: período y (sólo para global_admin) comunidad.
 *
 * Son LINKS, no un componente cliente con estado. El tablero se recalcula en el
 * servidor, así que el filtro es una URL: se puede compartir, marcar como
 * favorito y volver con el botón atrás del navegador. Un `useState` acá
 * agregaría JavaScript al bundle para perder todo eso.
 */

export interface CommunityOption {
  /** null = todas las comunidades (sólo global_admin). */
  id: string | null;
  name: string;
}

function buildHref(params: { days: number; tenant: string | null }): string {
  const search = new URLSearchParams();
  search.set("dias", String(params.days));
  if (params.tenant) search.set("comunidad", params.tenant);
  return `/admin/metricas?${search.toString()}`;
}

/**
 * Pastilla del filtro. min-h-11 = 44px: es un control táctil, aunque viva en un
 * panel que se usa mayormente con mouse.
 *
 * El estado activo NO se apoya sólo en el color: además del tinte de marca
 * lleva `aria-current="page"` y peso semibold, así que se distingue con la
 * pantalla en escala de grises y se anuncia en un lector de pantalla.
 */
const pillClass = (active: boolean) =>
  cn(
    "inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm",
    "transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
    active
      ? "border-brand-subtle bg-brand-tint font-semibold text-brand-ink"
      : "border-border bg-surface font-medium text-foreground-secondary hover:border-border-strong hover:text-foreground",
  );

export function MetricsFilters({
  days,
  tenantId,
  communities,
}: {
  days: MetricsRange;
  tenantId: string | null;
  /** Vacío para domain_admin: no elige comunidad porque tiene una sola. */
  communities: CommunityOption[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <nav aria-label={COPY.rangeLabel} className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-foreground-muted">{COPY.rangeLabel}</span>
        {METRICS_RANGES.map((range) => (
          <Link
            key={range}
            href={buildHref({ days: range, tenant: tenantId })}
            aria-current={range === days ? "page" : undefined}
            className={pillClass(range === days)}
          >
            {COPY.ranges[range]}
          </Link>
        ))}
      </nav>

      {communities.length > 1 && (
        <nav aria-label={COPY.communityLabel} className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-foreground-muted">{COPY.communityLabel}</span>
          {communities.map((community) => (
            <Link
              key={community.id ?? "todas"}
              href={buildHref({ days, tenant: community.id })}
              aria-current={community.id === tenantId ? "page" : undefined}
              className={pillClass(community.id === tenantId)}
            >
              {community.name}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
