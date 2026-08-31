import { Suspense } from "react";
import Link from "next/link";
import { Megaphone } from "@phosphor-icons/react/dist/ssr";
import { Chip, EmptyState, SectionCta, SectionHeading, buttonVariants } from "@/components/ui";
import { extractSponsored } from "./sponsored";
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
import { ZonaVacia } from "@/components/zona";
import { EVENT_CATEGORIES, isEventCategory } from "@/lib/eventos/categorias";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { getViewerTimeZone } from "@/lib/time/viewer-zone";
import { resolverVistaZona } from "@/lib/zona/server";

export const metadata = { title: "Eventos" };

const C = COPY.events;
const MAX_EVENTS = 40;
const MAX_PAST = 5;
/** Tope de la franja "Patrocinados" — mismo número que /propiedades. */
const SPONSORED_LIMIT = 4;

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
 *   · `categoria` → `attrs.category` + el catálogo de `EVENT_CATEGORIES`.
 *
 * El filtro por categoría estuvo sin implementar un tiempo y este mismo bloque
 * decía que era imposible "porque no hay convención en attrs". Ya la hay
 * (`src/lib/eventos/categorias.ts`, misma clave y mismo criterio que la
 * taxonomía de negocios), así que se implementó. Se deja escrito porque la
 * razón original sigue siendo buena y sigue aplicando al REVÉS: sólo se
 * ofrecen valores del catálogo, y cualquier otra cosa que llegue por la URL se
 * descarta en vez de filtrar sobre un valor que ninguna opción del desplegable
 * puede haber puesto — un filtro que devuelve cero y del que no se puede salir
 * es exactamente lo que se quería evitar.
 *
 * La categoría se filtra en SQL y no en memoria, al revés que `entrada`: acá el
 * valor es un texto presente o ausente (no un booleano cuya ausencia significa
 * algo), así que `eq` sobre `attrs->>category` dice justo lo que se quiere y
 * deja que la base descarte filas antes del tope de 40.
 */
type When = "" | "mes" | "pasados";
type Ticket = "" | "gratis" | "pago";

interface Filters {
  q: string;
  cuando: When;
  entrada: Ticket;
  ciudad: string;
  categoria: string;
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
  const categoria = firstValue(sp.categoria);
  return {
    q: sanitizeSearchQuery(firstValue(sp.q)),
    cuando: cuando === "mes" || cuando === "pasados" ? cuando : "",
    entrada: entrada === "gratis" || entrada === "pago" ? entrada : "",
    // Se recorta pero no se valida contra una lista: `area_label` es texto
    // libre y una ciudad que no exista devuelve cero resultados, que es la
    // respuesta correcta y no un error.
    ciudad: firstValue(sp.ciudad).slice(0, 80),
    // La categoría SÍ se valida: al revés que la ciudad, es un catálogo cerrado
    // y un valor inventado sólo puede venir de una URL a mano.
    categoria: isEventCategory(categoria) ? categoria : "",
  };
}

const WHEN_OPTIONS: FilterOption[] = [
  { value: "", label: t("sections", "eventsWhenUpcoming") },
  { value: "mes", label: t("sections", "eventsWhenMonth") },
  { value: "pasados", label: t("sections", "eventsWhenPast") },
];

