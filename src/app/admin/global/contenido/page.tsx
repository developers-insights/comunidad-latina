import Link from "next/link";
import { ArrowRight, ListMagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import { Badge, EmptyState, NavTabs, type NavTabItem } from "@/components/ui";
import { CommunitySwitcher } from "@/components/admin/community-switcher";
import { formatDate } from "@/lib/utils";
import { requireStaff } from "../../guard";
import { COMMUNITY_PARAM, firstParam, resolveAdminScope } from "../../scope";
import { fetchContentPage, fetchResourceCounts } from "./queries";
import {
  DEFAULT_RESOURCE,
  isResourceKey,
  RESOURCES,
  RESOURCE_KEYS,
  STATUS_LABEL,
  statusVariant,
} from "./resources";

export const metadata = { title: "Contenido" };

/**
 * Listados navegables por comunidad (solo `global_admin`).
 *
 * Hasta acá, el panel Global mostraba CONTEOS: "esta comunidad tiene 412
 * miembros y 87 avisos". El pliego pide poder VER — usuarios, publicaciones,
 * negocios, profesionales, empleos, propiedades, eventos, marketplace e
 * influencers, por dominio. Esto es esa pantalla.
 *
 * ES DE LECTURA, A PROPÓSITO. No hay botones de moderar acá: moderar tiene su
 * cola (`/admin/moderacion`) y sancionar tiene la suya (`/admin/miembros`), las
 * dos con su propia auditoría y sus propias reglas. Un listado que además
 * borrara cosas sería una tercera puerta a las mismas decisiones, con menos
 * contexto que las otras dos.
 */

const COPY = {
  title: "Contenido por comunidad",
  intro: "Mirá lo que hay publicado en cada comunidad, sección por sección.",
  noCommunity: "Elegí una comunidad",
  noCommunityMessage: "Arriba están todas. Elegí una para ver lo que tiene publicado.",
  errorTitle: "No pudimos traer esta lista",
  errorMessage:
    "Algo falló de nuestro lado — no es tu culpa. Probá de nuevo o cambiá de sección.",
  more: "Ver más",
  noAuthor: "Sin autor registrado",
  tabsLabel: "Secciones de la comunidad",
} as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ContenidoPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireStaff("global_admin");
  const sp = await searchParams;
  const scope = await resolveAdminScope(ctx, firstParam(sp[COMMUNITY_PARAM]));

  const rawResource = firstParam(sp.recurso);
  const resource = isResourceKey(rawResource) ? rawResource : DEFAULT_RESOURCE;
  const cursor = firstParam(sp.cursor);
  const tenantId = scope.tenantId;

  const definition = RESOURCES[resource];

  const hrefFor = (params: { recurso?: string; cursor?: string | null }) => {
    const search = new URLSearchParams();
    if (tenantId) search.set(COMMUNITY_PARAM, tenantId);
    search.set("recurso", params.recurso ?? resource);
    if (params.cursor) search.set("cursor", params.cursor);
    return `/admin/global/contenido?${search.toString()}`;
  };

  const [page, counts] = tenantId
    ? await Promise.all([
        fetchContentPage(ctx.supabase, { tenantId, resource, cursor }),
        fetchResourceCounts(ctx.supabase, tenantId),
      ])
    : [null, null];

  const tabs: NavTabItem[] = RESOURCE_KEYS.map((key) => ({
    id: key,
    label: RESOURCES[key].label,
    href: hrefFor({ recurso: key, cursor: null }),
    ...(counts?.[key] != null ? { count: counts[key] as number } : {}),
  }));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-foreground">{COPY.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">{COPY.intro}</p>
        </div>
        <CommunitySwitcher
          basePath="/admin/global/contenido"
          communities={scope.communities}
          activeTenantId={tenantId}
          isForeign={false}
          keep={{ recurso: resource }}
        />
      </header>

      {!tenantId || !page ? (
        <EmptyState
          icon={<ListMagnifyingGlass />}
          title={COPY.noCommunity}
          message={COPY.noCommunityMessage}
        />
      ) : (
        <>
          <NavTabs items={tabs} active={resource} label={COPY.tabsLabel} />

          <section aria-labelledby="contenido-lista" className="flex flex-col gap-3">
            <div>
              <h3
                id="contenido-lista"
                className="font-display text-lg font-semibold text-foreground"
              >
                {definition.title}
              </h3>
              <p className="mt-1 text-sm text-foreground-secondary">{definition.intro}</p>
            </div>

            {page.failed ? (
              <p
                role="alert"
                className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-warning-ink"
              >
                <strong className="font-semibold">{COPY.errorTitle}.</strong>{" "}
                {COPY.errorMessage}
              </p>
            ) : page.items.length === 0 ? (
              <EmptyState
                icon={<ListMagnifyingGlass />}
                title={definition.emptyTitle}
                message={definition.emptyMessage}
                className="py-10"
              />
            ) : (
              <>
                <ul className="flex flex-col gap-2">
                  {page.items.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface px-4 py-3 shadow-xs"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-foreground">
                          {item.title}
                        </p>
                        {item.status && (
                          <Badge variant={statusVariant(item.status)}>
                            {STATUS_LABEL[item.status] ?? item.status}
                          </Badge>
                        )}
                      </div>
                      {item.subtitle && (
                        <p className="text-xs text-foreground-secondary">{item.subtitle}</p>
                      )}
                      <p className="text-xs text-foreground-muted">
                        {item.authorName ?? COPY.noAuthor} ·{" "}
                        <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                      </p>
                    </li>
                  ))}
                </ul>

                {page.nextCursor && (
                  <div className="flex justify-center">
                    <Link
                      href={hrefFor({ cursor: page.nextCursor })}
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
        </>
      )}
    </div>
  );
}
