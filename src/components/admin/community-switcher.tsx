import Link from "next/link";
import { Buildings, Eye } from "@phosphor-icons/react/dist/ssr";
import type { CommunityOption } from "@/app/admin/scope";
import { cn } from "@/lib/utils";

/**
 * Selector de comunidad del súper admin (Miembros / Dominio / Empleos).
 *
 * SON ENLACES, NO ESTADO DE CLIENTE. La comunidad activa es un parámetro de la
 * URL que el servidor vuelve a resolver en cada request contra el rol real del
 * JWT (ver `src/app/admin/scope.ts`). Por eso no hay `useState`, ni cookie, ni
 * nada que el navegador pueda conservar: si el token deja de ser de un súper
 * admin, el mismo link deja de cambiar de comunidad — no hace falta "cerrar" la
 * sesión de contexto porque nunca existió una.
 *
 * Este componente NO es la barrera de seguridad. Es la comodidad de arriba.
 */

const COPY = {
  label: "Comunidad",
  all: "Todas",
  foreignTitle: "Estás mirando otra comunidad",
  foreignBody:
    "Todo lo que ves acá abajo es de esta comunidad, no de la tuya. Revisá el nombre antes de tocar algo.",
  empty: "Todavía no hay comunidades para elegir.",
} as const;

const pillClass = (active: boolean) =>
  cn(
    "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm",
    "transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
    active
      ? "border-brand-subtle bg-brand-tint font-semibold text-brand-ink"
      : "border-border bg-surface font-medium text-foreground-secondary hover:border-border-strong hover:text-foreground",
  );

export interface CommunitySwitcherProps {
  /** Ruta sobre la que se navega (ej. "/admin/miembros"). */
  basePath: string;
  communities: CommunityOption[];
  /** Comunidad activa resuelta EN EL SERVER (no la pedida por la URL). */
  activeTenantId: string | null;
  /** true cuando la comunidad activa no es la del propio súper admin. */
  isForeign: boolean;
  /** Parámetros de la URL que hay que conservar al cambiar de comunidad. */
  keep?: Record<string, string | undefined>;
  /**
   * Agrega la opción "Todas". Sólo tiene sentido donde mirar TODO es un estado
   * legítimo (el registro de acciones), no donde la pantalla necesita sí o sí
   * una comunidad para consultar.
   */
  allowAll?: boolean;
}

export function CommunitySwitcher({
  basePath,
  communities,
  activeTenantId,
  isForeign,
  keep,
  allowAll = false,
}: CommunitySwitcherProps) {
  if (communities.length === 0) {
    return <p className="text-sm text-foreground-secondary">{COPY.empty}</p>;
  }

  const hrefFor = (tenantId: string | null) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(keep ?? {})) {
      if (value) search.set(key, value);
    }
    if (tenantId) search.set("comunidad", tenantId);
    const query = search.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  return (
    <div className="flex flex-col gap-2">
      <nav aria-label={COPY.label} className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-foreground-muted">
          <Buildings size={14} aria-hidden="true" />
          {COPY.label}
        </span>
        {allowAll && (
          <Link
            href={hrefFor(null)}
            aria-current={activeTenantId === null ? "page" : undefined}
            className={pillClass(activeTenantId === null)}
          >
            {COPY.all}
          </Link>
        )}
        {communities.map((community) => {
          const active = community.id === activeTenantId;
          return (
            <Link
              key={community.id}
              href={hrefFor(community.id)}
              aria-current={active ? "page" : undefined}
              className={pillClass(active)}
            >
              {community.name}
              {community.status !== "active" && (
                <span className="text-xs font-normal text-foreground-muted">· pausada</span>
              )}
            </Link>
          );
        })}
      </nav>

      {isForeign && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-md border border-border-subtle bg-surface-subtle px-3 py-2 text-xs leading-relaxed text-foreground-secondary"
        >
          <Eye size={16} aria-hidden="true" className="mt-px shrink-0 text-foreground-muted" />
          <span>
            <strong className="font-semibold text-foreground">{COPY.foreignTitle}.</strong>{" "}
            {COPY.foreignBody}
          </span>
        </p>
      )}
    </div>
  );
}
