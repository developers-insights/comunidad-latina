import { Suspense } from "react";
import Link from "next/link";
import {
  Clock,
  MagicWand,
  MapPinLine,
  Megaphone,
  SealCheck,
  Storefront,
  Trophy,
} from "@phosphor-icons/react/dist/ssr";
import { allPhotoUrls, decodeCursor, firstNameOf, firstPhotoUrl } from "@/components/listings";
import { OfertasPanel, PublicacionesPanel } from "@/components/negocios";
import {
  ModuleFilterSelect,
  ModuleFilterToggle,
  ModuleSearchBar,
  sanitizeSearchQuery,
  type FilterOption,
} from "@/components/search";
import {
  BezelCard,
  Chip,
  EmptyState,
  NavTabs,
  SectionCta,
  SectionHeading,
  buttonVariants,
  type NavTabItem,
} from "@/components/ui";
import { ImpulsosDeOtrasComunidades } from "@/components/boosts";
import { ZonaVacia } from "@/components/zona";
import {
  recordBoostImpressions,
  resolveViewerGeo,
  selectOwnBoosts,
} from "@/lib/boosts/select";
import { t } from "@/lib/i18n";
import { canUseActionButtons } from "@/lib/monetization";
import { ctaHref } from "@/lib/monetization/href";
import {
  estadosDeApertura,
  estaAbiertoAhora,
  fetchHorariosDeNegocios,
} from "@/lib/negocios/horarios";
import {
  encodeOfertasCursor,
  fetchOfertasVigentes,
  parseOfertasCursor,
} from "@/lib/negocios/ofertas";
import { fetchBusinessPostsPage } from "@/lib/negocios/publicaciones";
import { fetchListingRatings } from "@/lib/profesionales/ratings";
import type { ResumenPuntaje } from "@/lib/resenas";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { resolverVistaZona } from "@/lib/zona/server";
import { toTrustProps } from "@/lib/trust/signals";
import type { Tables } from "@/lib/types/database.types";
import { cn } from "@/lib/utils";
import {
  BusinessCard,
  type BusinessCardModel,
  type OwnerTrust,
} from "../business-card";
import {
  BUSINESS_TAB_IDS,
  BUSINESS_TAB_LABELS,
  businessTabHref,
  parseBusinessTab,
} from "../business-tabs";
import { BUSINESS_CATEGORIES, businessCategoryLabel, businessCategoryOf } from "../categories";
import {
  COPY,
  DirectorioSkeleton,
  ListaDePublicacionesSkeleton,
  SECCION,
} from "./list-shell";
import type { AccionRapida } from "@/components/negocios";

