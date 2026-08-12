import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarBlank,
  CheckCircle,
  HandHeart,
  MagnifyingGlass,
  MapPin,
} from "@phosphor-icons/react/dist/ssr";
import { BezelCard, Chip } from "@/components/ui";
import { ContactCta, ListingGallery, PublisherTrust, firstNameOf } from "@/components/listings";
import { ResolverBoton } from "@/components/comunidad";
import {
  COMUNIDAD_COPY,
  LOST_FOUND_CATEGORY_LABEL,
} from "@/lib/comunidad";
import { getAuthUserId } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { formatDate } from "@/lib/utils";
import { fetchLostFoundCase } from "../../queries";

const C = COMUNIDAD_COPY.perdidos;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const [tenant, viewerId] = await Promise.all([getTenant(), getAuthUserId()]);
  const caso = await fetchLostFoundCase({ id, tenantId: tenant.id, viewerId });
  return caso ? { title: caso.title } : {};
}

/**
 * DETALLE DE UN CASO.
 *
 * ── EL CONTACTO PASA POR DONDE YA PASA TODO ─────────────────────────────────
 * Se reusa `<ContactCta>`, el mismo componente del resto de los avisos: abre
 * una conversación protegida por `request_contact` en vez de publicar un
 * teléfono. Acá importa el doble — el caso típico de estafa de esta sección es
 * "yo tengo tus documentos, mandame el envío", y un canal dentro de la
 * plataforma deja rastro, se puede reportar y se puede bloquear.
 *
 * ── EL BOTÓN DE "YA APARECIÓ" SÓLO LO VE SU DUEÑO ───────────────────────────
 * `caso.isOwner` sale de comparar `created_by` con el viewer en el servidor, y
 * la base lo vuelve a verificar dentro de `marcar_caso_resuelto`. Esconderlo es
 * cortesía; la regla vive en el SQL.
 */
export default async function CasoPage({ params }: Props) {
  const { id } = await params;
  const [tenant, viewerId] = await Promise.all([getTenant(), getAuthUserId()]);
  const caso = await fetchLostFoundCase({ id, tenantId: tenant.id, viewerId });

  // Un caso en borrador o dado de baja no existe para quien no es su dueño: la
  // RLS ya lo filtró, así que acá alcanza con el 404 de siempre.
  if (!caso) notFound();

  const resuelto = caso.resolvedAt !== null;
  const esEncontrado = caso.type === "found";

  return (
    <article className="pb-4">
      <Link
        href="/comunidad/perdidos"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-foreground-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {C.title}
      </Link>

      {caso.photos.length > 0 && (
        <ListingGallery photos={caso.photos} title={caso.title} className="mt-3" />
      )}

      <header className="mt-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip
            variant={esEncontrado ? "success" : "warning"}
            icon={
              esEncontrado ? (
                <HandHeart size={16} weight="fill" aria-hidden="true" />
              ) : (
                <MagnifyingGlass size={16} weight="bold" aria-hidden="true" />
              )
            }
          >
            {esEncontrado ? C.card.foundBadge : C.card.lostBadge}
          </Chip>
          {caso.category && <Chip>{LOST_FOUND_CATEGORY_LABEL[caso.category]}</Chip>}
        </div>

        <h1 className="mt-3 font-display text-2xl font-bold leading-tight tracking-tight text-foreground">
          {caso.title}
        </h1>

        <div className="mt-3 space-y-1.5 text-sm text-foreground-secondary">
          <p className="flex items-start gap-2">
            <MapPin size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-foreground-muted" />
            <span>{caso.areaLabel ?? C.card.noArea}</span>
          </p>
          {caso.happenedOn && (
            <p className="flex items-center gap-2">
              <CalendarBlank size={18} aria-hidden="true" className="shrink-0 text-foreground-muted" />
              {C.card.happenedOn(formatDate(caso.happenedOn, { style: "long" }))}
            </p>
          )}
          <p className="text-foreground-muted">{caso.publishedAtLabel}</p>
        </div>
      </header>

      {resuelto && (
        <BezelCard variant="success" className="mt-5" coreClassName="flex gap-3 p-4">
          <CheckCircle
            size={20}
            weight="fill"
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-success-ink"
          />
          <div>
            <h2 className="font-display text-base font-semibold text-foreground">
              {C.detail.resolvedTitle}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">
              {C.detail.resolvedBody}
            </p>
          </div>
        </BezelCard>
      )}

      {caso.description && (
        <p className="mt-5 whitespace-pre-line text-base leading-relaxed text-foreground">
          {caso.description}
        </p>
      )}

      {caso.publisher?.type === "member" && (
        <div className="mt-6">
          <PublisherTrust
            displayName={caso.publisher.displayName}
            firstName={firstNameOf(caso.publisher.displayName)}
            score={caso.publisher.score}
            level={caso.publisher.level}
            signals={caso.publisher.signals}
            profileId={caso.publisher.profileId}
            size="card"
          />
        </div>
      )}

      {/* Dueño: resolver. Cualquier otro: escribir. Nunca las dos — el dueño no
          se manda mensajes a sí mismo, y ofrecérselo sería ruido en el momento
          en que está tratando de cerrar el caso. */}
      <div className="mt-6">
        {caso.isOwner ? (
          <ResolverBoton caseId={caso.id} resolved={resuelto} />
        ) : (
          <BezelCard coreClassName="space-y-3 p-5">
            <div>
              <h2 className="font-display text-base font-semibold text-foreground">
                {C.detail.contactTitle}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">
                {C.detail.contactHint}
              </p>
            </div>
            <ContactCta listingId={caso.id} isLoggedIn={Boolean(viewerId)} isExternal={false} />
          </BezelCard>
        )}
      </div>

      <p className="mt-5 text-sm leading-relaxed text-foreground-muted">
        {C.detail.reportHint}
      </p>
    </article>
  );
}
