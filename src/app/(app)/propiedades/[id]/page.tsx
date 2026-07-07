import { notFound } from "next/navigation";
import { Bathtub, Bed, MapPin, Ruler, Storefront } from "@phosphor-icons/react/dist/ssr";
import { Avatar, Banner, BezelCard, Chip } from "@/components/ui";
import { ScamShieldNotice } from "@/components/trust";
import {
  COPY,
  ContactCta,
  DetailTopBar,
  ListingGallery,
  PublisherTrust,
  VerificationBand,
  buildTrustSignals,
  firstNameOf,
  formatListingPrice,
  listingPhotoUrl,
  parsePropertyAttrs,
  toTrustLevel,
  type VerificationView,
} from "@/components/listings";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { formatDate } from "@/lib/utils";

type Params = Promise<{ id: string }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: "Propiedad" };
  const supabase = await createClient();
  const { data } = await supabase
    .from("listings")
    .select("title")
    .eq("id", id)
    .maybeSingle();
  return { title: data?.title ?? "Propiedad" };
}

export default async function PropiedadDetallePage({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);

  const { data: listing } = await supabase
    .from("listings")
    .select(
      "id, tenant_id, kind, title, description, price_amount, price_currency, price_period, attrs, area_label, photos, status, created_by, publisher_name, publisher_kind, source, created_at",
    )
    .eq("id", id)
    .eq("kind", "property")
    .maybeSingle();

  // RLS ya limita qué filas existen para este usuario (published | propias | staff).
  if (!listing || listing.tenant_id !== tenant.id) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ---------------------------------------------------------------------
  // Verificación vinculada (regla estricta: SOLO found_active → banda;
  // sin check → ausencia, jamás un negativo)
  // ---------------------------------------------------------------------
  const { data: checks } = await supabase
    .from("verification_checks")
    .select("registry, registry_url, license_number, checked_at")
    .eq("tenant_id", tenant.id)
    .eq("subject_kind", "listing")
    .eq("subject_id", listing.id)
    .eq("result", "found_active")
    .order("checked_at", { ascending: false })
    .limit(1);

  const check = checks?.[0];
  const verification: VerificationView | null = check
    ? {
        registry: check.registry,
        registryUrl: check.registry_url,
        licenseNumber: check.license_number,
        dateLabel: formatDate(check.checked_at, { locale: tenant.locale, style: "long" }),
      }
    : null;

  // ---------------------------------------------------------------------
  // Publicador: perfil + trust score + cuántas propiedades publicó
  // ---------------------------------------------------------------------
  let publisherCard: React.ReactNode = null;
  if (listing.created_by) {
    const [{ data: profile }, { data: trust }, { count: publishedCount }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, display_name, avatar_url, identity_verified")
        .eq("id", listing.created_by)
        .maybeSingle(),
      supabase
        .from("trust_scores")
        .select("score, level, signals")
        .eq("profile_id", listing.created_by)
        .maybeSingle(),
      supabase
        .from("listings")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.id)
        .eq("created_by", listing.created_by)
        .eq("kind", "property")
        .eq("status", "published"),
    ]);

    const displayName = profile?.display_name ?? COPY.list.communityMember;
    publisherCard = (
      <BezelCard coreClassName="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          <Avatar src={profile?.avatar_url} name={displayName} size="lg" />
          <div className="min-w-0">
            <p className="truncate font-display text-base font-bold text-foreground">
              {displayName}
            </p>
            <PublisherTrust
              displayName={displayName}
              firstName={firstNameOf(displayName)}
              score={trust?.score ?? 0}
              level={toTrustLevel(trust?.level)}
              signals={buildTrustSignals(trust?.signals ?? {}, profile?.identity_verified ?? false)}
              size="inline"
            />
          </div>
        </div>
        {typeof publishedCount === "number" && publishedCount > 0 && (
          <p className="numeric text-sm text-foreground-secondary">
            {publishedCount}{" "}
            {publishedCount === 1 ? "propiedad publicada" : "propiedades publicadas"}
          </p>
        )}
      </BezelCard>
    );
  } else if (listing.publisher_name) {
    publisherCard = (
      <BezelCard coreClassName="flex items-center gap-3 p-4">
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-foreground-muted"
        >
          <Storefront size={24} />
        </span>
        <div className="min-w-0">
          <p className="truncate font-display text-base font-bold text-foreground">
            {listing.publisher_name}
          </p>
          <p className="text-xs text-foreground-muted">{COPY.detail.externalSourceNote}</p>
        </div>
      </BezelCard>
    );
  }

  const attrs = parsePropertyAttrs(listing.attrs);
  const priceLabel = formatListingPrice(
    listing.price_amount,
    listing.price_currency,
    listing.price_period,
    tenant.locale,
  );
  const photos = (listing.photos ?? []).map(listingPhotoUrl);
  const isOwner = Boolean(user && listing.created_by === user.id);

  return (
    <div className="pb-24">
      <DetailTopBar title={listing.title} listingId={listing.id} />

      {listing.status !== "published" && isOwner && (
        <Banner variant="info" className="mb-3 rounded-lg">
          {COPY.detail.pendingBanner}
        </Banner>
      )}

      <ListingGallery photos={photos} title={listing.title} />

      {/* Banda de confianza — SIEMPRE arriba del precio (§4.d) */}
      {verification && <VerificationBand verification={verification} className="mt-4" />}

      <h1 className="mt-4 font-display text-xl font-bold leading-snug text-foreground">
        {listing.title}
      </h1>

      {priceLabel && (
        <p className="numeric mt-1 text-3xl font-bold text-brand">{priceLabel}</p>
      )}

      {(attrs.bedrooms !== null || attrs.bathrooms !== null || attrs.sqft !== null) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {attrs.bedrooms !== null && (
            <Chip icon={<Bed />}>{COPY.detail.bedrooms(attrs.bedrooms)}</Chip>
          )}
          {attrs.bathrooms !== null && (
            <Chip icon={<Bathtub />}>{COPY.detail.bathrooms(attrs.bathrooms)}</Chip>
          )}
          {attrs.sqft !== null && <Chip icon={<Ruler />}>{COPY.detail.sqft(attrs.sqft)}</Chip>}
        </div>
      )}

      {publisherCard && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-foreground-secondary">
            {COPY.detail.publishedBy}
          </h2>
          {publisherCard}
        </section>
      )}

      {/* Escudo Anti-Estafa — SIEMPRE presente en listings de renta (§4.d) */}
      <ScamShieldNotice variant="rental" className="mt-6" />

      {listing.description && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-foreground-secondary">
            {COPY.detail.descriptionTitle}
          </h2>
          <p className="whitespace-pre-line text-base leading-relaxed text-foreground">
            {listing.description}
          </p>
        </section>
      )}

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-foreground-secondary">
          {COPY.detail.locationTitle}
        </h2>
        <BezelCard coreClassName="flex items-start gap-3 p-4">
          <MapPin size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
          <div className="min-w-0">
            {listing.area_label && (
              <p className="font-semibold text-foreground">{listing.area_label}</p>
            )}
            <p className="mt-1 text-sm text-foreground-secondary">
              {COPY.detail.locationPrivacy}
            </p>
          </div>
        </BezelCard>
      </section>

      <ContactCta
        listingId={listing.id}
        isLoggedIn={Boolean(user)}
        isExternal={!listing.created_by}
        externalName={listing.publisher_name}
      />
    </div>
  );
}