export const metadata = { title: "Negocios" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Cuántos negocios entran en una pantalla del directorio. */
const PAGE_SIZE = 30;

/** "Todavía nadie opinó". Constante y no un literal por tarjeta: es UN objeto. */
const SIN_RESENAS: ResumenPuntaje = { promedio: null, cantidad: 0 };

/**
 * Cuántos se piden cuando hay un filtro que NO se puede expresar en SQL. Ver
 * `Filters` abajo: los tres filtros nuevos que dependen de horarios,
 * calificaciones o Trust Score se aplican en memoria sobre este colchón.
 */
const OVERFETCH_POSTFILTRO = 90;

/**
 * FILTROS DE NEGOCIOS — los seis de la spec, y de dónde sale cada uno.
 *
 * ── RESUELTOS EN SQL ────────────────────────────────────────────────────────
 *   · `q`           → `listings.search`, el índice FTS español de 0004;
 *   · `rubro`       → `attrs.category` (texto libre; el set curado vive en
 *                     ./categories.ts) — el "Categorías" de la spec;
 *   · `verificados` → `listings.store_verified`, el espejo público de
 *                     `business_accounts.verified_presence` (0039);
 *   · `cerca`       → `listings.area_label ILIKE %zona%`, con la zona que la
 *                     persona ya declaró en su perfil. Sin zona declarada el
 *                     control ni se ofrece: un filtro que no puede filtrar es
 *                     peor que no tenerlo.
 *
 * ── RESUELTOS EN MEMORIA, SOBRE UN COLCHÓN ──────────────────────────────────
 *   · `abiertos`     → `listing_hours` + `listing_hours_slots` (0093);
 *   · `calificacion` → `listing_review_stats` (0093);
 *   · `destacados`   → `trust_scores.level` del dueño.
 *
 * Los tres dependen de datos que la página YA trae en lote para pintar las
 * tarjetas, así que filtrarlos en memoria no cuesta ninguna consulta extra. Y
 * ninguno se puede expresar en SQL sin mandar una lista de ids en el
 * querystring: las lecturas de supabase-js son GET y Kong corta el request line
 * cerca de los 8 KB — el 414 que ya documentan `videos/queries.ts` y
 * `lib/profesionales/entity-posts.ts`. "Abierto ahora" además ni siquiera es
 * expresable: depende de la zona horaria de cada negocio y de tramos que pueden
 * cruzar la medianoche, cuentas que viven en `lib/horarios` y no en Postgres.
 *
 * EL TECHO, DICHO: con alguno de esos tres activo, el resultado sale de los
 * `OVERFETCH_POSTFILTRO` negocios más recientes que pasan los filtros de SQL. Es
 * un techo real y es el precio de no romper el querystring; con el volumen de
 * una comunidad (decenas a cientos de comercios) cubre el catálogo entero.
 *
 * ⚠️ NOTA PARA QUIEN LEA ESTO DESPUÉS: hasta el 2026-08 acá había un comentario
 * que decía que "Abierto ahora" y "Mejor calificados" NO se podían construir
 * porque ninguna tabla guardaba horarios ni reseñas de negocios. Eso dejó de ser
 * cierto con la migración 0093, que creó las cuatro tablas. El comentario
 * sobrevivió a la migración y se leía como un motivo vigente — se borró.
 */
interface Filters {
  q: string;
  rubro: string;
  verificados: boolean;
  cerca: boolean;
  abiertos: boolean;
  destacados: boolean;
  /** "" | "4" | "3" — puntaje promedio MÍNIMO. */
  calificacion: string;
}

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const calificacion = firstValue(sp.calificacion);
  return {
    q: sanitizeSearchQuery(firstValue(sp.q)),
    // Sin validar contra el set curado: `attrs.category` es texto libre y un
    // rubro fuera de la lista simplemente no devuelve filas.
    rubro: firstValue(sp.rubro).slice(0, 40),
    verificados: firstValue(sp.verificados) === "1",
    cerca: firstValue(sp.cerca) === "1",
    abiertos: firstValue(sp.abiertos) === "1",
    destacados: firstValue(sp.destacados) === "1",
    calificacion: calificacion === "4" || calificacion === "3" ? calificacion : "",
  };
}

function hayFiltros(filters: Filters): boolean {
  return Boolean(
    filters.q ||
      filters.rubro ||
      filters.verificados ||
      filters.cerca ||
      filters.abiertos ||
      filters.destacados ||
      filters.calificacion,
  );
}

/** Los que la base no puede responder sola. Ver el docblock de `Filters`. */
function hayPostFiltros(filters: Filters): boolean {
  return filters.abiertos || filters.destacados || Boolean(filters.calificacion);
}

const CATEGORY_OPTIONS: FilterOption[] = [
  { value: "", label: t("sections", "businessCategoryAny") },
  ...BUSINESS_CATEGORIES.map((option) => ({ value: option.value, label: option.label })),
];

const RATING_OPTIONS: FilterOption[] = [
  { value: "", label: COPY.filtroCalificacionCualquiera },
  { value: "4", label: COPY.filtroCalificacionCuatro },
  { value: "3", label: COPY.filtroCalificacionTres },
];

/**
 * La zona del perfil, lista para un `ILIKE`. `%` y `_` son comodines y `\` es el
 * escape: una zona escrita como "Corona %" tiene que buscar ese texto, no todo.
 * Se recorta además a 60 caracteres — un `area_label` es un barrio, no un ensayo.
 */
