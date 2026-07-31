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
import {
  ModuleFilterChips,
  ModuleFilterSelect,
  ModuleSearchBar,
  sanitizeSearchQuery,
  type FilterOption,
} from "@/components/search";
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

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * FILTROS: sólo los que la base puede responder HOY.
 *
 *   · `cuando`  → `attrs.starts_at` (existe);
 *   · `entrada` → `attrs.free` (existe, booleano);
 *   · `ciudad`  → `listings.area_label` (existe);
 *   · `q`       → `listings.search`, el mismo índice FTS español que usan
 *                 /propiedades y /marketplace (migración 0004).
 *
 * NO se implementa el filtro por CATEGORÍA de evento que pide la spec: no hay
 * columna ni convención en `attrs` para eso, y los eventos ya publicados no la
 * traen. Inventar un desplegable que filtra sobre un campo vacío es peor que no
 * tenerlo — quedaría siempre en cero y parecería que no hay eventos. Anotado
 * como pendiente de base en la entrega.
 */
type When = "" | "mes" | "pasados";
type Ticket = "" | "gratis" | "pago";

interface Filters {
  q: string;
  cuando: When;
  entrada: Ticket;
  ciudad: string;
}

/** Tarjeta + la fecha CRUDA, que `EventCardModel.date` ya no conserva. */
interface EventRow {
  card: EventCardModel;
  startsAt: string | null;
}

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const cuando = firstValue(sp.cuando);
  const entrada = firstValue(sp.entrada);
  return {
    q: sanitizeSearchQuery(firstValue(sp.q)),
    cuando: cuando === "mes" || cuando === "pasados" ? cuando : "",
    entrada: entrada === "gratis" || entrada === "pago" ? entrada : "",
    // Se recorta pero no se valida contra una lista: `area_label` es texto
    // libre y una ciudad que no exista devuelve cero resultados, que es la
    // respuesta correcta y no un error.
    ciudad: firstValue(sp.ciudad).slice(0, 80),
  };
}

const WHEN_OPTIONS: FilterOption[] = [
  { value: "", label: t("sections", "eventsWhenUpcoming") },
  { value: "mes", label: t("sections", "eventsWhenMonth") },
  { value: "pasados", label: t("sections", "eventsWhenPast") },
];

const TICKET_OPTIONS: FilterOption[] = [
  { value: "", label: t("sections", "eventsPriceAny") },
  { value: "gratis", label: t("sections", "eventsPriceFree") },
  { value: "pago", label: t("sections", "eventsPricePaid") },
];

