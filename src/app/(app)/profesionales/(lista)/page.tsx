import { Suspense } from "react";
import Link from "next/link";
import { CaretDown, Megaphone } from "@phosphor-icons/react/dist/ssr";
import {
  Chip,
  EmptyState,
  NavTabs,
  SectionCta,
  SectionHeading,
  Skeleton,
  buttonVariants,
  type NavTabItem,
} from "@/components/ui";
import {
  allPhotoUrls,
  buildTrustSignals,
  decodeCursor,
  encodeCursor,
  firstPhotoUrl,
  toTrustLevel,
  type PublisherView,
  type VerificationView,
} from "@/components/listings";
import {
  COPY,
  PROFESSIONAL_CATEGORIES,
  ProfessionalCard,
  ProfessionalListSkeleton,
  ProfessionalPostsPanel,
  isProfessionalCategory,
  parseProfessionalAttrs,
  type ProfessionalCardModel,
} from "@/components/directory";
import { PostCardSkeleton } from "@/components/feed";
import {
  ModuleFilterChips,
  ModuleSearchBar,
  sanitizeSearchQuery,
  type FilterOption,
} from "@/components/search";
import { ImpulsosDeOtrasComunidades } from "@/components/boosts";
import {
  recordBoostImpressions,
  resolveViewerGeo,
  selectOwnBoosts,
} from "@/lib/boosts/select";
import { fetchProfessionalPostsPage } from "@/lib/profesionales/entity-posts";
import { fetchLanguagesByProfile } from "@/lib/profesionales/languages";
import { fetchListingRatings } from "@/lib/profesionales/ratings";
import { fetchVerifiedProfessionalListingIds } from "@/lib/profesionales/verified-listings";
import { t } from "@/lib/i18n";
import { createClient, getAuthUserId } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { getViewerFormatDate } from "@/lib/time/viewer-zone";
import { ZonaVacia } from "@/components/zona";
import { resolverVistaZona } from "@/lib/zona/server";
import { cn } from "@/lib/utils";
import {
  PROFESSIONALS_TAB_IDS,
  PROFESSIONALS_TAB_LABELS,
  parseProfessionalsTab,
  professionalsTabHref,
} from "../professional-tabs";

export const metadata = { title: "Profesionales" };

const PAGE_SIZE = 12;
const C = COPY.professionals;

/**
 * Copy NUEVO de esta pantalla (pestañas + filtro de verificados). Vive ACÁ y no
 * en `components/directory/copy.ts` a propósito: ese archivo es compartido con
 * Eventos y hay otra sesión tocándolo en paralelo — "un solo dueño por
 * archivo", mismo criterio que ya usa `listings/inline-message-cta.tsx`.
 */
const LOCAL = {
  tabsLabel: "Secciones de Profesionales",
  verifiedFilterLabel: "Filtrar por verificación",
  verifiedFilterAll: "Todos",
  verifiedFilterOnly: "Verificados",
} as const;

/**
 * TODO(integración): "Buscar profesionales" / placeholder deberían vivir en
 * `src/lib/i18n/es/sections.ts` junto a `searchBusinessLabel`/`searchEventsLabel`
 * (mismo patrón, mismo namespace `sections`). Ese archivo es el kit de copy de
 * búsqueda compartido por Negocios/Eventos/Colaboraciones y este módulo no lo
 * posee — se define acá en vez de tocar un archivo ajeno mientras hay otras
 * sesiones trabajando en paralelo (relevo). Mover cuando alguien posea ese
 * archivo y confirme que no pisa nada.
 */
const SEARCH_LABEL = "Buscar profesionales";
const SEARCH_PLACEHOLDER = "Buscá un profesional o un rubro…";

/** Acento + ícono 3D de la sección (los mismos del menú y de /buscar). */
const SECCION = {
  accent: "var(--accent-profesionales)",
  image: "/icons/menu/profesionales.webp",
  publicarHref: "/publicar?kind=professional",
} as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

interface Filters {
  q: string;
  rubro: string;
  cursor: string;
  /** "Verificados" (filtro nuevo): sólo fichas con credencial found_active. */
  verificado: boolean;
}

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const rubroRaw = firstValue(sp.rubro).slice(0, 40);
  return {
    q: sanitizeSearchQuery(firstValue(sp.q)),
    rubro: isProfessionalCategory(rubroRaw) ? rubroRaw : "",
    cursor: firstValue(sp.cursor),
    verificado: firstValue(sp.verificado) === "si",
  };
}

