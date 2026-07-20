import { notFound } from "next/navigation";
import { Certificate, MapPin, Storefront, UserGear } from "@phosphor-icons/react/dist/ssr";
import { Avatar, Banner, BezelCard, Chip } from "@/components/ui";
import { ScamShieldNotice } from "@/components/trust";
import {
  DetailTopBar,
  PublisherTrust,
  VerificationBand,
  buildTrustSignals,
  firstNameOf,
  listingPhotoUrl,
  toTrustLevel,
  type VerificationView,
} from "@/components/listings";
import {
  COPY,
  DirectoryContactCta,
  DirectoryDetailHero,
  FollowRow,
  categoryLabel,
  parseProfessionalAttrs,
} from "@/components/directory";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { formatDate } from "@/lib/utils";

const C = COPY.professionals;

type Params = Promise<{ id: string }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: "Profesional" };
  const supabase = await createClient();
  const { data } = await supabase.from("listings").select("title").eq("id", id).maybeSingle();
  return { title: data?.title ?? "Profesional" };
}

export default async function ProfesionalDetallePage({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);

  const { data: listing } = await supabase
    .from("listings")
    .select(
      "id, tenant_id, kind, title, description, attrs, area_label, photos, status, created_by, publisher_name, created_at",
    )
    .eq("id", id)
    .eq("kind", "professional")
    .maybeSingle();

  // RLS ya limita qué filas existen para este usuario (published | propias | staff).
  if (!listing || listing.tenant_id !== tenant.id) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ---------------------------------------------------------------------
  // Verificación vinculada (regla estricta: SOLO found_active → banda;
  // sin check → ausencia, jamás un negativo) + seguidores (0023, solo si
  // hay dueño con cuenta) — independientes, en paralelo.
  // ---------------------------------------------------------------------
  const [{ data: checks }, { count: followerCount }, myFollowResult] = await Promise.all([
    supabase
      .from("verification_checks")
      .select("registry, registry_url, license_number, checked_at")
      .eq("tenant_id", tenant.id)
      .eq("subject_kind", "listing")
      .eq("subject_id", listing.id)
      .eq("result", "found_active")
      .order("checked_at", { ascending: false })
      .limit(1),
    listing.created_by
      ? supabase
          .from("follows")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id)
          .eq("target_kind", "listing")
          .eq("target_id", listing.id)
      : Promise.resolve({ count: 0 }),
    listing.created_by && user
      ? supabase
          .from("follows")
          .select("id")
          .eq("tenant_id", tenant.id)
          .eq("target_kind", "listing")
          .eq("target_id", listing.id)
          .eq("follower_id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

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
  // Publicador: perfil + trust score + cuántos avisos publicó
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
        .eq("status", "published"),
    ]);

    const displayName = profile?.display_name ?? C.communityMember;
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
            {C.detail.servicesCount(publishedCount)}
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
          <p className="text-xs text-foreground-muted">{C.detail.externalSourceNote}</p>
        </div>
      </BezelCard>
    );
  }

  const attrs = parseProfessionalAttrs(listing.attrs);
  const isOwner = Boolean(user && listing.created_by === user.id);

  return (
    <div className="pb-24">
      <DetailTopBar title={listing.title} listingId={listing.id} />

      {listing.status !== "published" && isOwner && (
        <Banner variant="info" className="mb-3 rounded-lg">
          {C.detail.pendingBanner}
        </Banner>
      )}

      <DirectoryDetailHero
        photos={(listing.photos ?? []).map(listingPhotoUrl)}
        title={listing.title}
        accent="profesionales"
        icon={UserGear}
        className="mb-4"
      />

      {/* Banda de confianza — SIEMPRE arriba del contenido (§4.d) */}
      {verification && <VerificationBand verification={verification} className="mb-4" />}

      <h1 className="font-display text-xl font-bold leading-snug text-foreground">
        {listing.title}
      </h1>

      <div className="mt-3 flex flex-wrap gap-2">
        <Chip>{categoryLabel(attrs.category)}</Chip>
        {listing.area_label && <Chip icon={<MapPin />}>{listing.area_label}</Chip>}
      </div>

      {/* Seguir este profesional (0023) — solo si tiene cuenta: una entidad
          sin cuenta no publica novedades para seguir. */}
      {listing.created_by && (
        <FollowRow
          targetId={listing.id}
          followerCount={followerCount ?? 0}
          isFollowing={Boolean(myFollowResult.data)}
          className="mt-4"
        />
      )}

      {/* Credenciales declaradas (attrs) — el "specs" de este vertical */}
      {attrs.credentials.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-foreground-secondary">
            {C.detail.credentialsTitle}
          </h2>
          <div className="flex flex-wrap gap-2">
            {attrs.credentials.map((credential) => (
              <Chip key={credential} icon={<Certificate />}>
                {credential}
              </Chip>
            ))}
          </div>
        </section>
      )}

      {publisherCard && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-foreground-secondary">
            {C.detail.publishedBy}
          </h2>
          {publisherCard}
        </section>
      )}

      {/* Escudo Anti-Estafa — SIEMPRE presente en servicios (§4.d) */}
      <ScamShieldNotice variant="services" className="mt-6" />

      {listing.description && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-foreground-secondary">
            {C.detail.descriptionTitle}
          </h2>
          <p className="whitespace-pre-line text-base leading-relaxed text-foreground">
            {listing.description}
          </p>
        </section>
      )}

      {listing.area_label && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-foreground-secondary">
            {C.detail.locationTitle}
          </h2>
          <BezelCard coreClassName="flex items-start gap-3 p-4">
            <MapPin size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
            <div className="min-w-0">
              <p className="font-semibold text-foreground">{listing.area_label}</p>
              <p className="mt-1 text-sm text-foreground-secondary">{C.detail.locationPrivacy}</p>
            </div>
          </BezelCard>
        </section>
      )}

      {/* Contacto protegido — mismo RPC request_contact que vivienda (§9.2) */}
      <DirectoryContactCta
        listingId={listing.id}
        returnPath={`/profesionales/${listing.id}`}
        isLoggedIn={Boolean(user)}
        isExternal={!listing.created_by}
        externalName={listing.publisher_name}
      />
    </div>
  );
}