const CATEGORY_OPTIONS: FilterOption[] = [
  { value: "", label: t("sections", "eventsCategoryAny") },
  ...EVENT_CATEGORIES.map((option) => ({ value: option.value, label: option.label })),
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
  const [tenant, supabase, viewerZone] = await Promise.all([
    getTenant(),
    createClient(),
    // La zona de quien mira: la hora de un evento sin zona es el reloj del
    // runtime, o sea la de nadie (ver `eventDateParts`).
    getViewerTimeZone(),
  ]);

  // "Tu zona": manda el `?ciudad=` de la URL si está puesto (un enlace
  // compartido muestra lo que promete) y si no, la zona elegida en el header.
  const vistaZona = await resolverVistaZona(tenant.id, filters.ciudad);

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
  // Sin ciudad en la URL manda "Tu zona", ya resuelta a etiquetas exactas. Va
  // en SQL y no en memoria para que el tope de 40 filas traiga 40 eventos DE LA
  // ZONA, y no los 40 primeros de la comunidad recortados después a tres.
  else if (vistaZona.areaLabels.length > 0) {
    query = query.in("area_label", vistaZona.areaLabels);
  }
  if (filters.categoria) query = query.eq("attrs->>category", filters.categoria);

  // Boosts activos del tenant en PARALELO con el listado: `boosts` no filtra
  // por `kind` (es agnóstica — cualquier listing se puede impulsar, /impulsar
  // ya lo prueba), así que esta query no depende de `rows` y se solapa el
  // round-trip en vez de encadenarlo (mismo espíritu que el resto del
  // archivo: nunca una query después de otra si no hace falta).
  const [{ data: rows, error }, { data: activeBoosts }] = await Promise.all([
    query.order("attrs->>starts_at", { ascending: true, nullsFirst: false }).limit(MAX_EVENTS),
    supabase
      .from("boosts")
      .select("listing_id")
      .eq("tenant_id", tenant.id)
      .eq("status", "active")
      .gt("ends_at", new Date().toISOString())
      .order("ends_at", { ascending: false })
      .limit(SPONSORED_LIMIT),
  ]);

  if (error) {
    console.warn("[directorios] query de eventos falló", { code: error.code });
  }

  // Solo importa SI un listing_id está boosteado — no se distingue por `kind`
  // acá tampoco: si un id no cae dentro de los eventos ya filtrados por
  // tenant/kind/status arriba, simplemente nunca hace match más abajo.
  const boostedIds = new Set((activeBoosts ?? []).map((boost) => boost.listing_id));

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
      date: attrs.startsAt
        ? eventDateParts(attrs.startsAt, tenant.locale, viewerZone ?? undefined)
        : null,
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
              profileId: row.created_by,
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
  const filtering = Boolean(
    filters.q || filters.cuando || filters.entrada || filters.ciudad || filters.categoria,
  );

  // Patrocinados: se sacan de `upcoming`/`past` — que ya son el resultado de
  // aplicar q/entrada/ciudad (arriba) y `cuando` (recién, en splitByWhen) —
  // así que un patrocinado que no matchea el filtro activo simplemente no
  // está en ninguna de las dos listas y no aparece. Ver la decisión de orden
  // completa en el comentario de `extractSponsored`.
  const { sponsored, rest } = extractSponsored([upcoming, past], boostedIds, SPONSORED_LIMIT);
  const [upcomingRest, pastRest] = rest;

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
        // Vacío por "Tu zona" y sin ningún filtro puesto: el cartel dice el
        // nombre de la zona y ofrece salir en un toque. Sin esto, la sección
        // parece muerta cuando en realidad hay eventos en otros barrios.
        !filtering && vistaZona.filtraPorPreferencia && vistaZona.zona.label ? (
          <ZonaVacia className="mt-5" zona={vistaZona.zona.label} radioMillas={vistaZona.radioMillas} />
        ) : filtering ? (
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
          {sponsored.length > 0 && (
            <>
              <h2 className="text-sm font-semibold text-foreground-muted">Patrocinados</h2>
              {sponsored.map((card) => (
                // Mismo anillo dorado + chip que /propiedades (tokens
                // --color-sponsored, ya AA en light/dark). El wrapper envuelve
                // desde la página, igual que allá: el BezelCard de EventCard
                // usa el mismo rounded-xl (28px) que este wrapper, así que el
                // anillo calza justo alrededor sin esquina cuadrada asomando.
                <div
                  key={card.id}
                  className="relative rounded-xl ring-2 ring-sponsored/70 shadow-[0_0_0_1px_var(--color-sponsored),0_10px_28px_-14px_var(--color-sponsored)]"
                >
                  <Chip
                    variant="neutral"
                    size="sm"
                    className="absolute right-3.5 top-3.5 z-10 border-[1.5px] border-sponsored bg-surface text-sponsored-ink shadow-sm"
                  >
                    <Megaphone size={14} weight="fill" aria-hidden="true" />
                    Patrocinado
                  </Chip>
                  <EventCard event={card} />
                </div>
              ))}
            </>
          )}

          {upcomingRest.map((card) => (
            <EventCard key={card.id} event={card} />
          ))}

          {pastRest.length > 0 && (
            <>
              {(sponsored.length > 0 || upcomingRest.length > 0) && (
                <h2 className="mt-4 text-sm font-semibold text-foreground-muted">
                  {C.pastSectionTitle}
                </h2>
              )}
              {pastRest.map((card) => (
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
      {/* Tres desplegables que envuelven en vez de apretarse: en un teléfono
          angosto quedan 2 + 1 y cada uno conserva ancho legible, en cuanto hay
          espacio se acomodan en una sola fila. */}
      <div className="flex flex-wrap gap-2">
        <ModuleFilterSelect
          param="categoria"
          label={t("sections", "eventsCategoryLabel")}
          options={CATEGORY_OPTIONS}
          className="min-w-36 flex-1"
        />
        <ModuleFilterSelect
          param="entrada"
          label={t("sections", "eventsPriceLabel")}
          options={TICKET_OPTIONS}
          className="min-w-36 flex-1"
        />
        {/* La ciudad sólo aparece cuando hay más de una: un desplegable con una
            única opción es una decisión que no existe. */}
        {cities.length > 1 && (
          <ModuleFilterSelect
            param="ciudad"
            label={t("sections", "eventsCityLabel")}
            options={cities}
            className="min-w-36 flex-1"
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
 * Ojo: la lista sale de las filas YA filtradas por `?ciudad=` —y, desde "Tu
 * zona", también por la zona elegida en el header—, así que con un recorte
 * puesto el desplegable se reduce a lo que hay adentro de ese recorte. Es el
 * precio de no pagar una segunda query sólo para poblar un `<select>` en un
 * listado de 40 filas. Siempre hay salida: "Todas las ciudades" limpia el
 * `?ciudad=`, y el selector del header devuelve toda la comunidad.
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
