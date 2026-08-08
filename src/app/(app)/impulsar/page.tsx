import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Briefcase,
  CalendarBlank,
  ChatCircle,
  House,
  Megaphone,
  Play,
  Storefront,
  UserGear,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { EmptyState, buttonVariants } from "@/components/ui";
import { AdChip } from "@/components/feed/card-ad-chip";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";
import {
  toListingImpulsarItem,
  toPostImpulsarItem,
  type ImpulsarItem,
} from "./impulsar-items";

export const metadata = { title: "Impulsar" };

/**
 * Copy local del índice (feedback cliente Geovanny, 2026-08-05: falta un
 * lugar único desde donde promocionar CUALQUIER cosa propia — hoy /impulsar
 * solo existe con un [listingId] en la URL).
 *
 * TODO(integración): mover a feed/copy.ts — ese archivo lo está editando otro
 * agente en simultáneo, se declara acá para no pisarle el merge.
 */
const COPY = {
  title: "Impulsar",
  subtitle: "Pagá para que un aviso o una publicación tuya llegue a más gente en tu zona.",
  listingsHeading: "Tus avisos",
  postsHeading: "Tus publicaciones",
  promoteCta: "Promocionar",
  pendingReview: "Todavía en revisión",
  emptyAllTitle: "Todavía no tenés nada para promocionar",
  emptyAllMessage:
    "Publicá un aviso o una publicación y volvé por acá cuando quieras que llegue a más gente.",
  emptyAllCta: "Publicar algo",
  emptyListings: "Todavía no publicaste ningún aviso.",
  emptyPosts: "Todavía no publicaste nada en el feed.",
  shownLimit: (n: number) => `Mostrando tus ${n} más recientes.`,
} as const;

/** Tope por sección — el índice NUNCA lista sin límite. */
const LIMIT = 20;

const LISTING_ICON: Record<string, Icon> = {
  property: House,
  business: Storefront,
  professional: UserGear,
  event: CalendarBlank,
  job: Briefcase,
};

function listingIconFor(item: ImpulsarItem): Icon {
  return LISTING_ICON[item.subKind] ?? Storefront;
}

function postIconFor(): Icon {
  return ChatCircle;
}

/**
 * /impulsar (índice) — "Promocioná lo tuyo": todos los avisos y publicaciones
 * del usuario autenticado, cada uno con su botón "Promocionar" hacia
 * /impulsar/[listingId] o /impulsar-post/[postId] (que YA existían y hacen
 * todo el trabajo de cobro — acá solo se elige QUÉ promocionar).
 *
 * Convive sin colisión con /impulsar/[listingId]: en el App Router de este
 * Next, un `page.tsx` en el segmento fijo y un `page.tsx` en su hijo
 * `[listingId]` resuelven rutas distintas (`/impulsar` vs. `/impulsar/algo`)
 * — no hay ambigüedad que resolver, cada URL matchea un solo archivo.
 */
