import { Suspense } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { BezelCard, EmptyState, buttonVariants } from "@/components/ui";
import { decodeCursor } from "@/components/listings";
import {
  COPY,
  FeedSkeleton,
  ComposerTrigger,
  SIGUIENDO_EMPTY_COPY,
  parseTab,
  type FeedTabId,
} from "@/components/feed";
// Por ruta y NO por el barril: `FeedModules` lee `next/headers`, y
// `@/components/feed` lo importa un client component que reventaría al
// bundlear código de servidor.
import { FeedModules } from "@/components/feed/feed-modules";
import { FeedModeToggle } from "@/components/feed/feed-mode-toggle";
import { FeedList } from "@/components/feed/feed-list";
import { PullToRefresh } from "@/components/feed/pull-to-refresh";
import { ParaVos, ParaVosSkeleton } from "@/components/matching";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { ZonaVacia } from "@/components/zona";
import { resolverVistaZona } from "@/lib/zona/server";
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

      {/* Conmutador "Para ti | Siguiendo" (0119): solo en los dos tabs
          sociales, y FUERA del Suspense keyeado por la misma razón que los
          círculos — persiste entre navegaciones en vez de remontarse. En un
          tab vertical devuelve null: ahí el círculo activo ya dice dónde
          estás. */}
      <FeedModeToggle active={tab} />

      <Suspense key={`${tab}|${cursorRaw}`} fallback={<ContentSkeleton tab={tab} />}>
        <FeedContent tab={tab} cursorRaw={cursorRaw} />
      </Suspense>
    </>
  );
}

/** Encabezado del feed. Igual para los 6 tabs → nunca se remonta al cambiarlos. */
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
 * La zona ACTIVA para personalizar el subtítulo.
 *
 * Antes acá había un `select area_label` a mano al perfil, y por eso el
 * encabezado y el header de la app podían decir cosas distintas: alguien elegía
 * Bronx arriba y el feed seguía diciendo "cerca de Jackson Heights". Ese
 * desacuerdo es lo que hacía ver rota la feature entera, incluso antes de que
 * el feed filtrara nada. Ahora sale del MISMO lugar que el selector del header
 * (`getZonaActiva`, adentro de `resolverVistaZona`) y no pueden discrepar.
 *
 * Sigue siendo una lectura mínima y aparte del contenido: el encabezado no
 * espera al feed, y `resolverVistaZona` está `cache()`-eada por request — la
 * comparte con la página del feed sin volver a la base.
 */
async function FeedHeaderWithArea() {
  // El try/catch envuelve SOLO el fetch: construir JSX adentro haría que un
  // error de render se tragara acá en vez de subir al error boundary.
  let area: string | null = null;
  try {
    const tenant = await getTenant();
    area = (await resolverVistaZona(tenant.id, null)).zona.label;
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
  const [{ items, nextCursor }, vistaZona] = await Promise.all([
    fetchFeedPageAction({ tab, cursor: cursorRaw || null }),
    resolverVistaZona(tenantId, null),
  ]);

  /**
   * EL VACÍO DE UNA ZONA NO ES EL VACÍO DEL FEED.
   *
   * Con Bronx elegido y nada publicado en Bronx, "todavía no hay nada por acá"
   * es información falsa sobre la comunidad: hay cincuenta publicaciones, están
   * en otro barrio. `ZonaVacia` dice DÓNDE se está mirando y ofrece salir en un
   * toque — la misma pantalla y la misma action que ya usan Empleos, Negocios,
   * Profesionales, Marketplace, Eventos y Vivienda.
   *
   * ── "VACÍA" INCLUYE LA ZONA QUE SÓLO TIENE PUBLICIDAD ───────────────────────
   * Una campaña de alcance total llega a cualquier zona (lo compró), así que un
   * barrio sin una sola publicación propia igual devuelve items: dos avisos de
   * otro barrio y nada más. Eso se lee EXACTAMENTE como la app rota que este
   * bloque existe para evitar. Los avisos se pintan igual —se pagaron— y abajo
   * va la salida, en vez de dejar a alguien creyendo que su zona está muerta.
   *
   * `tab !== "siguiendo"`: esa pestaña NO filtra por zona (0119, "SIN ZONA" —
   * un seguimiento es una decisión ya tomada, no una geografía). Sin este
   * guard, alguien con una zona elegida y cero follows vería "salí de tu
   * zona" — un consejo que no resuelve nada, porque el problema no es la
   * zona: es que no sigue a nadie.
   */
  const organicos = items.filter(
    (item) => item.type !== "post" || !item.post.isPromoted,
  );
  const zonaSinNadaPropio =
    tab !== "siguiendo" &&
    organicos.length === 0 &&
    vistaZona.filtraPorPreferencia &&
    vistaZona.zona.label;

  if (items.length === 0 && zonaSinNadaPropio) {
    return <ZonaVacia zona={vistaZona.zona.label as string} />;
  }

  if (items.length === 0 && tab === "siguiendo") {
    return viewerId ? (
      <EmptyState
        illustration="/images/empty-state-search.png"
        title={SIGUIENDO_EMPTY_COPY.noFollowsTitle}
        message={SIGUIENDO_EMPTY_COPY.noFollowsMessage}
        action={
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            <Link
              href="/negocios"
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              {SIGUIENDO_EMPTY_COPY.noFollowsCtaBusinesses}
            </Link>
            <Link
              href="/profesionales"
              className={buttonVariants({ variant: "outline", size: "md" })}
            >
              {SIGUIENDO_EMPTY_COPY.noFollowsCtaProfessionals}
            </Link>
          </div>
        }
      />
    ) : (
      // Anónimo: "Siguiendo" no existe sin cuenta (0119 §3) — el CTA es
      // entrar, no explorar directorios (eso ya lo ofrece "Para ti").
      <EmptyState
        illustration="/images/empty-state-search.png"
        title={SIGUIENDO_EMPTY_COPY.anonTitle}
        message={SIGUIENDO_EMPTY_COPY.anonMessage}
        action={
          <Link
            href={`/entrar?next=${encodeURIComponent("/feed?tab=siguiendo")}`}
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {SIGUIENDO_EMPTY_COPY.anonCta}
          </Link>
        }
      />
    );
  }

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
    <>
      <FeedList
        tab={tab}
        tenantId={tenantId}
        viewerId={viewerId}
        initialItems={items}
        initialCursor={nextCursor}
        intercalado={intercalado}
      />
      {zonaSinNadaPropio ? (
        <ZonaVacia className="mt-2" zona={vistaZona.zona.label as string} />
      ) : null}
    </>
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
