import { Suspense } from "react";
import Link from "next/link";
import { EmptyState, SectionCta, SectionHeading, buttonVariants } from "@/components/ui";
import {
  COPY,
  EventCard,
  EventListSkeleton,
  eventDateParts,
  parseEventAttrs,
  type EventCardModel,
} from "@/components/directory";
import {
  allPhotoUrls,
  buildTrustSignals,
  firstNameOf,
  firstPhotoUrl,
  toTrustLevel,
} from "@/components/listings";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";

export const metadata = { title: "Eventos" };

const C = COPY.events;
const MAX_EVENTS = 40;
const MAX_PAST = 5;

/** Acento + ícono 3D de la sección (los mismos del menú y de /buscar). */
const SECCION = {
  accent: "var(--accent-eventos)",
  image: "/icons/menu/eventos.webp",
  publicarHref: "/publicar?kind=event",
} as const;

export default async function EventosPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EventosContent />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Contenido (streamed): datos reales con RLS del usuario
// ---------------------------------------------------------------------------

async function EventosContent() {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);

  // Orden cronológico por fecha del evento (attrs.starts_at); los sin fecha
  // van al final. El volumen de eventos activos es chico — sin cursor.
  const { data: rows, error } = await supabase
    .from("listings")
    .select("id, title, area_label, attrs, photos, publisher_name, created_by, created_at")
    .eq("tenant_id", tenant.id)
    .eq("kind", "event")
    .eq("status", "published")
    .order("attrs->>starts_at", { ascending: true, nullsFirst: false })
    .limit(MAX_EVENTS);

  if (error) {
    console.warn("[directorios] query de eventos falló", { code: error.code });
  }

  // Organizadores con cuenta: perfil + Trust Score en batch (una query por
  // tabla, no una por evento). Regla: donde hay autor, TrustScoreBadge inline.
  const publisherIds = [
    ...new Set((rows ?? []).map((row) => row.created_by).filter((id): id is string => Boolean(id))),
  ];
  const [{ data: profiles }, { data: trustRows }] = await Promise.all([
    publisherIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, display_name, identity_verified")
          .in("id", publisherIds)
      : Promise.resolve({
          data: [] as { id: string; display_name: string | null; identity_verified: boolean }[],
        }),
    publisherIds.length > 0
      ? supabase
          .from("trust_scores")
          .select("profile_id, score, level, signals")
          .in("profile_id", publisherIds)
      : Promise.resolve({
          data: [] as {
            profile_id: string;
            score: number;
            level: string | null;
            signals: unknown;
          }[],
        }),
  ]);
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const trustById = new Map((trustRows ?? []).map((t) => [t.profile_id, t]));

  const allCards: EventCardModel[] = (rows ?? []).map((row) => {
    const attrs = parseEventAttrs(row.attrs);
    const profile = row.created_by ? profileById.get(row.created_by) : undefined;
    const trust = row.created_by ? trustById.get(row.created_by) : undefined;
    const memberName = profile?.display_name ?? null;
    return {
      id: row.id,
      title: row.title,
      venueArea: attrs.venueArea ?? row.area_label,
      date: attrs.startsAt ? eventDateParts(attrs.startsAt, tenant.locale) : null,
      free: attrs.free,
      photoUrl: firstPhotoUrl(row.photos),
      // Todas las fotos ya resueltas: tocar la foto abre el visor con la
      // galería completa, sin entrar al detalle (feedback 2026-07-26).
      photos: allPhotoUrls(row.photos),
      publisherTrust:
        row.created_by && memberName
          ? {
              displayName: memberName,
              firstName: firstNameOf(memberName),
              score: trust?.score ?? 0,
              level: toTrustLevel(trust?.level),
              signals: buildTrustSignals(
                (trust?.signals ?? {}) as Parameters<typeof buildTrustSignals>[0],
                profile?.identity_verified ?? false,
              ),
            }
          : null,
      publisherName: row.created_by ? memberName : (row.publisher_name ?? null),
    };
  });

  const upcoming = allCards.filter((card) => !card.date || !card.date.isPast);
  const past = allCards
    .filter((card) => card.date?.isPast)
    .reverse() // los más recientes primero
    .slice(0, MAX_PAST);

  return (
    <>
      <SectionHeading
        accent={SECCION.accent}
        image={SECCION.image}
        title={C.title}
        subtitle={C.subtitle}
      />

      <SectionCta
        accent={SECCION.accent}
        href={SECCION.publicarHref}
        title={t("sections", "publishEventTitle")}
        hint={t("sections", "publishEventHint")}
        className="mb-5 mt-3"
      />

      {upcoming.length === 0 && past.length === 0 ? (
        <EmptyState
          illustration="/images/empty-state-search.png"
          title={C.emptyTitle}
          message={C.emptyMessage}
          action={
            // El MISMO destino que el CTA de arriba: `?kind=event` deja el
            // formulario abierto en Eventos (publicar/page.tsx lo honra). Sin el
            // parámetro, quien llega desde el estado vacío de Eventos aterriza
            // en un selector de tipo y tiene que volver a elegir lo que ya eligió.
            <Link
              href={SECCION.publicarHref}
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              {C.publishCta}
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {upcoming.map((card) => (
            <EventCard key={card.id} event={card} />
          ))}

          {past.length > 0 && (
            <>
              <h2 className="mt-4 text-sm font-semibold text-foreground-muted">
                {C.pastSectionTitle}
              </h2>
              {past.map((card) => (
                <EventCard key={card.id} event={card} />
              ))}
            </>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Fallback: silueta del header + cards (shimmer, §5.2)
// ---------------------------------------------------------------------------

function PageSkeleton() {
  return (
    <div aria-busy="true">
      <SectionHeading
        accent={SECCION.accent}
        image={SECCION.image}
        title={C.title}
        subtitle={C.subtitle}
      />
      <SectionCta
        accent={SECCION.accent}
        href={SECCION.publicarHref}
        title={t("sections", "publishEventTitle")}
        hint={t("sections", "publishEventHint")}
        className="mb-5 mt-3"
      />
      <EventListSkeleton />
    </div>
  );
}