export default async function ImpulsarIndexPage() {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?next=/impulsar");

  // Lo propio del usuario en este tenant — nunca "removed" (nadie promociona
  // algo que ya se dio de baja). RLS ya aísla por dueño; el filtro explícito
  // es además la query eficiente (mismo patrón que el resto del repo).
  const [{ data: listingRows }, { data: postRows }] = await Promise.all([
    supabase
      .from("listings")
      .select("id, kind, title, status, photos, created_at")
      .eq("tenant_id", tenant.id)
      .eq("created_by", user.id)
      .neq("status", "removed")
      .order("created_at", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("posts")
      .select("id, kind, body, media, status, created_at")
      .eq("tenant_id", tenant.id)
      .eq("author_id", user.id)
      .neq("status", "removed")
      .order("created_at", { ascending: false })
      .limit(LIMIT),
  ]);

  const listings = listingRows ?? [];
  const posts = postRows ?? [];
  const now = new Date().toISOString();

  // Boost/campaña VIGENTE de cada uno, en dos queries batch (no una por fila).
  const [{ data: activeBoosts }, { data: activePromos }] = await Promise.all([
    listings.length > 0
      ? supabase
          .from("boosts")
          .select("listing_id, ends_at")
          .in(
            "listing_id",
            listings.map((row) => row.id),
          )
          .eq("status", "active")
          .gt("ends_at", now)
      : Promise.resolve({ data: [] as { listing_id: string; ends_at: string }[] }),
    posts.length > 0
      ? supabase
          .from("post_promotions")
          .select("post_id, ends_at")
          .in(
            "post_id",
            posts.map((row) => row.id),
          )
          .eq("status", "active")
          .gt("ends_at", now)
      : Promise.resolve({ data: [] as { post_id: string; ends_at: string }[] }),
  ]);

  const boostEndsByListing = new Map(
    (activeBoosts ?? []).map((row) => [row.listing_id, row.ends_at]),
  );
  const promoEndsByPost = new Map((activePromos ?? []).map((row) => [row.post_id, row.ends_at]));

  const listingItems: ImpulsarItem[] = listings.map((row) =>
    toListingImpulsarItem(row, boostEndsByListing.get(row.id) ?? null),
  );
  const postItems: ImpulsarItem[] = posts.map((row) =>
    toPostImpulsarItem(row, promoEndsByPost.get(row.id) ?? null),
  );

  const nothingToPromote = listingItems.length === 0 && postItems.length === 0;

  return (
    <div className="flex flex-col gap-6 pb-8">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {COPY.title}
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">{COPY.subtitle}</p>
      </header>

      {nothingToPromote ? (
        <EmptyState
          icon={<Megaphone size={32} weight="fill" aria-hidden="true" />}
          title={COPY.emptyAllTitle}
          message={COPY.emptyAllMessage}
          action={
            <Link
              href="/publicar"
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              {COPY.emptyAllCta}
            </Link>
          }
        />
      ) : (
        <>
          <ImpulsarSection
            heading={COPY.listingsHeading}
            items={listingItems}
            emptyMessage={COPY.emptyListings}
            iconFor={listingIconFor}
          />
          <ImpulsarSection
            heading={COPY.postsHeading}
            items={postItems}
            emptyMessage={COPY.emptyPosts}
            iconFor={postIconFor}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sección (avisos / publicaciones) — misma forma que ProfilePostsGrid: título,
// lista o vacío chico, y una nota si se llegó al tope de LIMIT.
// ---------------------------------------------------------------------------

function ImpulsarSection({
  heading,
  items,
  emptyMessage,
  iconFor,
}: {
  heading: string;
  items: ImpulsarItem[];
  emptyMessage: string;
  iconFor: (item: ImpulsarItem) => Icon;
}) {
  if (items.length === 0) {
    return (
      <section aria-label={heading} className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-bold text-foreground">{heading}</h2>
        <p className="rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-6 text-center text-sm text-foreground-muted">
          {emptyMessage}
        </p>
      </section>
    );
  }

  return (
    <section aria-label={heading} className="flex flex-col gap-3">
      <h2 className="font-display text-lg font-bold text-foreground">{heading}</h2>
      <ul className="flex flex-col gap-2.5">
        {items.map((item) => (
          <ImpulsarRow key={item.id} item={item} FallbackIcon={iconFor(item)} />
        ))}
      </ul>
      {items.length === LIMIT && (
        <p className="text-center text-xs text-foreground-muted">{COPY.shownLimit(LIMIT)}</p>
      )}
    </section>
  );
}

function ImpulsarRow({ item, FallbackIcon }: { item: ImpulsarItem; FallbackIcon: Icon }) {
  const isActive = Boolean(item.activePromotionEndsAt);

  return (
    <li>
      <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface p-3">
        <span
          aria-hidden="true"
          className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-subtle"
        >
          {item.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- thumbnail chico (56px) de un bucket propio; no es LCP de esta página
            <img src={item.thumbnailUrl} alt="" className="size-full object-cover" />
          ) : (
            <FallbackIcon size={22} className="text-foreground-muted" />
          )}
          {item.thumbnailIsVideo && (
            <span className="cl-print-fill absolute inset-0 flex items-center justify-center bg-media-scrim">
              <Play size={14} weight="fill" className="text-on-media" />
            </span>
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{item.title}</p>
          {isActive ? (
            <div className="mt-1">
              <AdChip />
            </div>
          ) : !item.isPublished ? (
            <p className="mt-0.5 text-xs text-foreground-muted">{COPY.pendingReview}</p>
          ) : null}
        </div>

        <Link
          href={item.href}
          aria-label={`${COPY.promoteCta}: ${item.title}`}
          className={cn(
            buttonVariants({ variant: isActive ? "outline" : "primary", size: "sm" }),
            "shrink-0",
          )}
        >
          <Megaphone size={16} aria-hidden="true" />
          {COPY.promoteCta}
        </Link>
      </div>
    </li>
  );
}
