import { Suspense } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { BezelCard, EmptyState, NavTabs, buttonVariants } from "@/components/ui";
import { decodeCursor } from "@/components/listings";
import {
  COPY,
  FEED_SCOPES,
  FEED_SCOPE_LABELS,
  FeedSkeleton,
  ComposerTrigger,
  feedScopeHref,
  parseFeedScope,
  parseTab,
  type FeedScope,
  type FeedTabId,
} from "@/components/feed";
// Por ruta y NO por el barril: `FeedModules` lee `next/headers`, y
// `@/components/feed` lo importa un client component que reventaría al
// bundlear código de servidor.
import { FeedModules } from "@/components/feed/feed-modules";
import { FeedList } from "@/components/feed/feed-list";
import { PullToRefresh } from "@/components/feed/pull-to-refresh";
import { ParaVos, ParaVosSkeleton } from "@/components/matching";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { FeedAlert } from "../alert-banner";
import { fetchFeedPageAction } from "../load-more";

export const metadata = { title: "Feed" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function FeedPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const tab = parseTab(firstValue(sp.tab) || undefined);
  // Las dos mitades del feed (spec §8). Se lee de `?ver=` y convive con `?tab=`
  // — ver el encabezado de `feed-scope.ts` para por qué son dos parámetros.
  const scope = parseFeedScope(firstValue(sp.ver) || undefined);
  // Retrocompat: un link viejo (o compartido) con `?cursor=` sigue funcionando
  // SSR — arranca la primera pantalla desde ESE punto del keyset (el composer
  // y "Para vos" se ocultan, igual que antes). La UI nueva ya no genera esta
  // URL: el scroll infinito de <FeedList> pide las páginas siguientes por
  // server action, sin navegar.
  const cursorRaw = firstValue(sp.cursor);

  return (
    <>
      {/* Encabezado y tabs VIVEN FUERA del Suspense keyeado a propósito: ese
          límite se remonta en cada cambio de tab, y con los tabs adentro la
          barrita del subrayado se destruía y volvía a nacer en la posición
          nueva — no se deslizaba, y el componente perdía de dónde venía (que
          es lo que gradúa el rebote). Acá persisten entre navegaciones. */}
      <Suspense fallback={<FeedHeader area={null} />}>
        <FeedHeaderWithArea />
      </Suspense>

      {/* Alerta comunitaria (call cliente 2026-07-27). Va ARRIBA de los tabs,
          no entre los tabs y su lista: los tabs son el control de ese listado y
          meterle un recuadro en el medio se lee como que algo se rompió. Acá es
          lo primero del área de contenido y se ve en cualquier tab, incluso al
          abrir un link viejo con `?cursor=` (donde el composer ni aparece).
          `fallback={null}`: sin alerta —o mientras viaja la query— el feed no
          reserva NI UN PÍXEL. */}
      <Suspense fallback={null}>
        <FeedAlert />
      </Suspense>

      {/* SIGUIENDO | PARA TI — arriba de la fila de módulos porque responden
          preguntas de distinto nivel: primero DE QUIÉN es lo que estoy viendo,
          después de qué vertical. Invertirlas haría que el vertical elegido
          pareciera cambiar de significado al cruzar de mitad. */}
      <FeedScopeTabs scope={scope} tab={tab} />

      {/* La fila de módulos SÓLO en «Para ti»: en «Siguiendo» el vertical no se
          aplica (ver `fetchFeedPageAction`), así que ofrecerla sería ofrecer
          cinco filtros que no filtran. */}
      {scope === "para-ti" && <FeedModules active={tab} />}

      <Suspense
        key={`${scope}|${tab}|${cursorRaw}`}
        fallback={<ContentSkeleton tab={tab} scope={scope} />}
      >
        <FeedContent tab={tab} scope={scope} cursorRaw={cursorRaw} />
      </Suspense>
    </>
  );
}

/**
 * Las dos mitades del feed, como NAVEGACIÓN y no como widget: cada una es una
 * URL propia que resuelve un Server Component distinto, así que son enlaces con
 * `aria-current`, nunca `role="tab"` (el porqué largo está en `ui/nav-tabs.tsx`).
 *
 * Vive FUERA del Suspense keyeado, igual que el encabezado: ese límite se
 * remonta al cambiar de mitad, y con las pestañas adentro el subrayado activo
 * se destruiría y volvería a nacer en vez de quedarse quieto.
 */
