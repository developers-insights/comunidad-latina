import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Armchair,
  Bathtub,
  Bed,
  CalendarCheck,
  ChartBar,
  House,
  Key,
  Lightning,
  ListChecks,
  MapPin,
  Money,
  Receipt,
  RocketLaunch,
  Ruler,
  Storefront,
  Tag,
} from "@phosphor-icons/react/dist/ssr";
import { Avatar, Banner, BezelCard, Chip, buttonVariants } from "@/components/ui";

import {
  COPY,
  ContactCta,
  DetailFacts,
  DetailTopBar,
  ListingActions,
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
// Los guardados (tabla `saves`, polimórfica) los lee el módulo FEED, que es su
// dueño: así la query vive una sola vez y no se duplica por vertical.
import { fetchViewerSavedListingIds } from "@/app/(app)/feed/queries";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import {
  PROPERTY_OPERATION_LABEL,
  PROPERTY_TYPE_LABEL,
  readPropertyFacts,
} from "@/lib/propiedades/tipos";
import {
  FURNISHED_LABEL,
  RENTAL_TERMS_COPY,
  readRentalTerms,
  rentalRequirementLabel,
  rentalUtilityLabel,
} from "@/lib/propiedades/alquiler";
import { getViewerFormatDate } from "@/lib/time/viewer-zone";
import { cn } from "@/lib/utils";
import type { DetailFact } from "@/components/listings";

type Params = Promise<{ id: string }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lectura de la propiedad, cache()-eada por request: `generateMetadata` y el
 * cuerpo de la página comparten la MISMA fila con un solo round-trip a la DB
 * (React dedupe la llamada dentro del request). Selecciona el superset que el
 * detalle necesita. RLS ya limita qué filas existen para este usuario.
 */
const fetchListingById = cache(async (id: string) => {
  const supabase = await createClient();
  return supabase
    .from("listings")
    .select(
      // tier + los 3 CTAs que ofrece Propiedades (MODULE_CTAS.property): se
      // piden acá y no en otra query porque son columnas de la MISMA fila
      // (por eso la 0048 los puso como columnas y no en una tabla aparte).
      "id, tenant_id, kind, title, description, price_amount, price_currency, price_period, attrs, area_label, photos, status, created_by, publisher_name, publisher_kind, source, created_at, tier, cta_phone, cta_whatsapp, cta_address",
    )
    .eq("id", id)
    .eq("kind", "property")
    .maybeSingle();
});

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: "Propiedad" };
  const { data } = await fetchListingById(id);
  return { title: data?.title ?? "Propiedad" };
}

