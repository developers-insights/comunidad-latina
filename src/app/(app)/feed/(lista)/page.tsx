import { Suspense } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { BezelCard, EmptyState, buttonVariants } from "@/components/ui";
import { decodeCursor } from "@/components/listings";
import {
  COPY,
  FeedSkeleton,
  ComposerTrigger,
  parseTab,
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
import { getCaraActiva } from "@/lib/perfil-activo/cara";
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

      <FeedModules active={tab} />

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

  /**
   * La cara con la que se va a publicar, no la de la persona. Acá había una
   * consulta propia a `profiles` con el comentario «publica siempre como sí
   * mismo»: dejó de ser cierto con la 0103 y por eso la tarjeta de publicar
   * seguía mostrando el nombre y la foto personales mientras el header ya
   * mostraba el negocio. Una sola fuente ahora — ver @/lib/perfil-activo/cara.
   */
  const cara = user ? await getCaraActiva() : null;

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
            <ComposerTrigger
              viewerName={cara?.displayName ?? ""}
              viewerAvatarUrl={cara?.avatarUrl ?? null}
              negocio={cara?.negocio ? { nombre: cara.negocio.nombre } : null}
            />
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
  intercalado,
}: {
  tab: FeedTabId;
  tenantId: string;
  viewerId: string | null;
  cursorRaw: string;
  /** Bloque que se intercala después de las primeras publicaciones. */
  intercalado?: ReactNode;
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
function ContentSkeleton({ tab }: { tab: FeedTabId }) {
  return (
    <div aria-busy="true" className="mt-4">
      <FeedSkeleton withComposer={tab === "para-ti"} />
    </div>
  );
}
