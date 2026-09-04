import {
  CalendarDots,
  Clock,
  MapPin,
  Storefront,
  Toolbox,
} from "@phosphor-icons/react/dist/ssr";
import { Avatar, Badge, Banner, BezelCard } from "@/components/ui";
import {
  DetailFacts,
  DetailTopBar,
  PublisherTrust,
  buildTrustSignals,
  firstNameOf,
  toTrustLevel,
  type DetailFact,
} from "@/components/listings";
import { InlineMessageCta } from "@/components/listings/inline-message-cta";
import { DirectoryDetailHero } from "@/components/directory";
import { ScamShieldNotice } from "@/components/trust";
import { COPY } from "@/components/empleos/copy";
import { createClient } from "@/lib/supabase/server";
import { workModeLabel } from "@/lib/creators/work-mode";
import {
  etiquetaDeDias,
  etiquetaDePrecioDesde,
  readServiceDetails,
} from "@/lib/empleos/servicios";
import { VENCIMIENTO_COPY } from "@/lib/listings";

const C = COPY.service;

/**
 * DETALLE DE UN SERVICIO — `/empleos/[id]` cuando el aviso es `kind='service'`.
 *
 * Vive en su propio archivo y no como una rama gigante dentro de `page.tsx`
 * porque casi nada se comparte con el empleo: no hay salario obligatorio, ni
 * jornada, ni preguntas al postulante, ni bandeja de candidatos. Lo que SÍ se
 * comparte son los primitivos —`DetailTopBar` (guardar), `DirectoryDetailHero`,
 * `DetailFacts`, `PublisherTrust`, el Escudo Anti-Estafa—, así que la página se
 * ve de la misma familia sin que las dos ramas se estorben.
 *
 * LA PÁGINA DECIDE Y ESTE ARCHIVO DIBUJA: `page.tsx` ya resolvió tenant,
 * sesión, la fila y si el viewer la tenía guardada. Acá sólo se pide el perfil
 * de quien ofrece (dos lecturas baratas), igual que hace la rama de empleo.
 */

export interface ServiceDetailListing {
  id: string;
  title: string;
  description: string | null;
  attrs: unknown;
  area_label: string | null;
  work_mode: string | null;
  photos: string[] | null;
  status: string;
  created_by: string | null;
  publisher_name: string | null;
  price_amount: number | null;
  price_currency: string;
  price_period: string | null;
}