const CATEGORY_OPTIONS: FilterOption[] = [
  { value: "", label: C.allCategories },
  ...PROFESSIONAL_CATEGORIES.map((option) => ({ value: option.value, label: option.label })),
];

const VERIFIED_OPTIONS: FilterOption[] = [
  { value: "", label: LOCAL.verifiedFilterAll },
  { value: "si", label: LOCAL.verifiedFilterOnly },
];

export default async function ProfesionalesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const tab = parseProfessionalsTab(firstValue(sp.t));
  const filters = parseFilters(sp);
  const postsCursor = decodeCursor(firstValue(sp.pcursor) || undefined);

  const tabItems: NavTabItem[] = PROFESSIONALS_TAB_IDS.map((id) => ({
    id,
    label: PROFESSIONALS_TAB_LABELS[id],
    href: professionalsTabHref(id),
  }));

  return (
    <>
      {/* Cabecera + CTA de publicar: comunes a las dos pestañas, así que viven
          ACÁ arriba (sync, sin Suspense) — ni se duplican en cada fallback ni
          parpadean al cambiar de pestaña. */}
      <SectionHeading
        accent={SECCION.accent}
        image={SECCION.image}
        title={C.title}
        subtitle={C.subtitle}
      />
      <SectionCta
        accent={SECCION.accent}
        href={SECCION.publicarHref}
        title={t("sections", "publishProfessionalTitle")}
        hint={t("sections", "publishProfessionalHint")}
        className="mt-3"
      />

      <NavTabs items={tabItems} active={tab} label={LOCAL.tabsLabel} className="mb-1 mt-5" />

      {tab === "publicaciones" ? (
        <Suspense key={postsCursor ? postsCursor.id : "publicaciones"} fallback={<PublicacionesSkeleton />}>
          <PublicacionesContent cursor={postsCursor} />
        </Suspense>
      ) : (
        <Suspense key={JSON.stringify(filters)} fallback={<DirectorioSkeleton />}>
          <ProfesionalesContent filters={filters} />
        </Suspense>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Pestaña "Profesionales": el directorio (datos reales con RLS del usuario)
// ---------------------------------------------------------------------------

async function ProfesionalesContent({ filters }: { filters: Filters }) {
  const [tenant, supabase, authUserId] = await Promise.all([
    getTenant(),
    createClient(),
    getAuthUserId(),
  ]);
  const isLoggedIn = Boolean(authUserId);

  // Filtro "Verificados" (spec cliente): fichas con verification_check
  // found_active vigente. Se resuelve ANTES de la query principal para poder
  // acotarla con `.in("id", …)` — server-side de verdad, nunca "traer todo y
  // filtrar en memoria".
  // "Tu zona": Profesionales no tiene filtro de zona propio en la URL, así que
  // acá manda siempre la preferencia (cookie › perfil).
  const vistaZona = await resolverVistaZona(tenant.id, null);

  let verifiedListingIds: string[] | null = null;
  if (filters.verificado) {
    verifiedListingIds = await fetchVerifiedProfessionalListingIds(supabase, tenant.id);
  }

  // -------------------------------------------------------------------------
  // Query principal: keyset pagination (created_at,id), filtro por rubro
  // -------------------------------------------------------------------------
  let query = supabase
    .from("listings")
    .select("id, title, area_label, attrs, photos, created_by, publisher_name, created_at")
    .eq("tenant_id", tenant.id)
    .eq("kind", "professional")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (filters.q) {
    // Mismo índice FTS que /negocios y /propiedades (listings.search, 0004);
    // `kind: professional` ya está indexado ahí (confirmado en 0044 de
    // global_search), así que no hace falta tocar la migración.
    query = query.textSearch("search", filters.q, { type: "websearch", config: "spanish" });
  }
  if (filters.rubro) {
    query = query.eq("attrs->>category", filters.rubro);
  }
  if (verifiedListingIds) {
    query = query.in("id", verifiedListingIds);
  }
  if (vistaZona.areaLabels.length > 0) {
    // Etiquetas exactas ya resueltas contra el catálogo de la comunidad: el
    // recorte lo hace SQL y la paginación por cursor sigue intacta.
    query = query.in("area_label", vistaZona.areaLabels);
  }
  const cursor = decodeCursor(filters.cursor || undefined);
  if (cursor) {
    query = query.or(
      `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt."${cursor.id}")`,
    );
  }

  // Filtro "Verificados" activo y sin NINGUNA ficha verificada: cortocircuito
  // sin pegarle a la base (mismo criterio defensivo que fetchViewerLikes/
  // fetchBlockedIds en feed/queries.ts — nunca un `.in(...)` sabiendo que va
  // a estar vacío).
  const skipQuery = verifiedListingIds !== null && verifiedListingIds.length === 0;
  let rows: Awaited<typeof query>["data"];
  let error: Awaited<typeof query>["error"];
  if (skipQuery) {
    rows = [];
    error = null;
  } else {
    ({ data: rows, error } = await query);
  }
  if (error) {
    console.warn("[directorios] query de profesionales falló", { code: error.code });
  }

  const pageRows = (rows ?? []).slice(0, PAGE_SIZE);
  const hasMore = (rows ?? []).length > PAGE_SIZE;

  // -------------------------------------------------------------------------
  // Boost (§7): los avisos pagos van primero, SOLO en la primera página (sin
  // cursor). Clonado tal cual del bloque de /propiedades — mismo idioma FTC
  // ("Patrocinado"), mismo anillo dorado, misma regla de que lo patrocinado
  // respeta los filtros activos (rubro/búsqueda/verificados): `boostedExtra`
  // sólo se inyecta cuando NO hay ningún filtro puesto.
  // -------------------------------------------------------------------------
  //
  // ALCANCE GEOGRÁFICO (0092): un impulso `local` sólo ocupa lugar para quien
  // está en su zona; `nacional` y `global`, para toda la comunidad. La regla
  // vive UNA vez en `src/lib/boosts`, no copiada en cada listado.
  let boostedIds = new Set<string>();
  let boostedExtra: typeof pageRows = [];
  const sinFiltrosPropios = !filters.q && !filters.rubro && !filters.verificado;
  // "Tu zona" recorta aunque no esté en la URL: no se inyecta un impulsado de
  // otro barrio adentro de una pantalla que dice el nombre de un barrio.
  const sinFiltros = sinFiltrosPropios && !vistaZona.filtraPorPreferencia;
  if (!cursor) {
    const viewer = await resolveViewerGeo(supabase, {
      tenantId: tenant.id,
      userId: authUserId,
      // La zona elegida en el header pesa más que la del perfil (0092).
      zoneFilter: vistaZona.zona.label,
    });
    const placement = await selectOwnBoosts(supabase, { tenantId: tenant.id, viewer });
    boostedIds = placement.listingIds;
    // Se sirvieron: se cuentan (0092). Best-effort y ruidoso ante la falla.
    await recordBoostImpressions(placement.boostIds);

    // Destacados que no entraron por fecha: solo en la vista sin filtros
    // (con filtros activos jamás se inyecta un resultado que no matchea).
    const missingIds = [...boostedIds].filter(
      (id) => !pageRows.some((row) => row.id === id),
    );
    if (sinFiltros && missingIds.length > 0) {
      const { data: extra } = await supabase
        .from("listings")
        .select("id, title, area_label, attrs, photos, created_by, publisher_name, created_at")
        .eq("tenant_id", tenant.id)
        .eq("kind", "professional")
        .eq("status", "published")
        .in("id", missingIds);
      boostedExtra = extra ?? [];
    }
  }

  // Boosted-first estable: destacados arriba, el resto en su orden natural.
  const orderedRows = [
    ...boostedExtra,
    ...pageRows.filter((row) => boostedIds.has(row.id)),
    ...pageRows.filter((row) => !boostedIds.has(row.id)),
  ];

  // -------------------------------------------------------------------------
  // Batch: verificaciones found_active (regla estricta — misma que vivienda)
  //        + perfiles y trust scores de los publicadores con cuenta
  //        + idiomas (profile_card, por publicador único) y calificaciones
  //        (listing_review_stats, por ficha) — spec cliente.
  // -------------------------------------------------------------------------
  const listingIds = orderedRows.map((row) => row.id);
  const publisherIds = [
    ...new Set(orderedRows.map((row) => row.created_by).filter((id): id is string => Boolean(id))),
  ];

  const [checksResult, profilesResult, trustResult, languagesByProfile, ratingsByListing] =
    await Promise.all([
      listingIds.length > 0
        ? supabase
            .from("verification_checks")
            .select("subject_id, result, registry, registry_url, license_number, checked_at")
            .eq("tenant_id", tenant.id)
            .eq("subject_kind", "listing")
            .in("subject_id", listingIds)
            .order("checked_at", { ascending: false })
        : Promise.resolve({ data: [] as never[] }),
      publisherIds.length > 0
        ? supabase
            .from("profiles")
            .select("id, display_name, avatar_url, identity_verified")
            .in("id", publisherIds)
        : Promise.resolve({ data: [] as never[] }),
      publisherIds.length > 0
        ? supabase
            .from("trust_scores")
            .select("profile_id, score, level, signals")
            .in("profile_id", publisherIds)
        : Promise.resolve({ data: [] as never[] }),
      fetchLanguagesByProfile(supabase, publisherIds),
      fetchListingRatings(supabase, listingIds),
    ]);

  // Sólo el check MÁS RECIENTE por sujeto decide (viene ordenado checked_at desc).
  // Un found_active viejo NO debe pisar a un expired/mismatch posterior: mostramos
  // el sello únicamente si ese último check es found_active.
  /**
   * `verification_checks.checked_at` es `timestamptz` (0005), o sea un INSTANTE:
   * el momento en que se consultó el registro oficial. Formatearlo en la zona
   * fija de la comunidad fecha la verificación un día antes para quien mira
   * desde la costa oeste. Va con el reloj de quien lee.
   */
  const formatDate = await getViewerFormatDate();
  const verificationByListing = new Map<string, VerificationView>();
  const latestCheckSeen = new Set<string>();
  for (const check of checksResult.data ?? []) {
    if (!check.subject_id || latestCheckSeen.has(check.subject_id)) continue;
    latestCheckSeen.add(check.subject_id);
    if (check.result !== "found_active") continue;
    verificationByListing.set(check.subject_id, {
      registry: check.registry,
      registryUrl: check.registry_url,
      licenseNumber: check.license_number,
      dateLabel: formatDate(check.checked_at, { locale: tenant.locale, style: "long" }),
    });
  }

  const profileById = new Map((profilesResult.data ?? []).map((p) => [p.id, p]));
  const trustById = new Map((trustResult.data ?? []).map((t) => [t.profile_id, t]));

  const cards: ProfessionalCardModel[] = orderedRows.map((row) => {
    let publisher: PublisherView = null;
    let identityVerified = false;
    if (row.created_by) {
      const profile = profileById.get(row.created_by);
      const trust = trustById.get(row.created_by);
      identityVerified = profile?.identity_verified ?? false;
      publisher = {
        type: "member",
        profileId: row.created_by,
        displayName: profile?.display_name ?? C.communityMember,
        avatarUrl: profile?.avatar_url ?? null,
        score: trust?.score ?? 0,
        level: toTrustLevel(trust?.level),
        signals: buildTrustSignals(trust?.signals ?? {}, identityVerified),
      };
    } else if (row.publisher_name) {
      publisher = { type: "external", name: row.publisher_name };
    }

    const attrs = parseProfessionalAttrs(row.attrs);
    return {
      id: row.id,
      title: row.title,
      category: attrs.category,
      credentials: attrs.credentials,
      areaLabel: row.area_label,
      photoUrl: firstPhotoUrl(row.photos),
      // Portfolio completo: tocar la foto abre el visor, no el perfil.
      photos: allPhotoUrls(row.photos),
      verification: verificationByListing.get(row.id) ?? null,
      identityVerified,
      languages: row.created_by ? (languagesByProfile.get(row.created_by) ?? []) : [],
      rating: ratingsByListing.get(row.id) ?? { promedio: null, cantidad: 0 },
      publisher,
    };
  });

  const lastRow = pageRows[pageRows.length - 1];
  const nextParams = new URLSearchParams();
  if (filters.q) nextParams.set("q", filters.q);
  if (filters.rubro) nextParams.set("rubro", filters.rubro);
  if (filters.verificado) nextParams.set("verificado", "si");
  if (hasMore && lastRow) nextParams.set("cursor", encodeCursor(lastRow.created_at, lastRow.id));

  // Búsqueda "y no hay" ⇒ mensaje de búsqueda, no el de sección vacía. Decir
  // "todavía no hay profesionales" cuando en realidad hay pero ninguno
  // matchea el rubro/la búsqueda/el filtro es información falsa sobre la
  // comunidad (mismo criterio que /negocios).
  const filtering = Boolean(filters.q || filters.rubro || filters.verificado);

  return (
    <>
      {/* Buscador + chips de rubro y de verificación, mismo patrón que
          /negocios: la tarea (buscar un profesional) va arriba, antes de
          cualquier promoción. */}
      <div className="mb-5 mt-4 flex flex-col gap-3">
        <ModuleSearchBar label={SEARCH_LABEL} placeholder={SEARCH_PLACEHOLDER} />
        <ModuleFilterChips
          param="rubro"
          label={C.categoryFilterLabel}
          options={CATEGORY_OPTIONS}
        />
        <ModuleFilterChips
          param="verificado"
          label={LOCAL.verifiedFilterLabel}
          options={VERIFIED_OPTIONS}
        />
      </div>

      {/* Impulsos con alcance nacional/global comprados en OTRAS comunidades
          (0092). Sólo en la primera página y sin filtros: la publicidad no
          desplaza lo que alguien buscó. Sin resultados no renderiza nada. */}
      {!cursor && sinFiltros && <ImpulsosDeOtrasComunidades kind="professional" />}

      {cards.length === 0 ? (
        // Vacío por "Tu zona" y sin ningún filtro puesto: el cartel nombra la
        // zona y ofrece volver a toda la comunidad en un toque.
        !filtering && vistaZona.filtraPorPreferencia && vistaZona.zona.label ? (
          <ZonaVacia zona={vistaZona.zona.label} />
        ) : filtering ? (
          <EmptyState
            illustration="/images/empty-state-search.png"
            title={t("sections", "moduleNoMatchTitle")}
            message={t("sections", "moduleNoMatchMessage")}
            action={
              <Link
                href="/profesionales"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {t("sections", "moduleClearFilters")}
              </Link>
            }
          />
        ) : (
          <EmptyState
            illustration="/images/empty-state-search.png"
            title={C.emptyTitle}
            message={C.emptyMessage}
            action={
              // El MISMO destino que el CTA de arriba: `?kind=professional` deja el
              // formulario abierto en Profesionales (publicar/page.tsx lo honra).
              // Sin el parámetro, quien llega desde el estado vacío aterriza en un
              // selector de tipo y tiene que volver a elegir lo que ya eligió.
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
        <div className="flex flex-col gap-4">
          {cards.map((card) =>
            boostedIds.has(card.id) ? (
              // Contorno dorado + chip FTC, mismo idioma que /propiedades y el
              // AdChip del feed (ver card-ad-chip.tsx): "Patrocinado" y nunca
              // "Destacado" (ese nombre ya lo usa el nivel máximo del Trust
              // Score, que se gana por reputación, no se compra).
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
                <ProfessionalCard professional={card} isLoggedIn={isLoggedIn} />
              </div>
            ) : (
              <ProfessionalCard key={card.id} professional={card} isLoggedIn={isLoggedIn} />
            ),
          )}

          {hasMore && (
            <Link
              href={`/profesionales?${nextParams.toString()}`}
              className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full")}
            >
              {C.loadMore}
              <CaretDown size={16} aria-hidden="true" />
            </Link>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Pestaña "Publicaciones": el newsfeed de los profesionales (0023, entity_listing_id)
// ---------------------------------------------------------------------------

async function PublicacionesContent({
  cursor,
}: {
  cursor: { createdAt: string; id: string } | null;
}) {
  const [tenant, supabase, authUserId] = await Promise.all([
    getTenant(),
    createClient(),
    getAuthUserId(),
  ]);

  const page = await fetchProfessionalPostsPage(supabase, {
    tenantId: tenant.id,
    viewerId: authUserId,
    cursor,
  });

  const nextParams = new URLSearchParams();
  nextParams.set("t", "publicaciones");
  if (page.nextCursor) nextParams.set("pcursor", page.nextCursor);

  return (
    <div className="mt-4">
      <ProfessionalPostsPanel
        posts={page.items}
        tenantId={tenant.id}
        viewerId={authUserId}
        nextHref={page.nextCursor ? `/profesionales?${nextParams.toString()}` : null}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fallbacks: silueta de cada pestaña (shimmer, §5.2)
// ---------------------------------------------------------------------------

function DirectorioSkeleton() {
  return (
    <div aria-busy="true">
      {/* Misma altura (44px) que el buscador + chips reales — sin esto la
          lista salta al llegar el contenido (mismo criterio que /negocios). */}
      <div className="mb-5 mt-4 flex flex-col gap-3">
        <Skeleton className="h-11 w-full rounded-md" />
        <div className="flex gap-2">
          <Skeleton className="h-11 w-20 rounded-full" />
          <Skeleton className="h-11 w-24 rounded-full" />
          <Skeleton className="h-11 w-24 rounded-full" />
          <Skeleton className="h-11 w-20 rounded-full" />
        </div>
      </div>
      <ProfessionalListSkeleton />
    </div>
  );
}

function PublicacionesSkeleton() {
  return (
    <div
      aria-busy="true"
      role="status"
      aria-label="Cargando publicaciones"
      className="mt-4 flex flex-col gap-4"
    >
      <PostCardSkeleton />
      <PostCardSkeleton />
      <span className="sr-only">Cargando publicaciones…</span>
    </div>
  );
}
