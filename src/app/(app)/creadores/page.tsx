import { Suspense } from "react";
import Link from "next/link";
import { Plus } from "@phosphor-icons/react/dist/ssr";
import { buttonVariants, EmptyState, SectionCta, SectionHeading } from "@/components/ui";
import {
  allPhotoUrls,
  buildTrustSignals,
  firstPhotoUrl,
  formatListingPrice,
  toTrustLevel,
  type PublisherView,
} from "@/components/listings";
import {
  COPY,
  CreatorsNav,
  GigListSkeleton,
  isUrgentDeadline,
  parseGigAttrs,
  type GigCardModel,
} from "@/components/creators";
import { GigCard } from "@/components/creators/gig-card";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";

export const metadata = { title: "Creadores" };

const PAGE_SIZE = 20;

/** Acento + ícono 3D de la sección (los mismos del menú y de /buscar). */
const SECCION = {
  accent: "var(--accent-creadores)",
  image: "/icons/menu/creadores.webp",
  publicarHref: "/creadores/publicar",
} as const;

export default async function CreadoresPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FeedContent />
    </Suspense>
  );
}

async function FeedContent() {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);

  // Todos los avisos publicados, juntos (sin filtro por categoría): se muestran
  // todos los trabajos que buscan creadores.
  const { data: rows, error } = await supabase
    .from("listings")
    .select(
      "id, title, price_amount, price_currency, price_period, area_label, photos, attrs, created_by, publisher_name, created_at",
    )
    .eq("tenant_id", tenant.id)
    .eq("kind", "creator_gig")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE);

  if (error) console.warn("[creadores] query de gigs falló", { code: error.code });

  const gigRows = rows ?? [];
  const publisherIds = [
    ...new Set(gigRows.map((row) => row.created_by).filter((id): id is string => Boolean(id))),
  ];

  const [profilesResult, trustResult] = await Promise.all([
    publisherIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, display_name, avatar_url, identity_verified")
          .in("id", publisherIds)
      : Promise.resolve({ data: [] as never[] }),
    publisherIds.length > 0
      ? supabase.from("trust_scores").select("profile_id, score, level, signals").in("profile_id", publisherIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const profileById = new Map((profilesResult.data ?? []).map((p) => [p.id, p]));
  const trustById = new Map((trustResult.data ?? []).map((t) => [t.profile_id, t]));

  const gigs: GigCardModel[] = gigRows.map((row) => {
    const attrs = parseGigAttrs(row.attrs);
    let publisher: PublisherView = null;
    if (row.created_by) {
      const profile = profileById.get(row.created_by);
      const trust = trustById.get(row.created_by);
      publisher = {
        type: "member",
        profileId: row.created_by,
        displayName: profile?.display_name ?? "Miembro de la comunidad",
        avatarUrl: profile?.avatar_url ?? null,
        score: trust?.score ?? 0,
        level: toTrustLevel(trust?.level),
        signals: buildTrustSignals(trust?.signals ?? {}, profile?.identity_verified ?? false),
      };
    } else if (row.publisher_name) {
      publisher = { type: "external", name: row.publisher_name };
    }

    return {
      id: row.id,
      title: row.title,
      budgetLabel: formatListingPrice(row.price_amount, row.price_currency, row.price_period, tenant.locale),
      areaLabel: row.area_label,
      photoUrl: firstPhotoUrl(row.photos),
      // Todas las fotos ya resueltas: tocar la foto abre el visor, no el aviso.
      photos: allPhotoUrls(row.photos),
      category: attrs.category,
      // "Urgente" derivado de la fecha de entrega (≤ 7 días), ya no un toggle.
      urgent: isUrgentDeadline(attrs.deadlineDays),
      publisher,
    };
  });

  return (
    <>
      <SectionHeading
        accent={SECCION.accent}
        image={SECCION.image}
        title={COPY.feed.title}
        subtitle={COPY.feed.subtitle}
      />

      <SectionCta
        accent={SECCION.accent}
        href={SECCION.publicarHref}
        title={t("sections", "publishGigTitle")}
        hint={t("sections", "publishGigHint")}
        className="mb-4 mt-3"
      />

      <CreatorsNav active="gigs" />

      {gigs.length === 0 ? (
        <EmptyState
          illustration="/images/empty-state-search.png"
          title={COPY.feed.emptyTitle}
          message={COPY.feed.emptyMessage}
          action={
            <Link
              href="/creadores/publicar"
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              <Plus size={18} aria-hidden="true" />
              {COPY.feed.emptyCta}
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {gigs.map((gig) => (
            <GigCard key={gig.id} gig={gig} />
          ))}
        </div>
      )}
    </>
  );
}

function PageSkeleton() {
  return (
    <div aria-busy="true">
      <SectionHeading
        accent={SECCION.accent}
        image={SECCION.image}
        title={COPY.feed.title}
        subtitle={COPY.feed.subtitle}
      />
      <SectionCta
        accent={SECCION.accent}
        href={SECCION.publicarHref}
        title={t("sections", "publishGigTitle")}
        hint={t("sections", "publishGigHint")}
        className="mb-4 mt-3"
      />
      <CreatorsNav active="gigs" />
      <div className="mt-5">
        <GigListSkeleton />
      </div>
    </div>
  );
}