export async function ServiceDetail({
  listing,
  locale,
  viewerId,
  initialSaved,
  photoUrls,
}: {
  listing: ServiceDetailListing;
  locale: string;
  viewerId: string | null;
  initialSaved: boolean;
  /** URLs ya resueltas por la página (mismo helper que usa la rama de empleo). */
  photoUrls: string[];
}) {
  const isOwner = Boolean(viewerId && listing.created_by === viewerId);
  const details = readServiceDetails(listing.attrs);
  const priceLabel = etiquetaDePrecioDesde(
    listing.price_amount,
    listing.price_currency,
    listing.price_period,
    locale,
  );
  const modeLabel = workModeLabel(listing.work_mode);

  /**
   * Cierre (0117): un servicio también se da de baja, y un link guardado tiene
   * que decir "ya no está" en vez de ofrecer escribirle a alguien que se bajó.
   *
   * SIN segunda línea, a diferencia de Empleos ("Ya se cubrió el puesto"):
   * `closedReasonForKind` devuelve `done` para todo lo que no es propiedad,
   * empleo o producto, y el copy del repo no tiene —ni necesita— una frase para
   * `done`. El título genérico ya dice lo único que hay que decir.
   */
  const isClosed = listing.status === "closed";
  const CIERRE = VENCIMIENTO_COPY.cerrado;

  const facts: DetailFact[] = [];
  const diasLabel = etiquetaDeDias(details.days);
  if (diasLabel) {
    facts.push({
      id: "days",
      icon: CalendarDots,
      label: C.availabilityLabel,
      value: diasLabel,
    });
  }
  if (details.schedule) {
    facts.push({
      id: "schedule",
      icon: Clock,
      label: COPY.servicePublish.steps.when.scheduleLabel,
      value: details.schedule,
    });
  }
  if (listing.area_label) {
    facts.push({
      id: "area",
      icon: MapPin,
      label: C.zoneLabel,
      // La modalidad va PEGADA a la zona y no en una fila aparte: "Corona,
      // Queens · A distancia" responden la misma pregunta (¿dónde tengo que
      // estar?), y separarlas obliga a buscar la respuesta en dos lugares.
      value: modeLabel ? `${listing.area_label} · ${modeLabel}` : listing.area_label,
    });
  } else if (modeLabel) {
    facts.push({ id: "mode", icon: MapPin, label: C.zoneLabel, value: modeLabel });
  }

  // Quién ofrece el servicio: perfil con Trust Score, o fuente externa atribuida.
  let publisherCard: React.ReactNode = null;
  if (listing.created_by) {
    const supabase = await createClient();
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

    const displayName = profile?.display_name ?? C.offeredByUnknown;
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
          <p className="text-xs text-foreground-muted">{COPY.detail.externalSourceNote}</p>
        </div>
      </BezelCard>
    );
  }

  return (
    <div className="pb-28">
      <DetailTopBar title={listing.title} listingId={listing.id} initialSaved={initialSaved} />

      {isClosed ? (
        <Banner variant="warning" className="mb-3 rounded-lg">
          <p className="font-semibold">{CIERRE.bannerTitulo}</p>
        </Banner>
      ) : (
        listing.status !== "published" &&
        isOwner && (
          <Banner variant="info" className="mb-3 rounded-lg">
            {C.pendingBanner}
          </Banner>
        )
      )}

      <DirectoryDetailHero
        photos={photoUrls}
        title={listing.title}
        accent="empleos"
        icon={Toolbox}
        className="mb-4"
      />

      {/* Cabecera editorial. A diferencia del empleo, acá NO manda el número:
          manda qué hace y desde cuándo cobra. El precio es una referencia y se
          escribe con su "Desde"; sin monto, "A convenir" se dice con todas las
          letras porque es una respuesta válida y no un dato que falta. */}
      <BezelCard variant="featured" coreClassName="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="neutral">
            <Toolbox size={14} aria-hidden="true" />
            {C.badge}
          </Badge>
          {listing.area_label && (
            <Badge variant="neutral">
              <MapPin size={14} aria-hidden="true" />
              {listing.area_label}
            </Badge>
          )}
        </div>
        <h1 className="mt-3 font-display text-xl font-bold leading-snug text-foreground">
          {listing.title}
        </h1>
        <p className="numeric mt-3 font-display text-2xl font-bold leading-none text-brand">
          {priceLabel ?? C.priceToAgree}
        </p>
        {!priceLabel && (
          <p className="mt-1 text-xs text-foreground-muted">{C.priceToAgreeHint}</p>
        )}
      </BezelCard>

      {listing.description && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-foreground-secondary">{C.aboutTitle}</h2>
          <p className="whitespace-pre-line text-base leading-relaxed text-foreground">
            {listing.description}
          </p>
        </section>
      )}

      <DetailFacts title={C.detailsTitle} facts={facts} footnote={C.detailsFootnote} />

      {publisherCard && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-foreground-secondary">
            {C.publishedBy}
          </h2>
          {publisherCard}
        </section>
      )}

      {/* Escudo Anti-Estafa con la variante de SERVICIOS (no la de empleo): el
          engaño típico de este lado del mostrador es la seña por adelantado a
          alguien que después no aparece. */}
      <ScamShieldNotice variant="services" className="mt-6" />

      <div className="mt-6">
        {isOwner ? (
          // La pregunta que se hace quien publicó al no ver una bandeja de
          // candidatos, contestada donde la busca.
          <BezelCard coreClassName="p-4">
            <p className="text-sm leading-relaxed text-foreground-secondary">
              {C.ownerNoApplications}
            </p>
          </BezelCard>
        ) : (
          !isClosed &&
          listing.created_by && (
            <InlineMessageCta
              listingId={listing.id}
              isLoggedIn={Boolean(viewerId)}
              label={C.contact}
              placeholder={C.contactPlaceholder}
            />
          )
        )}
      </div>
    </div>
  );
}