export default async function PropiedadDetallePage({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const [tenant, supabase, { data: listing }] = await Promise.all([
    getTenant(),
    createClient(),
    fetchListingById(id),
  ]);

  // RLS ya limita qué filas existen para este usuario (published | propias | staff).
  if (!listing || listing.tenant_id !== tenant.id) notFound();

  // ---------------------------------------------------------------------
  // getUser() y la verificación vinculada son independientes → en paralelo.
  // Verificación (regla estricta: SOLO found_active → banda; sin check →
  // ausencia, jamás un negativo).
  // ---------------------------------------------------------------------
  const [
    {
      data: { user },
    },
    { data: checks },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("verification_checks")
      .select("registry, registry_url, license_number, checked_at")
      .eq("tenant_id", tenant.id)
      .eq("subject_kind", "listing")
      .eq("subject_id", listing.id)
      .eq("result", "found_active")
      .order("checked_at", { ascending: false })
      .limit(1),
  ]);

  // Guardado del viewer para este aviso (sin sesión resuelve vacío al instante).
  const savedListingIds = await fetchViewerSavedListingIds(supabase, user?.id ?? null, [
    listing.id,
  ]);

  /**
   * `verification_checks.checked_at` es `timestamptz` (0005), o sea un INSTANTE:
   * el momento en que se consultó el registro oficial. Formatearlo en la zona
   * fija de la comunidad fecha la verificación un día antes para quien mira
   * desde la costa oeste. Va con el reloj de quien lee.
   */
  const formatDate = await getViewerFormatDate();
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
              profileId={profile?.id ?? null}
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
  // Tipo y operación. Los avisos publicados antes de esta feature no los
  // declaran y salen en null: ahí NO se muestra nada. Un aviso viejo no dice
  // "Alquiler" porque nunca lo dijo, y tampoco dice "sin especificar", que
  // sería señalar una falta que no es de quien publicó.
  const facts = readPropertyFacts(listing.attrs);
  const priceLabel = formatListingPrice(
    listing.price_amount,
    listing.price_currency,
    listing.price_period,
    tenant.locale,
  );
  const photos = (listing.photos ?? []).map(listingPhotoUrl);
  const isOwner = Boolean(user && listing.created_by === user.id);

  /**
   * Condiciones del alquiler (`readRentalTerms`) — depósito, cargos aparte,
   * servicios incluidos, requisitos, muebles y desde cuándo.
   *
   * El formulario de publicar ya capturaba las seis y el detalle no mostraba
   * NINGUNA: la persona las cargaba y después igual contestaba las mismas seis
   * preguntas por chat. Cada fila se agrega SÓLO si el aviso la declaró — un
   * aviso viejo no dice "sin amueblar" porque nunca lo dijo (ver el docblock de
   * `alquiler.ts`), y una ficha sin filas no renderiza la sección.
   *
   * El depósito en CERO sí se muestra, y con su propia frase: "no pido
   * depósito" es una afirmación fuerte y buena para quien alquila, y colapsarla
   * a "US$ 0" la haría parecer un campo sin completar.
   */
  const rental = readRentalTerms(listing.attrs);
  const rentalFacts: DetailFact[] = [];
  if (rental.deposit !== null) {
    rentalFacts.push({
      id: "deposit",
      icon: Money,
      label: RENTAL_TERMS_COPY.deposit,
      value:
        rental.deposit === 0
          ? RENTAL_TERMS_COPY.noDeposit
          : (formatListingPrice(rental.deposit, listing.price_currency, null, tenant.locale) ??
            RENTAL_TERMS_COPY.noDeposit),
    });
  }
  if (rental.extraFees) {
    rentalFacts.push({
      id: "extra-fees",
      icon: Receipt,
      label: RENTAL_TERMS_COPY.extraFees,
      value: rental.extraFees,
    });
  }
  if (rental.utilities.length > 0) {
    rentalFacts.push({
      id: "utilities",
      icon: Lightning,
      label: RENTAL_TERMS_COPY.utilities,
      // `rentalUtilityLabel` sólo devuelve null para un valor fuera del
      // catálogo, y `normalizeUtilities` ya descartó ésos: el filtro es la red
      // de contención del tipo, no un caso esperado.
      value: rental.utilities
        .map((slug) => rentalUtilityLabel(slug))
        .filter(Boolean)
        .join(" · "),
    });
  }
  if (rental.requirements.length > 0) {
    rentalFacts.push({
      id: "requirements",
      icon: ListChecks,
      label: RENTAL_TERMS_COPY.requirements,
      value: rental.requirements
        .map((slug) => rentalRequirementLabel(slug))
        .filter(Boolean)
        .join(" · "),
    });
  }
  if (rental.furnished !== null) {
    rentalFacts.push({
      id: "furnished",
      icon: Armchair,
      label: RENTAL_TERMS_COPY.furnished,
      value: FURNISHED_LABEL[rental.furnished],
    });
  }
  if (rental.availableFrom) {
    rentalFacts.push({
      id: "available-from",
      icon: CalendarCheck,
      label: RENTAL_TERMS_COPY.availableFrom,
      // `formatDate` detecta el formato `YYYY-MM-DD` y lo formatea en UTC: una
      // fecha sin hora no es un instante, y pasarla por la zona del lector le
      // restaría un día a cualquiera al oeste de Greenwich.
      value: formatDate(rental.availableFrom, { locale: tenant.locale, style: "long" }),
    });
  }

  return (
    // pb-40: el CTA "Contactar" es `fixed` sobre el bottom-nav (3.5rem) y se
    // eleva con env(safe-area-inset-bottom) en equipos con notch/home indicator.
    // Su footprint real (barra sólida + botón lg + hint) ronda las 7rem, así que
    // con el pb-28 del <main> queda holgura para que la última card no quede
    // tapada. Ver §4.d (CTA sticky).
    <div className="pb-40">
      <DetailTopBar
        title={listing.title}
        listingId={listing.id}
        initialSaved={savedListingIds.has(listing.id)}
      />

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

      {/* Operación y tipo ABREN la fila de características, pegados al precio:
          es donde el ojo ya está y es lo que le da sentido al número ("$1.350"
          no significa lo mismo en un alquiler que en una venta).

          La operación va en `brand` y el tipo en neutro, la misma jerarquía que
          tienen como decisión: primero si se alquila o se vende, después qué
          es. Cada chip lleva su ícono Y su texto — el color nunca es el único
          que distingue una operación de la otra. */}
      {(facts.operation !== null ||
        facts.type !== null ||
        attrs.bedrooms !== null ||
        attrs.bathrooms !== null ||
        attrs.sqft !== null) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {facts.operation !== null && (
            <Chip variant="brand" icon={facts.operation === "venta" ? <Tag /> : <Key />}>
              {PROPERTY_OPERATION_LABEL[facts.operation]}
            </Chip>
          )}
          {facts.type !== null && (
            <Chip icon={<House />}>{PROPERTY_TYPE_LABEL[facts.type]}</Chip>
          )}
          {attrs.bedrooms !== null && (
            <Chip icon={<Bed />}>{COPY.detail.bedrooms(attrs.bedrooms)}</Chip>
          )}
          {attrs.bathrooms !== null && (
            <Chip icon={<Bathtub />}>{COPY.detail.bathrooms(attrs.bathrooms)}</Chip>
          )}
          {attrs.sqft !== null && <Chip icon={<Ruler />}>{COPY.detail.sqft(attrs.sqft)}</Chip>}
        </div>
      )}

      {/* Botones de acción (premium). En una publicación gratuita no renderiza
          NADA: el contacto es la barra de "Contactar" de abajo, que está visible
          al mismo tiempo — por eso acá el chat va con showChat={false} y no se
          duplica el mismo botón dos veces en la misma pantalla. */}
      <ListingActions
        className="mt-5"
        listingId={listing.id}
        kind={listing.kind}
        tier={listing.tier}
        subject={listing.title}
        showChat={false}
        isLoggedIn={Boolean(user)}
        values={{
          phone: listing.cta_phone,
          whatsapp: listing.cta_whatsapp,
          directions: listing.cta_address,
        }}
      />

      {/* Boost §7: solo el dueño de un aviso publicado puede promocionarlo.
          "Impulsar este aviso" se conserva con ese nombre porque ya existía y
          al cliente le gustó; la pantalla que abre es la que ahora tiene los
          dos caminos. */}
      {isOwner && listing.status === "published" && (
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Link
            href={`/impulsar/${listing.id}`}
            className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full")}
          >
            <RocketLaunch size={18} aria-hidden="true" />
            Impulsar este aviso
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
            {COPY.detail.publishedBy}
          </h2>
          {publisherCard}
        </section>
      )}

      {/* Escudo Anti-Estafa oculto por ahora (pedido cliente 2026-07-20): la
          feature entera está apagada, así que su card tampoco se muestra acá.
          Al reactivar Escudo, volver a montar <ScamShieldNotice variant="rental" />. */}

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

      {/* Condiciones del alquiler — después de la descripción y ANTES de la
          ubicación: es lo que se pregunta apenas el aviso convence, y la zona
          aproximada ya la anticipó el chip de arriba. */}
      <DetailFacts
        title={RENTAL_TERMS_COPY.title}
        facts={rentalFacts}
        footnote={RENTAL_TERMS_COPY.footnote}
      />

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