function FeedScopeTabs({ scope, tab }: { scope: FeedScope; tab: FeedTabId }) {
  return (
    <NavTabs
      className="mb-1"
      label={COPY.scope.navLabel}
      active={scope}
      items={FEED_SCOPES.map((id) => ({
        id,
        label: FEED_SCOPE_LABELS[id],
        href: feedScopeHref(id, tab),
      }))}
    />
  );
}

/** Encabezado del feed. Igual para los 5 tabs → nunca se remonta al cambiarlos. */
function FeedHeader({ area }: { area: string | null }) {
  return (
    <header className="mb-3">
      <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
        {COPY.header.title}
      </h1>
      <p className="mt-0.5 text-sm text-foreground-secondary">
        {area ? COPY.header.subtitleNearArea(area) : COPY.header.subtitleDefault}
      </p>
    </header>
  );
}

/**
 * Solo la zona del usuario para personalizar el subtítulo. Query mínima y
 * aparte del contenido: el encabezado no tiene por qué esperar al feed, y así
 * puede quedar fuera del límite que se remonta por tab.
 */
async function FeedHeaderWithArea() {
  // El try/catch envuelve SOLO el fetch: construir JSX adentro haría que un
  // error de render se tragara acá en vez de subir al error boundary.
  let area: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("area_label")
        .eq("id", user.id)
        .maybeSingle();
      area = profile?.area_label ?? null;
    }
  } catch {
    area = null; // sin zona: el subtítulo cae al genérico, nunca un error.
  }
  return <FeedHeader area={area} />;
}

// ---------------------------------------------------------------------------
// Contenido (streamed): datos reales con la RLS del usuario
// ---------------------------------------------------------------------------

async function FeedContent({
  tab,
  scope,
  cursorRaw,
}: {
  tab: FeedTabId;
  scope: FeedScope;
  cursorRaw: string;
}) {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Identidad del usuario para el composer (publica siempre como sí mismo).
  let viewerName = "";
  let viewerAvatarUrl: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle();
    viewerName = profile?.display_name ?? "";
    viewerAvatarUrl = profile?.avatar_url ?? null;
  }

  const isFirstPage = !decodeCursor(cursorRaw || undefined);

  return (
    // Pull-to-refresh (módulo FLUIDEZ) envuelve TODO el contenido del tab: el
    // gesto dispara router.refresh(), que vuelve a correr este mismo Server
    // Component con datos frescos. mt-4/flex/gap-4 reemplazan al div que antes
    // envolvía composer+"Para vos"+feed (mismo espaciado visual de siempre).
    <PullToRefresh className="mt-4 flex flex-col gap-4">
      {scope === "para-ti" && tab === "para-ti" ? (
        <>
          {user ? (
            <ComposerTrigger viewerName={viewerName} viewerAvatarUrl={viewerAvatarUrl} />
          ) : (
            <ComposerInvite />
          )}
          {/* Matching "Para vos" (módulo MATCHING): solo logueados; primera
              página. Ya NO va acá arriba — viaja como bloque intercalado y
              aparece después de las primeras publicaciones. El pedido del
              cliente fue exacto: lo primero que se veía al abrir la app eran
              dos avisos recomendados, y lo que tiene que verse es el feed. */}
          <FeedRoot
            tab={tab}
            scope={scope}
            tenantId={tenant.id}
            viewerId={user?.id ?? null}
            cursorRaw={cursorRaw}
            intercalado={
              user && isFirstPage ? (
                <Suspense fallback={<ParaVosSkeleton />}>
                  <ParaVos userId={user.id} />
                </Suspense>
              ) : null
            }
          />
        </>
      ) : (
        <FeedRoot
          tab={tab}
          scope={scope}
          tenantId={tenant.id}
          viewerId={user?.id ?? null}
          cursorRaw={cursorRaw}
        />
      )}
    </PullToRefresh>
  );
}

