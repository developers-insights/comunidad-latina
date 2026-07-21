import { Suspense } from "react";
import Link from "next/link";
import { BezelCard, EmptyState, buttonVariants } from "@/components/ui";
import { decodeCursor } from "@/components/listings";
import {
  COPY,
  FeedSkeleton,
  FeedTabs,
  PostComposer,
  parseTab,
  type FeedTabId,
} from "@/components/feed";
import { FeedList } from "@/components/feed/feed-list";
import { PullToRefresh } from "@/components/feed/pull-to-refresh";
import { ParaVos, ParaVosSkeleton } from "@/components/matching";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { fetchFeedPageAction } from "./load-more";

export const metadata = { title: "Feed" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function FeedPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const tab = parseTab(firstValue(sp.tab) || undefined);
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

      <FeedTabs active={tab} />

      <Suspense key={`${tab}|${cursorRaw}`} fallback={<ContentSkeleton tab={tab} />}>
        <FeedContent tab={tab} cursorRaw={cursorRaw} />
      </Suspense>
    </>
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

async function FeedContent({ tab, cursorRaw }: { tab: FeedTabId; cursorRaw: string }) {
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
      {tab === "para-ti" ? (
        <>
          {user ? (
            <PostComposer viewerName={viewerName} viewerAvatarUrl={viewerAvatarUrl} />
          ) : (
            <ComposerInvite />
          )}
          {/* Matching "Para vos" (módulo MATCHING): solo logueados; primera página. */}
          {user && isFirstPage && (
            <Suspense fallback={<ParaVosSkeleton />}>
              <ParaVos userId={user.id} />
            </Suspense>
          )}
          <FeedRoot
            tab={tab}
            tenantId={tenant.id}
            viewerId={user?.id ?? null}
            cursorRaw={cursorRaw}
          />
        </>
      ) : (
        <FeedRoot
          tab={tab}
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
  tenantId,
  viewerId,
  cursorRaw,
}: {
  tab: FeedTabId;
  tenantId: string;
  viewerId: string | null;
  cursorRaw: string;
}) {
  const { items, nextCursor } = await fetchFeedPageAction({
    tab,
    cursor: cursorRaw || null,
  });

  if (items.length === 0) {
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
      tenantId={tenantId}
      viewerId={viewerId}
      initialItems={items}
      initialCursor={nextCursor}
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
          href="/registro"
          className={buttonVariants({ variant: "primary", size: "sm" })}
        >
          {COPY.inviteCard.cta}
        </Link>
        <Link
          href="/entrar?next=/feed"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          {COPY.inviteCard.secondary}
        </Link>
      </div>
    </BezelCard>
  );
}

// ---------------------------------------------------------------------------
// Fallback de Suspense: header + tabs + shimmer (§5.2)
// ---------------------------------------------------------------------------

/** Solo el contenido: el encabezado y los tabs ya están montados y persisten. */
function ContentSkeleton({ tab }: { tab: FeedTabId }) {
  return (
    <div aria-busy="true" className="mt-4">
      <FeedSkeleton withComposer={tab === "para-ti"} />
    </div>
  );
}