export default async function EventosPage({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseFilters(await searchParams);

  // La key remonta el Suspense en cada cambio de filtro: vuelve el skeleton en
  // vez de dejar congelada la lista vieja mientras llega la nueva.
  return (
    <Suspense key={JSON.stringify(filters)} fallback={<PageSkeleton />}>
      <EventosContent filters={filters} />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Contenido (streamed): datos reales con RLS del usuario
// ---------------------------------------------------------------------------

async function EventosContent({ filters }: { filters: Filters }) {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);

  // Orden cronológico por fecha del evento (attrs.starts_at); los sin fecha
  // van al final. El volumen de eventos activos es chico — sin cursor.
  let query = supabase
    .from("listings")
    .select("id, title, area_label, attrs, photos, publisher_name, created_by, created_at")
    .eq("tenant_id", tenant.id)
    .eq("kind", "event")
    .eq("status", "published");

  if (filters.q) {
    // Mismo índice FTS que /propiedades y /marketplace (listings.search, 0004).
    query = query.textSearch("search", filters.q, { type: "websearch", config: "spanish" });
  }
  if (filters.ciudad) query = query.eq("area_label", filters.ciudad);

  const { data: rows, error } = await query
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

  // Se conserva `startsAt` junto a la tarjeta: `EventCardModel.date` ya viene
  // formateado para pintar (día, mes, "es pasado") y no tiene la fecha cruda,
  // que es la que necesita el filtro "este mes".
  const allEvents: EventRow[] = (rows ?? []).map((row) => {
    const attrs = parseEventAttrs(row.attrs);
    const profile = row.created_by ? profileById.get(row.created_by) : undefined;
    const trust = row.created_by ? trustById.get(row.created_by) : undefined;
    const memberName = profile?.display_name ?? null;
    const card: EventCardModel = {
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
    return { card, startsAt: attrs.startsAt };
  });

  // `entrada` se resuelve en memoria y no en SQL a propósito: `attrs.free` es
  // un booleano DENTRO de un json y su ausencia significa "no gratis". Ese
  // "ausente = false" en PostgREST necesita un `.or(...is.null,...neq)` que se
  // lee peor y se rompe más fácil que un filtro sobre datos ya parseados —
  // sobre todo cuando el listado nunca supera las 40 filas.
  const filtered = allEvents.filter(
    ({ card }) =>
      filters.entrada === "" || (filters.entrada === "gratis" ? card.free : !card.free),
  );
  const { upcoming, past } = splitByWhen(filtered, filters.cuando);
  const isEmpty = upcoming.length === 0 && past.length === 0;
  const filtering = Boolean(filters.q || filters.cuando || filters.entrada || filters.ciudad);

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
        className="mb-4 mt-3"
      />

      <Filters cities={cityOptions(allEvents, filters.ciudad)} />

      {isEmpty ? (
        filtering ? (
          /* Buscó y no hay: se dice qué probar y se ofrece salir de los filtros
             — no el mismo cartel de "todavía no hay eventos", que sería mentira
             y dejaría a la persona pensando que la sección está vacía. */
          <EmptyState
            className="mt-5"
            illustration="/images/empty-state-search.png"
            title={t("sections", "moduleNoMatchTitle")}
            message={t("sections", "moduleNoMatchMessage")}
            action={
              <Link
                href="/eventos"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {t("sections", "moduleClearFilters")}
              </Link>
            }
          />
        ) : (
          <EmptyState
            className="mt-5"
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
        )
      ) : (
        <div className="mt-5 flex flex-col gap-4">
          {upcoming.map((card) => (
            <EventCard key={card.id} event={card} />
          ))}

          {past.length > 0 && (
            <>
              {upcoming.length > 0 && (
                <h2 className="mt-4 text-sm font-semibold text-foreground-muted">
                  {C.pastSectionTitle}
                </h2>
              )}
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
// Barra de filtros (islas cliente sobre un contenedor de servidor)
// ---------------------------------------------------------------------------

function Filters({ cities }: { cities: FilterOption[] }) {
  return (
    <div className="flex flex-col gap-3">
      <ModuleSearchBar
        label={t("sections", "searchEventsLabel")}
        placeholder={t("sections", "searchEventsPlaceholder")}
      />
      <ModuleFilterChips
        param="cuando"
        label={t("sections", "eventsWhenLabel")}
        options={WHEN_OPTIONS}
      />
      <div className="flex gap-2">
        <ModuleFilterSelect
          param="entrada"
          label={t("sections", "eventsPriceLabel")}
          options={TICKET_OPTIONS}
          className="flex-1"
        />
        {/* La ciudad sólo aparece cuando hay más de una: un desplegable con una
            única opción es una decisión que no existe. */}
        {cities.length > 1 && (
          <ModuleFilterSelect
            param="ciudad"
            label={t("sections", "eventsCityLabel")}
            options={cities}
            className="flex-1"
          />
        )}
      </div>
    </div>
  );
}

/**
 * Ciudades para el desplegable: las que realmente tienen eventos, más la que
 * está filtrada ahora mismo aunque su resultado sea cero (si no, elegir una
 * ciudad sin eventos la borraría del desplegable y no habría forma de salir).
 *
 * Ojo: la lista sale de las filas YA filtradas por `?ciudad=`, así que al
 * elegir una ciudad el desplegable se reduce a esa. Es el precio de no pagar
 * una segunda query sólo para poblar un `<select>` en un listado de 40 filas;
 * la opción "Todas las ciudades" siempre está y devuelve la lista completa.
 */
function cityOptions(events: readonly EventRow[], active: string): FilterOption[] {
  const cities = new Set<string>();
  for (const { card } of events) {
    const city = card.venueArea?.trim();
    if (city) cities.add(city);
  }
  if (active) cities.add(active);
  return [
    { value: "", label: t("sections", "eventsCityAny") },
    ...[...cities]
      .sort((a, b) => a.localeCompare(b, "es"))
      .map((city) => ({ value: city, label: city })),
  ];
}

/**
 * Reparte las tarjetas en los dos bloques según el filtro temporal.
 *
 * Sin filtro se conserva el comportamiento histórico de la pantalla (los
 * próximos, y una cola corta de los últimos que pasaron) porque es el que el
 * cliente ya vio y aprobó. Los filtros explícitos muestran UN bloque solo.
 */
function splitByWhen(
  events: readonly EventRow[],
  when: When,
): { upcoming: EventCardModel[]; past: EventCardModel[] } {
  const upcoming = events.filter(({ card }) => !card.date || !card.date.isPast);
  const past = events.filter(({ card }) => card.date?.isPast);
  const cards = (list: readonly EventRow[]) => list.map((entry) => entry.card);

  if (when === "pasados") {
    // Los que pasaron, del más reciente al más viejo, y TODOS: si alguien pidió
    // ver lo que pasó, recortarle la lista a cinco es contestarle otra cosa.
    return { upcoming: [], past: cards([...past].reverse()) };
  }

  if (when === "mes") {
    const now = new Date();
    const sameMonth = upcoming.filter(({ startsAt }) => {
      if (!startsAt) return false; // sin fecha no se puede afirmar que sea de este mes
      const date = new Date(startsAt);
      if (Number.isNaN(date.getTime())) return false;
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    });
    return { upcoming: cards(sameMonth), past: [] };
  }

  return { upcoming: cards(upcoming), past: cards([...past].reverse().slice(0, MAX_PAST)) };
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
        className="mb-4 mt-3"
      />
      <div className="mt-5">
        <EventListSkeleton />
      </div>
    </div>
  );
}
