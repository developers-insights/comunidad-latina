import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { MapPin, PencilSimple, SealCheck, Storefront } from "@phosphor-icons/react/dist/ssr";
import { Avatar, Badge, Banner, BezelCard, Chip, buttonVariants } from "@/components/ui";
import {
  DetailTopBar,
  ListingActions,
  PublisherTrust,
  buildTrustSignals,
  firstNameOf,
  listingPhotoUrl,
  toTrustLevel,
} from "@/components/listings";
import { InlineMessageCta } from "@/components/listings/inline-message-cta";
import { fetchListingSaved } from "@/components/marketplace/engagement-queries";
import { ACCENT_CHIP_CLASS, DirectoryDetailHero, FollowRow } from "@/components/directory";
import {
  EMPLEOS_DEL_NEGOCIO_TITULO,
  EmpleosDelNegocio,
  HorarioSeccion,
} from "@/components/negocios";
import { PostSheetTrigger } from "@/components/feed";
import {
  ResenaForm,
  ResenasLista,
  ResumenPuntajeCard,
  fetchResenasDeAviso,
} from "@/components/resenas";
import { fetchPuestosDelNegocio } from "@/lib/negocios/empleos";
import { puedeOfrecerseElFormulario } from "@/lib/resenas";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn, timeAgo } from "@/lib/utils";
import { businessCategoryLabel, businessCategoryOf } from "../categories";
import { BUSINESS_PROFILE_COPY as C } from "./copy";

/**
 * PERFIL COMPLETO DE UN NEGOCIO (call del 29/7, 1:05: "si le das ver al
 * negocio… tiene que salir profile del negocio, toda la información del
 * negocio"). Hasta hoy la tarjeta del directorio abría una hoja con tres datos
 * y ahí terminaba: no había a dónde ir.
 *
 * QUÉ MUESTRA Y DE DÓNDE SALE — todo de `listings` (kind='business') y de las
 * tablas que ya lo rodean; no se inventa un dato:
 *
 *   · fotos          → listings.photos (galería con swipe, la misma del resto)
 *   · rubro          → attrs.category (el set curado vive en ../categories.ts)
 *   · verificado     → listings.store_verified, espejo público de
 *                      business_accounts.verified_presence (0039)
 *   · botones        → las 7 columnas cta_* de la 0048, filtradas por TIER y
 *                      por módulo en `ListingActions`. En `free` no renderiza
 *                      nada: el contacto es el chat, y punto.
 *   · quién publica  → profiles + trust_scores del dueño, con "Ver el perfil
 *                      de…" dentro del desglose del score
 *   · seguidores     → follows (0023)
 *   · publicaciones  → posts.entity_listing_id — lo que vuelve "perfil" a una
 *                      ficha: el negocio tiene voz, no sólo datos
 *
 *   · horarios       → listing_hours + listing_hours_slots (0093)
 *   · reseñas        → listing_reviews + listing_review_stats (0093)
 *   · puestos        → listings.business_listing_id (0107) — los empleos que
 *                      este comercio publicó. Hasta esa migración el negocio y
 *                      sus vacantes eran dos avisos sin nada que los uniera.
 *
 * HORARIOS Y RESEÑAS YA EXISTEN (migración 0093). Hasta esa migración ninguna
 * tabla del esquema los guardaba y las dos secciones se mostraban con un vacío
 * honesto. Ese vacío NO se fue: sigue siendo lo que se muestra cuando el negocio
 * todavía no cargó horarios o cuando nadie escribió una reseña. Lo único que
 * cambió es que ahora puede dejar de estar vacío.
 */

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return { title: C.fallbackTitle };
  const supabase = await createClient();
  const { data } = await supabase
    .from("listings")
    .select("title")
    .eq("id", id)
    .eq("kind", "business")
    .maybeSingle();
  return { title: data?.title ?? C.fallbackTitle };
}

/** Encabezado de sección: la misma tipografía en las seis secciones. */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-sm font-semibold text-foreground-secondary">{children}</h2>
  );
}

/**
 * Vacío honesto de una sección. Es una tarjeta y no un párrafo suelto para que
 * la sección SE VEA: una línea gris al aire se lee como un error de carga.
 */