function paraIlike(areaLabel: string): string {
  return areaLabel.trim().slice(0, 60).replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Solo estas columnas de `trust_scores` alimentan el badge (over-fetch §perf). */
type OwnerTrustRow = Pick<Tables<"trust_scores">, "score" | "level" | "signals">;

/**
 * Trust Score del dueño → props del `PublisherTrust` canónico. Usa la fuente
 * única (@/lib/trust/signals): las mismas señales que ve el usuario en
 * vivienda, mensajes y profesionales. `identity_verified` viene del perfil
 * del dueño; `ownerId` es el `profileId` que habilita "Ver el perfil de…"
 * dentro del desglose (mismo patrón que negocios/[id]/page.tsx).
 */
function buildOwnerTrust(
  score: OwnerTrustRow | undefined,
  ownerId: string,
  ownerName: string,
  identityVerified: boolean,
): OwnerTrust | null {
  const props = toTrustProps(score ?? null, identityVerified);
  if (!props) return null;
  return { displayName: ownerName, firstName: firstNameOf(ownerName), profileId: ownerId, ...props };
}

export default async function NegociosPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const tab = parseBusinessTab(firstValue(sp.t));
  const filters = parseFilters(sp);
  const postsCursor = decodeCursor(firstValue(sp.pcursor) || undefined);
  const ofertasCursor = parseOfertasCursor(firstValue(sp.ocursor) || undefined);

  const tabItems: NavTabItem[] = BUSINESS_TAB_IDS.map((id) => ({
    id,
    label: BUSINESS_TAB_LABELS[id],
    href: businessTabHref(id),
  }));

  // Cabecera y burbuja de publicar son comunes a las tres pestañas, así que
  // viven ACÁ arriba (sync, sin Suspense): ni se duplican en cada fallback ni
  // parpadean al cambiar de pestaña. Streaming (§5.2): el contenido de cada
  // pestaña —que depende de la DB— llega por Suspense sin bloquear el resto.
  return (
    <>
      <SectionHeading
        accent={SECCION.accent}
        image={SECCION.image}
        title={COPY.titulo}
        subtitle={COPY.subtitulo}
      />

      {/* La burbuja de publicar, arriba de todo y antes de la lista (pedido
          textual del cliente 2026-07-27): publicar no se busca en ajustes. */}
      <SectionCta
        accent={SECCION.accent}
        href={SECCION.publicarHref}
        title={t("sections", "publishBusinessTitle")}
        hint={t("sections", "publishBusinessHint")}
        className="mt-3"
      />

      <NavTabs items={tabItems} active={tab} label={COPY.tabsLabel} className="mb-1 mt-5" />

      {tab === "publicaciones" ? (
        <Suspense
          key={postsCursor ? postsCursor.id : "publicaciones"}
          fallback={<ListaDePublicacionesSkeleton />}
        >
          <PublicacionesContent cursor={postsCursor} />
        </Suspense>
      ) : tab === "ofertas" ? (
        <Suspense
          key={ofertasCursor ? ofertasCursor.postId : "ofertas"}
          fallback={<ListaDePublicacionesSkeleton count={2} />}
        >
          <OfertasContent cursor={ofertasCursor} />
        </Suspense>
      ) : (
        <Suspense key={JSON.stringify(filters)} fallback={<DirectorioSkeleton />}>
          <NegociosContent filters={filters} />
        </Suspense>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Pestaña "Negocios": el directorio (datos reales con RLS del usuario)
// ---------------------------------------------------------------------------

async function NegociosContent({ filters }: { filters: Filters }) {
  // createClient() NO hace red (solo lee cookies): lo creamos primero y así
  // solapamos el round-trip a DB de getTenant() con el de Auth (getUser()).
  const supabase = await createClient();
  const [
    tenant,
    {
      data: { user },
    },
  ] = await Promise.all([getTenant(), supabase.auth.getUser()]);

  // La zona de quien mira se resuelve UNA vez y sirve para dos cosas: el filtro
  // "Cerca de mí" y el alcance geográfico de los impulsos (0092). Antes se
  // pedía después de la query principal; subirla acá la vuelve un dato del
  // request y no un paso más en la cadena.
  // "Tu zona": Negocios no tiene `?zona=` propio, así que acá la zona sale
  // siempre de la preferencia (cookie › perfil).
  const vistaZona = await resolverVistaZona(tenant.id, null);
  const viewer = await resolveViewerGeo(supabase, {
    tenantId: tenant.id,
    userId: user?.id ?? null,
    // La zona ELEGIDA pesa más que la del perfil para el alcance de los
    // impulsos, y `resolveViewerGeo` ya sabe caer al perfil cuando es `null`.
    zoneFilter: vistaZona.zona.label,
  });
  const zonaPropia = viewer.areaLabel?.trim() || null;
  /** ¿Manda "Tu zona" sobre este listado? */
  const filtraZona = vistaZona.areaLabels.length > 0;

  /**
   * "CERCA DE MÍ" DEJÓ DE SER UN CHIP QUE HAY QUE APRETAR.
   *
   * Con "Tu zona" activa el listado YA sale recortado a esa zona, y con mejor
   * criterio que el chip: el `.in()` usa el match laxo de `sameZoneLabel`
   * ("Corona" alcanza "Corona, Queens") y el chip un `ILIKE` que no lo hace.
   * Dejar los dos sería un botón que no cambia nada — justo lo que el propio
   * comentario del chip llama "un filtro que no puede filtrar".
   *
   * Vuelve a tener sentido en UN caso, y por eso no se borró: cuando la persona
   * eligió ver TODA la comunidad. Ahí el listado no está recortado y el chip es
   * la forma de acotar sólo esta pantalla a su barrio, sin abandonar la vista
   * amplia en el resto de la app.
   */
  const cercaActivo = !filtraZona && filters.cerca && Boolean(zonaPropia);

  const LISTING_COLUMNS =
    "id, title, description, area_label, attrs, photos, publisher_name, created_by, published_at, created_at, store_verified, tier, cta_phone, cta_address";

  const postFiltrando = hayPostFiltros(filters);
  const limite = postFiltrando ? OVERFETCH_POSTFILTRO : PAGE_SIZE;

  let query = supabase
    .from("listings")
    .select(LISTING_COLUMNS)
    .eq("tenant_id", tenant.id)
    .eq("kind", "business")
    .eq("status", "published");

  if (filters.q) {
    // Mismo índice FTS que /propiedades y /marketplace (listings.search, 0004).
    query = query.textSearch("search", filters.q, { type: "websearch", config: "spanish" });
  }
  // `attrs->>category` y no `attrs->category`: `->>` devuelve TEXTO, que es lo
  // que se compara. Con `->` la comparación sería contra un json y `"belleza"`
  // (con comillas) nunca sería igual a `belleza`.
  if (filters.rubro) query = query.eq("attrs->>category", filters.rubro);
  if (filters.verificados) query = query.eq("store_verified", true);
  if (cercaActivo && zonaPropia) {
    query = query.ilike("area_label", `%${paraIlike(zonaPropia)}%`);
  } else if (filtraZona) {
    query = query.in("area_label", vistaZona.areaLabels);
  }

  const { data: negocios } = await query
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limite);

  const rows = negocios ?? [];
  const filtering = hayFiltros(filters);

  // -------------------------------------------------------------------------
  // Boost (§7): mismo patrón que /propiedades — los negocios con boost activo
  // van primero, SIEMPRE con el chip "Patrocinado" (misma palabra que
  // vivienda/feed/reel; una divulgación que cambia de nombre según la pantalla
  // deja de leerse como divulgación). A diferencia de vivienda, negocios no
  // pagina por cursor, así que el boost corre siempre y no solo "en la primera
  // página". Pagar visibilidad no toca Trust Score ni `store_verified`.
  // -------------------------------------------------------------------------
  //
  // ALCANCE GEOGRÁFICO (0092): un impulso `local` sólo ocupa lugar para quien
  // está en su zona; `nacional` y `global`, para toda la comunidad.
  let boostedExtra: typeof rows = [];
  // "Tu zona" es un recorte aunque no esté en la URL: con una zona puesta no se
  // inyectan impulsados de otros barrios en una pantalla que dice el nombre de
  // un barrio.
  const sinFiltros = !filtering && !filtraZona;

  const placement = await selectOwnBoosts(supabase, { tenantId: tenant.id, viewer });
  const boostedIds = placement.listingIds;
  // Se sirvieron: se cuentan (0092). Best-effort y ruidoso ante la falla.
  await recordBoostImpressions(placement.boostIds);

  // Impulsados que no entraron en la query principal: solo se inyectan en la
  // vista SIN filtros — con filtros activos jamás se cuela un resultado que no
  // matchea (un negocio patrocinado de otro rubro, o cerrado cuando se pidió
  // "abiertos ahora", no entra).
  const missingIds = [...boostedIds].filter((id) => !rows.some((row) => row.id === id));
  if (sinFiltros && missingIds.length > 0) {
    const { data: extra } = await supabase
      .from("listings")
      .select(LISTING_COLUMNS)
      .eq("tenant_id", tenant.id)
      .eq("kind", "business")
      .eq("status", "published")
      .in("id", missingIds);
    boostedExtra = extra ?? [];
  }

  // Boosted-first estable: impulsados arriba, el resto en su orden natural.
  const orderedRows = [
    ...boostedExtra,
    ...rows.filter((row) => boostedIds.has(row.id)),
    ...rows.filter((row) => !boostedIds.has(row.id)),
  ];

  // -------------------------------------------------------------------------
  // TODO lo que la tarjeta necesita, EN LOTE. Cuatro consultas para N negocios,
  // nunca cuatro por negocio: dueños + Trust Score, calificaciones y horarios.
  // -------------------------------------------------------------------------
  const listingIds = orderedRows.map((row) => row.id);
  const ownerIds = Array.from(
    new Set(orderedRows.map((row) => row.created_by).filter((id): id is string => Boolean(id))),
  );

  const [scoresResult, ownersResult, ratings, horarios] = await Promise.all([
    ownerIds.length > 0
      ? supabase
          .from("trust_scores")
          .select("profile_id, score, level, signals")
          .in("profile_id", ownerIds)
      : Promise.resolve({ data: [] as null | { profile_id: string }[] }),
    ownerIds.length > 0
      ? supabase.from("profiles").select("id, display_name, identity_verified").in("id", ownerIds)
      : Promise.resolve({ data: [] as null | { id: string }[] }),
    // Calificaciones: `listing_review_stats` (0093), UN `.in(...)` para toda la
    // página. La función es la del módulo hermano de Profesionales — la lectura
    // es idéntica y duplicarla habría sido tener dos versiones del mismo `.in()`.
    fetchListingRatings(supabase, listingIds),
    // Horarios: dos consultas por lote (cabecera + tramos), nunca dos por card.
    fetchHorariosDeNegocios(supabase, listingIds),
  ]);

  const trustByOwner = new Map<string, OwnerTrustRow>();
  const nameByOwner = new Map<string, string>();
  const verifiedByOwner = new Map<string, boolean>();
  const levelByOwner = new Map<string, string | null>();
  for (const score of (scoresResult.data ?? []) as Array<
    OwnerTrustRow & { profile_id: string }
  >) {
    trustByOwner.set(score.profile_id, score);
    levelByOwner.set(score.profile_id, (score.level as string | null) ?? null);
  }
  for (const owner of (ownersResult.data ?? []) as Array<{
    id: string;
    display_name: string;
    identity_verified: boolean | null;
  }>) {
    nameByOwner.set(owner.id, owner.display_name);
    verifiedByOwner.set(owner.id, owner.identity_verified ?? false);
  }

  // El instante es UNO para toda la página: con `new Date()` por tarjeta, dos
  // negocios con el mismo horario podrían quedar uno "abierto" y otro "cerrado"
  // por el milisegundo en que se los evaluó.
  const ahora = new Date();
  const aperturas = estadosDeApertura(horarios, ahora);

  // -------------------------------------------------------------------------
  // Los tres filtros que la base no puede responder (ver `Filters`).
  // -------------------------------------------------------------------------
  const minimoPuntaje = filters.calificacion ? Number(filters.calificacion) : null;
  const visibles = orderedRows
    .filter((row) => {
      if (filters.abiertos && !estaAbiertoAhora(aperturas.get(row.id))) return false;
      if (minimoPuntaje !== null) {
        const resumen = ratings.get(row.id);
        // Sin reseñas NO entra en "4 estrellas o más": no se sabe nada de ese
        // negocio, que es distinto de que esté bien puntuado.
        if (!resumen || resumen.cantidad === 0 || (resumen.promedio ?? 0) < minimoPuntaje) {
          return false;
        }
      }
      if (filters.destacados) {
        const level = row.created_by ? levelByOwner.get(row.created_by) : null;
        if (level !== "destacado") return false;
      }
      return true;
    })
    .slice(0, PAGE_SIZE);

  return (
    <>
      {/* Buscador y filtros ARRIBA de los dos banners: los banners son
          promoción y el buscador es la tarea. Quien entra a /negocios busca un
          negocio; enterrarle el campo debajo de dos tarjetas de venta es
          hacerle scrollear para llegar a lo que vino a hacer. */}
      <div className="mt-4 flex flex-col gap-3">
        <ModuleSearchBar
          label={t("sections", "searchBusinessLabel")}
          placeholder={t("sections", "searchBusinessPlaceholder")}
        />
        <div className="flex gap-2">
          <ModuleFilterSelect
            param="rubro"
            label={t("sections", "businessCategoryLabel")}
            options={CATEGORY_OPTIONS}
            className="flex-1"
          />
          <ModuleFilterSelect
            param="calificacion"
            label={COPY.filtroCalificacionLabel}
            options={RATING_OPTIONS}
            className="flex-1"
          />
        </div>
        {/* Los cuatro sí/no en una fila que se desliza. A 375px no entran los
            cuatro a la vez y colapsarlos en un "Más" escondería justo lo que el
            cliente pidió ver. El scroll es HORIZONTAL y local a esta fila: la
            página nunca se mueve de costado (§5). */}
        <div
          role="group"
          aria-label={COPY.filtrosLabel}
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]"
        >
          {/* Sin zona declarada NO se dibuja: un filtro que no puede filtrar es
              un botón que no hace nada. Quien quiera usarlo la carga en su
              perfil, que es donde vive el dato. */}
          {zonaPropia && !filtraZona && (
            <ModuleFilterToggle
              param="cerca"
              label={COPY.filtroCerca}
              icon={<MapPinLine />}
            />
          )}
          <ModuleFilterToggle
            param="verificados"
            label={t("sections", "businessVerifiedFilter")}
            icon={<SealCheck weight="fill" />}
          />
          <ModuleFilterToggle param="abiertos" label={COPY.filtroAbiertos} icon={<Clock />} />
          <ModuleFilterToggle
            param="destacados"
            label={COPY.filtroReputacion}
            icon={<Trophy />}
          />
        </div>
        {/* La nota aparece SOLO con el filtro puesto, y dice exactamente qué
            ordena. "Destacado" es el nivel más alto del Trust Score —reputación
            ganada— y la app nunca lo usa para pauta: lo pago se llama
            "Patrocinado" y se marca en la tarjeta. Sin esta línea, "destacados"
            se lee como "los que pagaron". */}
        {filters.destacados && (
          <p className="text-xs leading-relaxed text-foreground-muted">
            {COPY.filtroReputacionNota}
          </p>
        )}
        {cercaActivo && zonaPropia && (
          <p className="text-xs leading-relaxed text-foreground-muted">
            {COPY.filtroCercaNota(zonaPropia)}
          </p>
        )}
      </div>

      {/* Banner premium para dueños de negocio → Presencia Verificada (§7) */}
      <BezelCard variant="featured" className="mt-4" coreClassName="flex flex-col gap-3 p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-ink"
          >
            <Storefront size={22} weight="light" />
          </span>
          <div className="min-w-0">
            <p className="font-display text-base font-semibold text-foreground">
              {COPY.bannerTitulo}
            </p>
            <p className="mt-0.5 text-sm text-foreground-secondary">{COPY.bannerTexto}</p>
          </div>
        </div>
        <Link
          href="/negocios/presencia"
          className={cn(buttonVariants({ variant: "primary", size: "sm" }), "self-start")}
        >
          {COPY.bannerCta}
        </Link>
      </BezelCard>

      {/* Entrada al Copiloto de Negocios (módulo MATCHING+COPILOTO) — solo logueados */}
      {user && (
        <BezelCard className="mt-4" coreClassName="flex flex-col gap-3 p-5">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-ink"
            >
              <MagicWand size={22} weight="light" />
            </span>
            <div className="min-w-0">
              <p className="font-display text-base font-semibold text-foreground">
                {COPY.copilotoTitulo}
              </p>
              <p className="mt-0.5 text-sm text-foreground-secondary">{COPY.copilotoTexto}</p>
            </div>
          </div>
          <Link
            href="/negocios/copiloto"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}
          >
            {COPY.copilotoCta}
          </Link>
        </BezelCard>
      )}

      {/* Impulsos con alcance nacional/global comprados en OTRAS comunidades
          (0092). Sólo sin filtros: la publicidad no desplaza lo que se buscó.
          Si no hay ninguno, el componente no renderiza nada. */}
      {sinFiltros && <ImpulsosDeOtrasComunidades className="mt-6" kind="business" />}

      {visibles.length === 0 ? (
        // Vacío por "Tu zona" y sin ningún filtro puesto: se nombra la zona y se
        // ofrece volver a toda la comunidad en un toque.
        !filtering && filtraZona && vistaZona.zona.label ? (
          <ZonaVacia className="mt-4" zona={vistaZona.zona.label} />
        ) : filtering ? (
          /* Buscó y no hay ⇒ mensaje de búsqueda, no el de sección vacía. Decir
             "todavía no hay negocios publicados" cuando en realidad hay pero
             ninguno matchea es información falsa sobre la comunidad. */
          <EmptyState
            className="mt-4"
            illustration="/images/empty-state-search.png"
            title={t("sections", "moduleNoMatchTitle")}
            message={t("sections", "moduleNoMatchMessage")}
            action={
              <Link
                href="/negocios"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {t("sections", "moduleClearFilters")}
              </Link>
            }
          />
        ) : (
          <EmptyState
            className="mt-4"
            illustration="/images/empty-state-search.png"
            title={COPY.vacioTitulo}
            message={COPY.vacioMensaje}
            action={
              <Link
                href="/negocios/presencia"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {COPY.vacioCta}
              </Link>
            }
          />
        )
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          {visibles.map((negocio) => {
            const ownerName = negocio.created_by
              ? (nameByOwner.get(negocio.created_by) ?? negocio.publisher_name ?? "")
              : "";
            const ownerTrust = negocio.created_by
              ? buildOwnerTrust(
                  trustByOwner.get(negocio.created_by),
                  negocio.created_by,
                  ownerName,
                  verifiedByOwner.get(negocio.created_by) ?? false,
                )
              : null;

            // "Llamar" y "Cómo llegar" pasan por los MISMOS dos filtros que en
            // la ficha: plan con botones habilitados (son una feature paga de la
            // 0048) y valor cargado y saneado. Sin los dos, el botón no existe —
            // ni gris, ni con candado, ni vendiendo.
            const acciones: AccionRapida[] = [];
            if (canUseActionButtons(negocio.tier)) {
              const telefono = ctaHref("phone", negocio.cta_phone);
              if (telefono) {
                acciones.push({ kind: "phone", href: telefono.href, display: telefono.display });
              }
              const direccion = ctaHref("directions", negocio.cta_address);
              if (direccion) {
                acciones.push({
                  kind: "directions",
                  href: direccion.href,
                  display: direccion.display,
                });
              }
            }

            const business: BusinessCardModel = {
              id: negocio.id,
              title: negocio.title,
              description: negocio.description,
              categoryLabel: businessCategoryLabel(businessCategoryOf(negocio.attrs)),
              areaLabel: negocio.area_label,
              photoUrl: firstPhotoUrl(negocio.photos),
              // Tocar la foto abre el visor con todas; "Ver negocio" sigue
              // abriendo la ficha (feedback 2026-07-26).
              photos: allPhotoUrls(negocio.photos),
              ownerTrust,
              publisherName: negocio.publisher_name,
              storeVerified: negocio.store_verified,
              // Sin fila en `listing_review_stats` = todavía nadie opinó. Se
              // pasa `promedio: null`, NUNCA un 0: "sin reseñas" y "mal
              // puntuado" no son lo mismo y la tarjeta los dice distinto.
              rating: ratings.get(negocio.id) ?? SIN_RESENAS,
              apertura: aperturas.get(negocio.id) ?? null,
              acciones,
              puedeRecibirMensajes: Boolean(
                negocio.created_by && negocio.created_by !== user?.id,
              ),
              isLoggedIn: Boolean(user),
            };

            return boostedIds.has(business.id) ? (
              // Contorno dorado + chip FTC — mismo patrón que /propiedades
              // (feedback cliente Geovanny, 2026-08-05: "todo el contorno" en
              // dorado). El anillo rodea la BusinessCard completa (su Double-
              // Bezel queda intacto adentro); el chip flota sobre la foto,
              // igual que el sello "Presencia verificada" que ya vive ahí.
              <div
                key={business.id}
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
                <BusinessCard business={business} />
              </div>
            ) : (
              <BusinessCard key={business.id} business={business} />
            );
          })}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Pestaña "Publicaciones": el newsfeed comercial
// ---------------------------------------------------------------------------

async function PublicacionesContent({
  cursor,
}: {
  cursor: { createdAt: string; id: string } | null;
}) {
  const supabase = await createClient();
  const [
    tenant,
    {
      data: { user },
    },
  ] = await Promise.all([getTenant(), supabase.auth.getUser()]);

  const page = await fetchBusinessPostsPage(supabase, {
    tenantId: tenant.id,
    viewerId: user?.id ?? null,
    cursor,
  });

  return (
    <PublicacionesPanel
      className="mt-6"
      posts={page.items}
      tenantId={tenant.id}
      viewerId={user?.id ?? null}
      nextHref={page.nextCursor ? `/negocios?t=publicaciones&pcursor=${page.nextCursor}` : null}
    />
  );
}

// ---------------------------------------------------------------------------
// Pestaña "Ofertas": `post_offers ⋈ posts` (0106)
// ---------------------------------------------------------------------------

async function OfertasContent({
  cursor,
}: {
  cursor: { expiresAt: string; postId: string } | null;
}) {
  const supabase = await createClient();
  const [
    tenant,
    {
      data: { user },
    },
  ] = await Promise.all([getTenant(), supabase.auth.getUser()]);

  const page = await fetchOfertasVigentes(supabase, {
    tenantId: tenant.id,
    ahora: new Date(),
    cursor,
  });

  // Qué ya guardó quien mira: UNA consulta para toda la página, con los ids que
  // ya están en memoria. Sin esto, cada botón "Guardar" nacería en "no guardada"
  // aunque la persona la hubiera guardado ayer desde el feed.
  const guardadas = new Set<string>();
  if (user && page.items.length > 0) {
    const { data } = await supabase
      .from("saves")
      .select("subject_id")
      .eq("profile_id", user.id)
      .eq("subject_kind", "post")
      .in(
        "subject_id",
        page.items.map((oferta) => oferta.postId),
      );
    for (const fila of data ?? []) guardadas.add(fila.subject_id);
  }

  return (
    <OfertasPanel
      className="mt-6"
      ofertas={page.items}
      viewerId={user?.id ?? null}
      guardadas={guardadas}
      nextHref={
        page.nextCursor
          ? `/negocios?t=ofertas&ocursor=${encodeURIComponent(encodeOfertasCursor(page.nextCursor))}`
          : null
      }
    />
  );
}