// ---------------------------------------------------------------------------
// Primera página de CUALQUIER tab, vía la MISMA server action que usa el
// scroll infinito (load-more.ts) — nunca dos implementaciones del keyset.
// ---------------------------------------------------------------------------

async function FeedRoot({
  tab,
  scope,
  tenantId,
  viewerId,
  cursorRaw,
  intercalado,
}: {
  tab: FeedTabId;
  scope: FeedScope;
  tenantId: string;
  viewerId: string | null;
  cursorRaw: string;
  /** Bloque que se intercala después de las primeras publicaciones. */
  intercalado?: ReactNode;
}) {
  const { items, nextCursor } = await fetchFeedPageAction({
    tab,
    scope,
    cursor: cursorRaw || null,
  });

  if (items.length === 0) {
    /**
     * EL VACÍO DE «SIGUIENDO» NO ES EL VACÍO DEL FEED. Que no haya nada acá casi
     * nunca significa que la comunidad esté vacía: significa que esta persona
     * todavía no sigue a nadie, o que quienes sigue no publicaron. Ofrecerle
     * "Publicá algo" sería contestar una pregunta que no hizo; lo que necesita
     * es a dónde ir a encontrar gente y negocios.
     */
    if (scope === "siguiendo") {
      return (
        <EmptyState
          illustration="/images/empty-state-search.png"
          title={viewerId ? COPY.scope.emptyTitle : COPY.scope.anonTitle}
          message={viewerId ? COPY.scope.emptyMessage : COPY.scope.anonMessage}
          action={
            <Link
              href={viewerId ? "/buscar" : "/entrar?next=/feed%3Fver%3Dsiguiendo"}
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              {viewerId ? COPY.scope.emptyCta : COPY.scope.anonCta}
            </Link>
          }
        />
      );
    }
    return tab === "para-ti" ? (
      <EmptyState
        illustration="/images/empty-state-search.png"
        title={COPY.feed.emptyParaTiTitle}
        message={COPY.feed.emptyParaTiMessage}
        action={
          <Link
            href="/publicar"
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {COPY.feed.emptyParaTiCta}
          </Link>
        }
      />
    ) : (
      <EmptyState
        illustration="/images/empty-state-search.png"
        title={COPY.feed.emptyListingsTitle}
        message={COPY.feed.emptyListingsMessage}
        action={
          <Link
            href="/publicar"
            className={buttonVariants({ variant: "outline", size: "md" })}
          >
            {COPY.feed.emptyListingsCta}
          </Link>
        }
      />
    );
  }

  return (
    <FeedList
      tab={tab}
      scope={scope}
      tenantId={tenantId}
      viewerId={viewerId}
      initialItems={items}
      initialCursor={nextCursor}
      intercalado={intercalado}
    />
  );
}

// ---------------------------------------------------------------------------
// Invitación para anónimos (arriba del feed, en lugar del composer)
// ---------------------------------------------------------------------------

function ComposerInvite() {
  return (
    <BezelCard variant="featured" coreClassName="flex flex-col gap-3 p-5">
      <div>
        <h2 className="font-display text-lg font-bold text-foreground">
          {COPY.inviteCard.title}
        </h2>
        <p className="mt-1 text-sm text-foreground-secondary">{COPY.inviteCard.body}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <Link
          href="/entrar?next=/feed"
          className={buttonVariants({ variant: "primary", size: "sm" })}
        >
          {COPY.inviteCard.cta}
        </Link>
      </div>
    </BezelCard>
  );
}

// ---------------------------------------------------------------------------
// Fallback de Suspense: header + tabs + shimmer (§5.2)
// ---------------------------------------------------------------------------

/** Solo el contenido: el encabezado y los tabs ya están montados y persisten. */
function ContentSkeleton({ tab, scope }: { tab: FeedTabId; scope: FeedScope }) {
  return (
    <div aria-busy="true" className="mt-4">
      {/* El composer sólo se dibuja donde de verdad va a aparecer: reservarle
          el espacio en «Siguiendo» haría que la pantalla salte al cargar. */}
      <FeedSkeleton withComposer={scope === "para-ti" && tab === "para-ti"} />
    </div>
  );
}