function SectionEmpty({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <BezelCard coreClassName="flex items-start gap-3 p-4">
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-foreground-muted">
        {icon}
      </span>
      <p className="text-sm leading-relaxed text-foreground-secondary">{children}</p>
    </BezelCard>
  );
}

export default async function NegocioPerfilPage({ params }: { params: Params }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);

  const { data: listing } = await supabase
    .from("listings")
    .select(
      "id, tenant_id, kind, title, description, attrs, area_label, photos, status, created_by, publisher_name, store_verified, tier, cta_phone, cta_whatsapp, cta_website, cta_address, created_at",
    )
    .eq("id", id)
    .eq("kind", "business")
    .maybeSingle();

  // RLS ya limita qué filas existen para este usuario (published | propias |
  // staff). El chequeo de tenant es el cinturón sobre los tirantes.
  if (!listing || listing.tenant_id !== tenant.id) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Seguidores + publicaciones del negocio + guardado: independientes, en
  // paralelo. Ninguna es bloqueante — si alguna falla, la sección cae a vacío.
  const [
    { count: followerCount },
    myFollowResult,
    postsResult,
    initialSaved,
    resenas,
    puestos,
  ] = await Promise.all([
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
        .limit(4),
      fetchListingSaved(supabase, tenant.id, listing.id, user?.id),
      // Reseñas: resumen + página + si administro este aviso. Tolerante a
      // errores por dentro — si algo falla, la sección cae a vacío como el resto.
      fetchResenasDeAviso(supabase, listing.id, user?.id ?? null),
      // Puestos abiertos (0107). Tolerante también: en un entorno sin la
      // migración aplicada devuelve [] y la sección no se dibuja.
      fetchPuestosDelNegocio(supabase, {
        tenantId: tenant.id,
        businessListingId: listing.id,
      }),
    ]);

  const posts = (postsResult.data ?? []).map((post) => {
    const firstMedia = post.media.find((path) => path && path.trim().length > 0);
    return {
      id: post.id,
      body: post.body,
      photoUrl: firstMedia ? listingPhotoUrl(firstMedia) : null,
      timeAgoLabel: timeAgo(post.created_at),
    };
  });

  // Dueño: perfil + Trust Score. Un negocio de fuente externa (seed/API) no
  // tiene cuenta detrás, y entonces no hay perfil al que ir.
  let ownerName: string | null = null;
  let ownerCard: React.ReactNode = null;
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

    ownerName = profile?.display_name ?? listing.publisher_name ?? null;
    const displayName = ownerName ?? "Miembro de la comunidad";
    ownerCard = (
      <BezelCard coreClassName="flex items-center gap-3 p-4">
        <Avatar src={profile?.avatar_url} name={displayName} size="lg" />
        <div className="min-w-0">
          <p className="truncate font-display text-base font-bold text-foreground">
            {displayName}
          </p>
          {/* El desglose del score ofrece "Ver el perfil de…" (call 29/7,
              1:02:24). `profileId` sale del perfil REAL, no de created_by, para
              no linkear a una fila que RLS no dejó leer. */}
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
    ownerName = listing.publisher_name;
    ownerCard = (
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
          <p className="text-xs text-foreground-muted">{C.externalSourceNote}</p>
        </div>
      </BezelCard>
    );
  }

  const categoryLabel = businessCategoryLabel(businessCategoryOf(listing.attrs));
  const isOwner = Boolean(user && listing.created_by === user.id);
  const photos = (listing.photos ?? []).map(listingPhotoUrl);
  const address = listing.cta_address;

  return (
    <div className="pb-28">
      <DetailTopBar title={listing.title} listingId={listing.id} initialSaved={initialSaved} />

      {listing.status !== "published" && isOwner && (
        <Banner variant="info" className="mb-3 rounded-lg">
          {C.pendingBanner}
        </Banner>
      )}

      <DirectoryDetailHero
        photos={photos}
        title={listing.title}
        accent="negocios"
        icon={Storefront}
        className="mb-4"
      />

      {/* Cabecera: el nombre manda, y debajo lo que lo ubica de un vistazo. */}
      <BezelCard variant={listing.store_verified ? "featured" : "default"} coreClassName="p-4">
        <h1 className="font-display text-xl font-bold leading-snug text-foreground">
          {listing.title}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {categoryLabel && (
            <Chip className={ACCENT_CHIP_CLASS.negocios}>{categoryLabel}</Chip>
          )}
          {listing.store_verified && (
            // Azul y no verde, igual que la card (negocios/business-card.tsx) y
            // que Marketplace (PresenciaVerificadaBadge): `store_verified` es el
            // espejo de un PLAN PAGO, y el verde queda reservado para lo que se
            // verifica de la persona (IdentityBadge). La misma tienda no puede
            // verse azul en un módulo y verde en otro por el mismo hecho.
            <Badge variant="info">
              <SealCheck size={14} weight="fill" aria-hidden="true" />
              {C.verified}
            </Badge>
          )}
        </div>
        {listing.area_label && (
          <p className="mt-2.5 flex items-center gap-1.5 text-sm text-foreground-secondary">
            <MapPin size={16} aria-hidden="true" className="shrink-0" />
            {listing.area_label}
          </p>
        )}
        {listing.store_verified && (
          <p className="mt-1.5 text-xs text-foreground-muted">{C.verifiedHint}</p>
        )}
      </BezelCard>

      {/* Seguir el negocio (0023): sólo con dueño con cuenta — sin cuenta no
          hay quién publique novedades para seguir. */}
      {listing.created_by && (
        <FollowRow
          targetId={listing.id}
          followerCount={followerCount ?? 0}
          isFollowing={Boolean(myFollowResult.data)}
          className="mt-4"
        />
      )}

      {/* CONTACTO. `ListingActions` decide sola: en `free` no renderiza nada
          (el chat es el único canal y se ofrece abajo), en `premium` pinta
          Llamar · WhatsApp · Sitio web · Cómo llegar con los valores cargados.
          El tier se lee de la fila, nunca del cliente. */}
      <section className="mt-6">
        <SectionTitle>{C.contactTitle}</SectionTitle>
        <ListingActions
          listingId={listing.id}
          kind="business"
          tier={listing.tier}
          values={{
            phone: listing.cta_phone,
            whatsapp: listing.cta_whatsapp,
            website: listing.cta_website,
            directions: listing.cta_address,
          }}
          subject={listing.title}
          showChat={false}
          isLoggedIn={Boolean(user)}
        />
        {listing.created_by && !isOwner ? (
          <InlineMessageCta
            listingId={listing.id}
            isLoggedIn={Boolean(user)}
            nextPath={`/negocios/${listing.id}`}
            label={C.messageLabel}
            placeholder={C.messagePlaceholder}
            className="mt-3"
          />
        ) : null}
        {!isOwner && (
          <p className="mt-2 text-xs leading-relaxed text-foreground-muted">{C.contactFree}</p>
        )}
      </section>

      <section className="mt-6">
        <SectionTitle>{C.aboutTitle}</SectionTitle>
        {listing.description ? (
          <p className="whitespace-pre-line text-base leading-relaxed text-foreground">
            {listing.description}
          </p>
        ) : (
          <SectionEmpty icon={<Storefront size={20} />}>{C.aboutEmpty}</SectionEmpty>
        )}
      </section>

      <section className="mt-6">
        <SectionTitle>{C.whereTitle}</SectionTitle>
        {address || listing.area_label ? (
          <BezelCard coreClassName="flex items-start gap-3 p-4">
            <MapPin size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
            <div className="min-w-0">
              {address && <p className="font-semibold text-foreground">{address}</p>}
              {listing.area_label && (
                <p
                  className={cn(
                    "text-sm text-foreground-secondary",
                    address && "mt-0.5",
                  )}
                >
                  {listing.area_label}
                </p>
              )}
            </div>
          </BezelCard>
        ) : (
          <SectionEmpty icon={<MapPin size={20} />}>{C.whereEmpty}</SectionEmpty>
        )}
      </section>

      {/* HORARIOS (0093). `HorarioSeccion` resuelve sola el caso "todavía no
          cargó nada" con el mismo vacío honesto de siempre — acá no se decide
          nada sobre el contenido, sólo dónde va la sección. */}
      <section className="mt-6">
        <SectionTitle>{C.hoursTitle}</SectionTitle>
        <HorarioSeccion client={supabase} listingId={listing.id} />
        {/* El editor sólo lo ve quien administra el negocio. Va acá abajo, junto
            al hueco, que es donde el dueño se da cuenta de que falta. */}
        {resenas.administraElAviso && (
          <Link
            href={`/negocios/${listing.id}/horario`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}
          >
            <PencilSimple size={16} aria-hidden="true" />
            Editar mis horarios
          </Link>
        )}
      </section>

      {ownerCard && (
        <section className="mt-6">
          <SectionTitle>{C.publisherTitle}</SectionTitle>
          {ownerCard}
        </section>
      )}

      {/* PUBLICACIONES del negocio: lo que separa un perfil de una ficha. */}
      <section className="mt-6">
        <SectionTitle>{C.postsTitle}</SectionTitle>
        {posts.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {posts.map((post) => (
              <li key={post.id}>
                {/* La publicación se abre en una HOJA, sin salir del negocio
                    (feedback cliente 2026-08-20: "mientras menos pasos
                    mejor"). Quien está mirando una ficha vino a conocer el
                    negocio: mandarlo a /feed/[id] por leer una novedad lo
                    sacaba de esa lectura y el "atrás" lo devolvía arriba de
                    todo. `PostSheetTrigger` es un client component chiquito —
                    esta página sigue siendo server. */}
                <PostSheetTrigger
                  postId={post.id}
                  className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface p-3 transition-colors duration-(--duration-fast) hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
                >
                  {post.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- miniatura del bucket público, sin optimizador
                    <img
                      src={post.photoUrl}
                      alt=""
                      className="size-14 shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex size-14 shrink-0 items-center justify-center rounded-md bg-surface-subtle text-foreground-muted"
                    >
                      <Storefront size={22} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm text-foreground">
                      {post.body || "Foto o video"}
                    </span>
                    <span className="mt-1 block text-xs text-foreground-muted">
                      {post.timeAgoLabel}
                    </span>
                  </span>
                </PostSheetTrigger>
              </li>
            ))}
          </ul>
        ) : (
          <SectionEmpty icon={<Storefront size={20} />}>{C.postsEmpty}</SectionEmpty>
        )}
      </section>

      {/* PUESTOS ABIERTOS (0107). Va DESPUÉS de las publicaciones y ANTES de
          las reseñas: quien llegó hasta acá ya sabe qué hace el negocio, y una
          vacante es una llamada a la acción — no puede quedar debajo de una
          lista de reseñas que puede medir dos pantallas. Sin puestos abiertos
          la sección entera no existe (el componente devuelve null): "este
          negocio no está contratando" no le sirve a nadie. */}
      {puestos.length > 0 && (
        <section className="mt-6">
          <SectionTitle>{EMPLEOS_DEL_NEGOCIO_TITULO}</SectionTitle>
          <EmpleosDelNegocio puestos={puestos} />
        </section>
      )}

      {/* RESEÑAS (0093). El formulario se ofrece SOLO a quien la base va a
          dejar escribir: sin sesión no aparece, y al dueño ni a su equipo
          tampoco — a ellos les toca responder, que es otra cosa. */}
      <section className="mt-6">
        <SectionTitle>{C.reviewsTitle}</SectionTitle>
        <div className="flex flex-col gap-3">
          <ResumenPuntajeCard resumen={resenas.resumen} reparto={resenas.reparto} />

          {puedeOfrecerseElFormulario({
            usuarioId: user?.id ?? null,
            publicadoPor: listing.created_by,
            administraElAviso: resenas.administraElAviso,
            estadoDelAviso: listing.status,
          }) && <ResenaForm listingId={listing.id} resenaPropia={resenas.propia} />}

          <ResenasLista
            listingId={listing.id}
            resenas={resenas.resenas}
            puedeResponder={resenas.administraElAviso}
            hayCuenta={Boolean(user)}
            puedeEscribir={Boolean(user) && !resenas.administraElAviso && !isOwner}
          />
        </div>
      </section>
    </div>
  );
}
