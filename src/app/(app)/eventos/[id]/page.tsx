import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowSquareOut,
  CalendarBlank,
  CalendarX,
  ChartBar,
  Confetti,
  MapPin,
  RocketLaunch,
  Storefront,
  Ticket,
  Users,
  UsersThree,
  VideoCamera,
} from "@phosphor-icons/react/dist/ssr";
import { Avatar, Badge, Banner, BezelCard, buttonVariants } from "@/components/ui";
import {
  DetailFacts,
  DetailTopBar,
  ListingActions,
  PublisherTrust,
  buildTrustSignals,
  firstNameOf,
  isOptimizableSrc,
  listingPhotoUrl,
  toTrustLevel,
  type DetailFact,
} from "@/components/listings";
import { InlineMessageCta } from "@/components/listings/inline-message-cta";
// Lectura de `saves` (migración 0038) con degradación a false. Vive en el
// paquete de marketplace porque es donde nació el guardado de avisos; es
// genérica por listingId y no arrastra nada específico de productos.
import { fetchListingSaved } from "@/components/marketplace/engagement-queries";
import { PostSheetTrigger } from "@/components/feed";
import {
  COPY,
  DirectoryDetailHero,
  EventActions,
  FollowRow,
  eventDateParts,
  parseEventAttrs,
} from "@/components/directory";
import { canUseActionButtons } from "@/lib/monetization";
import { eventAudienceLabel, eventCategoryLabel } from "@/lib/eventos/categorias";
import {
  EVENT_DETAILS_COPY,
  readEventDetails,
  resolveEventTicketsUrl,
} from "@/lib/eventos/detalles";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { getViewerTimeZone } from "@/lib/time/viewer-zone";
import { cn, timeAgo } from "@/lib/utils";

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

  const [tenant, supabase, viewerZone] = await Promise.all([
    getTenant(),
    createClient(),
    // La hora del evento se cuenta con el reloj de quien lo lee, no con el del
    // server (ver `eventDateParts`).
    getViewerTimeZone(),
  ]);

  const { data: listing } = await supabase
    .from("listings")
    .select(
      // tier + los 2 CTAs de Eventos (MODULE_CTAS.event): comprar boletos y
      // cómo llegar. Van en la misma fila — por eso son columnas (0048).
      "id, tenant_id, kind, title, description, attrs, area_label, photos, status, created_by, publisher_name, created_at, tier, cta_tickets_url, cta_address",
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
  // Interés (reactions like/listing) + seguidores (0023, solo si hay dueño
  // con cuenta — una entidad sin cuenta no publica novedades) + Novedades
  // (posts.entity_listing_id) — todo independiente, en paralelo.
  // ---------------------------------------------------------------------
  const [
    { count: interestedCount },
    myReactionResult,
    { count: followerCount },
    myFollowResult,
    postsResult,
  ] = await Promise.all([
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
    supabase
      .from("posts")
      .select("id, body, media, created_at")
      .eq("tenant_id", tenant.id)
      .eq("entity_listing_id", listing.id)
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(3),
  ]);

  // Mini-cards de Novedades: primera foto de media (si hay) + body truncado
  // (line-clamp visual — el texto completo queda en el DOM) + link al post.
  const news = (postsResult.data ?? []).map((post) => {
    const firstMedia = post.media.find((path) => path && path.trim().length > 0);
    return {
      id: post.id,
      body: post.body,
      photoUrl: firstMedia ? listingPhotoUrl(firstMedia) : null,
      timeAgoLabel: timeAgo(post.created_at),
    };
  });

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
            profileId={profile?.id ?? null}
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
  const date = attrs.startsAt
    ? eventDateParts(attrs.startsAt, tenant.locale, viewerZone ?? undefined)
    : null;
  const venue = attrs.venueArea ?? listing.area_label;
  const isOwner = Boolean(user && listing.created_by === user.id);

  /**
   * Lo que el formulario captura y esta pantalla no mostraba: tipo de evento,
   * hora de cierre, público recomendado, cupo y —el caro— el enlace de boletos.
   *
   * ── EL ENLACE DE BOLETOS ────────────────────────────────────────────────────
   * Acá había un bug con forma de omisión. El botón se pintaba con
   * `listing.cta_tickets_url` a secas, que es la columna PREMIUM: un aviso
   * gratuito no puede ni siquiera guardarla (CHECK `listings_cta_premium_only`,
   * 0048). O sea que el enlace que el formulario base pide gratis —y que la
   * gente venía cargando— no se mostraba NUNCA. `resolveEventTicketsUrl`
   * resuelve la precedencia una sola vez: gana el premium, `attrs.tickets_url`
   * es el respaldo.
   *
   * Y por eso hay dos lugares donde puede salir el botón, sin duplicarse:
   * `ListingActions` sólo renderiza con tier premium vigente, así que cuando esa
   * fila NO va a existir —o existe pero el valor salió del respaldo gratuito—
   * el botón se pinta acá abajo. La condición es exactamente esa y no "si es
   * gratis": un premium VENCIDO también tiene que volver a mostrar su respaldo.
   */
  const details = readEventDetails(listing.attrs);
  const tickets = resolveEventTicketsUrl(listing.cta_tickets_url, listing.attrs);
  const ticketsInActionsRow =
    tickets !== null && tickets.source === "premium" && canUseActionButtons(listing.tier);
  const categoryLabel = eventCategoryLabel(details.category);
  const endDate = attrs.endsAt
    ? eventDateParts(attrs.endsAt, tenant.locale, viewerZone ?? undefined)
    : null;

  const eventFacts: DetailFact[] = [];
  if (endDate) {
    eventFacts.push({
      id: "ends-at",
      icon: CalendarX,
      label: EVENT_DETAILS_COPY.endsAt,
      value: endDate.time ? `${endDate.full} · ${endDate.time}` : endDate.full,
    });
  }
  if (details.audience) {
    const audience = eventAudienceLabel(details.audience);
    if (audience) {
      eventFacts.push({
        id: "audience",
        icon: UsersThree,
        label: EVENT_DETAILS_COPY.audience,
        value: audience,
      });
    }
  }
  if (details.capacity !== null) {
    eventFacts.push({
      id: "capacity",
      icon: Users,
      label: EVENT_DETAILS_COPY.capacity,
      value: EVENT_DETAILS_COPY.capacityValue(details.capacity),
    });
  }

  // ¿Ya lo guardé? (`saves`, 0038 — false si la migración todavía no corrió.)
  const initialSaved = await fetchListingSaved(supabase, tenant.id, listing.id, user?.id);

  return (
    <div className="pb-28">
      <DetailTopBar title={listing.title} listingId={listing.id} initialSaved={initialSaved} />

      {listing.status !== "published" && isOwner && (
        <Banner variant="info" className="mb-3 rounded-lg">
          {C.detail.pendingBanner}
        </Banner>
      )}

      <DirectoryDetailHero
        photos={(listing.photos ?? []).map(listingPhotoUrl)}
        title={listing.title}
        accent="eventos"
        icon={CalendarBlank}
        className="mb-4"
      />

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
            {/* El tipo de evento va ACÁ y no en la ficha de abajo: es lo que
                decide si alguien sigue leyendo, igual que la fecha. Lleva su
                ícono Y su texto — nunca sólo color. */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {categoryLabel && (
                <Badge variant="neutral">
                  <Confetti size={14} aria-hidden="true" />
                  {categoryLabel}
                </Badge>
              )}
              {attrs.free && <Badge variant="success">{C.freeChip}</Badge>}
              {date?.isPast && <Badge variant="neutral">{C.pastLabel}</Badge>}
            </div>
          </div>
        </div>
      </BezelCard>

      {/* Seguir este evento (0023) — solo si tiene dueño con cuenta: una
          entidad sin cuenta no publica novedades para seguir. */}
      {listing.created_by && (
        <FollowRow
          targetId={listing.id}
          followerCount={followerCount ?? 0}
          isFollowing={Boolean(myFollowResult.data)}
          className="mt-4"
        />
      )}

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

      {/* Evento EN LÍNEA: el enlace es el "dónde". Va con el mismo peso que la
          card de zona de un evento presencial y no escondido entre los botones,
          porque para quien va a entrar por acá es la única dirección que hay.
          `readEventDetails` ya lo validó como http(s) externo. */}
      {details.onlineUrl && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-foreground-secondary">
            {EVENT_DETAILS_COPY.onlineTitle}
          </h2>
          <BezelCard coreClassName="p-4">
            <a
              href={details.onlineUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                buttonVariants({ variant: "outline", size: "md" }),
                "w-full justify-center",
              )}
            >
              <VideoCamera size={18} aria-hidden="true" />
              {EVENT_DETAILS_COPY.onlineCta}
              <ArrowSquareOut size={14} aria-hidden="true" />
            </a>
            <p className="mt-2 text-xs text-foreground-muted">
              {EVENT_DETAILS_COPY.externalHint}
            </p>
          </BezelCard>
        </section>
      )}

      {/* Termina · Para quién es · Cupo. Sin filas declaradas, no renderiza. */}
      <DetailFacts title={EVENT_DETAILS_COPY.title} facts={eventFacts} />

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

      {/* Botones de acción (premium) — Comprar boletos · Cómo llegar, con el
          chat de Comunidad Latina al lado. Eventos no tiene barra sticky de
          contacto, así que el chat va ACÁ (showChat por defecto en true). */}
      <ListingActions
        className="mt-5"
        listingId={listing.id}
        kind={listing.kind}
        tier={listing.tier}
        subject={listing.title}
        isLoggedIn={Boolean(user)}
        values={{
          tickets: listing.cta_tickets_url,
          directions: listing.cta_address,
        }}
      />

      {/* Boletos cuando la fila de arriba no los pinta: aviso gratuito, o
          premium vencido que vuelve a caer en el enlace de `attrs`. Ver el
          comentario de `ticketsInActionsRow`. Es un enlace y no un botón
          fantasma: si no hay a dónde ir, no se dibuja nada. */}
      {tickets && !ticketsInActionsRow && (
        <div className="mt-4">
          <a
            href={tickets.href}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              buttonVariants({ variant: "outline", size: "md" }),
              "w-full justify-center",
            )}
          >
            <Ticket size={18} aria-hidden="true" />
            {EVENT_DETAILS_COPY.ticketsCta}
            <ArrowSquareOut size={14} aria-hidden="true" />
          </a>
          <p className="mt-1.5 text-xs text-foreground-muted">
            {EVENT_DETAILS_COPY.externalHint}
          </p>
        </div>
      )}

      {isOwner && listing.status === "published" && (
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Link
            href={`/impulsar/${listing.id}`}
            className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full")}
          >
            <RocketLaunch size={18} aria-hidden="true" />
            Promocionar este evento
          </Link>
          <Link
            href={`/impulsar/${listing.id}/estadisticas`}
            className={cn(buttonVariants({ variant: "ghost", size: "md" }), "w-full")}
          >
            <ChartBar size={18} aria-hidden="true" />
            Ver estadísticas
          </Link>
        </div>
      )}

      {publisherCard && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-foreground-secondary">
            {C.detail.publishedBy}
          </h2>
          {publisherCard}

          {/* Escribirle a quien organiza sin salir del evento (call cliente
              2026-07-24). Sólo si el evento tiene dueño con cuenta: una fuente
              externa no tiene bandeja de entrada. El CTA "Quiero ir" sigue
              siendo la acción principal, abajo. */}
          {listing.created_by && !isOwner && (
            <InlineMessageCta
              listingId={listing.id}
              isLoggedIn={Boolean(user)}
              nextPath={`/eventos/${listing.id}`}
              className="mt-3"
            />
          )}
        </section>
      )}

      {/* Novedades (0023): posts publicados COMO este evento — hasta 3, sin empty state. */}
      {news.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-foreground-secondary">
            {C.detail.newsTitle}
          </h2>
          <div className="flex flex-col gap-3">
            {news.map((post) => (
              /* La novedad se abre en una HOJA, sin salir del evento (feedback
                 cliente 2026-08-20: "mientras menos pasos mejor"). Acá el costo
                 era doble: quien está leyendo un evento suele estar decidiendo
                 si va, y navegar a /feed/[id] lo alejaba del CTA "Quiero ir"
                 con un "atrás" que lo devolvía arriba de todo.
                 `PostSheetTrigger` es un client component chiquito — esta
                 página sigue siendo server. */
              <PostSheetTrigger
                key={post.id}
                postId={post.id}
                className={cn(
                  "flex gap-3 rounded-lg border border-border-subtle bg-surface p-3",
                  "transition-colors duration-(--duration-fast) hover:bg-surface-subtle",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                )}
              >
                {post.photoUrl && (
                  <div className="relative size-16 shrink-0 overflow-hidden rounded-md bg-surface-subtle">
                    {isOptimizableSrc(post.photoUrl) ? (
                      <Image src={post.photoUrl} alt="" fill sizes="64px" className="object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element -- URL externa de seed/API: host fuera del allowlist de next/image
                      <img
                        src={post.photoUrl}
                        alt=""
                        loading="lazy"
                        className="absolute inset-0 size-full object-cover"
                      />
                    )}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm text-foreground">
                    {post.body || "Foto o video"}
                  </p>
                  <p className="mt-1 text-xs text-foreground-muted">{post.timeAgoLabel}</p>
                </div>
              </PostSheetTrigger>
            ))}
          </div>
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
