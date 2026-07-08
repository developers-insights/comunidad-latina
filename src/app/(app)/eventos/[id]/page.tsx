import { notFound } from "next/navigation";
import { CalendarBlank, MapPin, Storefront } from "@phosphor-icons/react/dist/ssr";
import { Avatar, Badge, Banner, BezelCard } from "@/components/ui";
import {
  DetailTopBar,
  PublisherTrust,
  buildTrustSignals,
  firstNameOf,
  toTrustLevel,
} from "@/components/listings";
import { COPY, EventActions, eventDateParts, parseEventAttrs } from "@/components/directory";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";

const C = COPY.events;

type Params = Promise<{ id: string }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: "Evento" };
  const supabase = await createClient();
  const { data } = await supabase.from("listings").select("title").eq("id", id).maybeSingle();
  return { title: data?.title ?? "Evento" };
}

export default async function EventoDetallePage({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);

  const { data: listing } = await supabase
    .from("listings")
    .select(
      "id, tenant_id, kind, title, description, attrs, area_label, status, created_by, publisher_name, created_at",
    )
    .eq("id", id)
    .eq("kind", "event")
    .maybeSingle();

  // RLS ya limita qué filas existen para este usuario (published | propias | staff).
  if (!listing || listing.tenant_id !== tenant.id) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ---------------------------------------------------------------------
  // Interés: contador + ¿esta persona ya se anotó? (reactions like/listing)
  // ---------------------------------------------------------------------
  const [{ count: interestedCount }, myReactionResult] = await Promise.all([
    supabase
      .from("reactions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("subject_kind", "listing")
      .eq("subject_id", listing.id)
      .eq("kind", "like"),
    user
      ? supabase
          .from("reactions")
          .select("id")
          .eq("tenant_id", tenant.id)
          .eq("subject_kind", "listing")
          .eq("subject_id", listing.id)
          .eq("profile_id", user.id)
          .eq("kind", "like")
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // ---------------------------------------------------------------------
  // Publicador (organiza): perfil + trust score, o fuente externa
  // ---------------------------------------------------------------------
  let publisherCard: React.ReactNode = null;
  if (listing.created_by) {
    const [{ data: profile }, { data: trust }] = await Promise.all([
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
    ]);

    const displayName = profile?.display_name ?? "Miembro de la comunidad";
    publisherCard = (
      <BezelCard coreClassName="flex items-center gap-3 p-4">
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

  const attrs = parseEventAttrs(listing.attrs);
  const date = attrs.startsAt ? eventDateParts(attrs.startsAt, tenant.locale) : null;
  const venue = attrs.venueArea ?? listing.area_label;
  const isOwner = Boolean(user && listing.created_by === user.id);

  return (
    <div className="pb-28">
      <DetailTopBar title={listing.title} listingId={listing.id} />

      {listing.status !== "published" && isOwner && (
        <Banner variant="info" className="mb-3 rounded-lg">
          {C.detail.pendingBanner}
        </Banner>
      )}

      {/* Cabecera editorial: la fecha manda */}
      <BezelCard variant={date && !date.isPast ? "featured" : "default"} coreClassName="p-4">
        <div className="flex items-start gap-4">
          <div
            aria-hidden="true"
            className={cn(
              "flex w-16 shrink-0 flex-col items-center justify-center rounded-lg py-2.5",
              date && !date.isPast
                ? "bg-brand-tint text-brand-ink"
                : "bg-surface-subtle text-foreground-secondary",
            )}
          >
            {date ? (
              <>
                <span className="numeric font-display text-2xl font-bold leading-none">
                  {date.day}
                </span>
                <span className="mt-1 text-xs font-semibold tracking-wide">{date.month}</span>
              </>
            ) : (
              <CalendarBlank size={26} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-xl font-bold leading-snug text-foreground">
              {listing.title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {attrs.free && <Badge variant="success">{C.freeChip}</Badge>}
              {date?.isPast && <Badge variant="neutral">{C.pastLabel}</Badge>}
            </div>
          </div>
        </div>
      </BezelCard>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-foreground-secondary">
          {C.detail.dateTitle}
        </h2>
        <BezelCard coreClassName="flex items-start gap-3 p-4">
          <CalendarBlank size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
          <p className="font-semibold text-foreground">
            {date ? (
              <>
                {date.full}
                {date.time && <span className="numeric"> · {date.time}</span>}
              </>
            ) : (
              C.dateToConfirm
            )}
          </p>
        </BezelCard>
      </section>

      {venue && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-foreground-secondary">
            {C.detail.venueTitle}
          </h2>
          <BezelCard coreClassName="flex items-start gap-3 p-4">
            <MapPin size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
            <p className="font-semibold text-foreground">{venue}</p>
          </BezelCard>
        </section>
      )}

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

      {publisherCard && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-foreground-secondary">
            {C.detail.publishedBy}
          </h2>
          {publisherCard}
        </section>
      )}

      {/* "Quiero ir" + compartir — CTA sticky con contador de interesados */}
      <EventActions
        eventId={listing.id}
        eventTitle={listing.title}
        isLoggedIn={Boolean(user)}
        initialInterested={Boolean(myReactionResult.data)}
        initialCount={interestedCount ?? 0}
      />
    </div>
  );
}
