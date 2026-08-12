import { Suspense } from "react";
import Link from "next/link";
import { CaretDown, Megaphone, Plus } from "@phosphor-icons/react/dist/ssr";
import {
  Bubble,
  Chip,
  EmptyState,
  SectionCta,
  SectionHeading,
  Skeleton,
  buttonVariants,
} from "@/components/ui";
import {
  COPY,
  ListingCard,
  ListingFilters,
  ListingListSkeleton,
  buildTrustSignals,
  decodeCursor,
  encodeCursor,
  firstPhotoUrl,
  formatListingPrice,
  listingPhotoUrl,
  toTrustLevel,
  type ListingCardModel,
  type PublisherView,
  type VerificationView,
} from "@/components/listings";
import { ImpulsosDeOtrasComunidades } from "@/components/boosts";
import {
  recordBoostImpressions,
  resolveViewerGeo,
  selectOwnBoosts,
} from "@/lib/boosts/select";
import { t } from "@/lib/i18n";
import {
  PROPERTY_OPERATION_ATTR,
  PROPERTY_TYPE_ATTR,
  normalizePropertyOperation,
  normalizePropertyType,
  type PropertyOperation,
  type PropertyType,
} from "@/lib/propiedades/tipos";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { getViewerFormatDate } from "@/lib/time/viewer-zone";
import { cn } from "@/lib/utils";

export const metadata = { title: "Vivienda" };

const PAGE_SIZE = 10;

/** Acento + ícono 3D de la sección (los mismos del menú y de /buscar). */
const SECCION = {
  accent: "var(--accent-vivienda)",
  image: "/icons/menu/vivienda.webp",
  publicarHref: "/publicar?kind=property",
} as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

interface Filters {
  q: string;
  precio: number | null;
  hab: number | null;
  zona: string;
  /** `null` = sin filtrar por tipo (se ven todos, incluidos los que no declaran). */
  tipo: PropertyType | null;
  /** `null` = sin filtrar por operación (se ven alquiler, venta y no declarados). */
  operacion: PropertyOperation | null;
  cursor: string;
}

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const precioRaw = Number(firstValue(sp.precio));
  const habRaw = Number(firstValue(sp.hab));
  return {
    q: firstValue(sp.q).slice(0, 120),
    precio: Number.isFinite(precioRaw) && precioRaw > 0 ? precioRaw : null,
    hab: Number.isFinite(habRaw) && habRaw >= 1 && habRaw <= 10 ? habRaw : null,
    zona: firstValue(sp.zona).slice(0, 80),
    // Los normalizadores devuelven null ante cualquier cosa que no esté en el
    // catálogo, así que un `?tipo=<script>` de la URL no llega a la query: se
    // lee como "sin filtro" y la lista sale completa, no vacía ni rota.
    tipo: normalizePropertyType(firstValue(sp.tipo)),
    operacion: normalizePropertyOperation(firstValue(sp.operacion)),
    cursor: firstValue(sp.cursor),
  };
}

export default async function PropiedadesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);

  return (
    <Suspense key={JSON.stringify(filters)} fallback={<PageSkeleton />}>
      <PropiedadesContent filters={filters} />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Contenido (streamed): datos reales con RLS del usuario
// ---------------------------------------------------------------------------

async function PropiedadesContent({ filters }: { filters: Filters }) {
  // createClient() NO hace red (solo lee cookies): lo creamos primero y así
  // solapamos el round-trip a DB de getTenant() con el de Auth (getUser()).
  const supabase = await createClient();
  const [
    tenant,
    {
      data: { user },
    },
  ] = await Promise.all([getTenant(), supabase.auth.getUser()]);

  // Área del usuario para el header de sección (si tiene perfil con zona).
  let userArea: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("area_label")
      .eq("id", user.id)
      .maybeSingle();
    userArea = profile?.area_label ?? null;
  }

  // -------------------------------------------------------------------------
  // Query principal: keyset pagination (created_at,id), filtros por searchParams
  // -------------------------------------------------------------------------
  let query = supabase
    .from("listings")
    .select(
      "id, title, price_amount, price_currency, price_period, area_label, photos, attrs, created_by, publisher_name, source, created_at",
    )
    .eq("tenant_id", tenant.id)
    .eq("kind", "property")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (filters.q) {
    // config "spanish" A PROPÓSITO, aunque 0052 haya hecho la búsqueda
    // insensible a los acentos. Lo que cambió está del lado del documento:
    // listings.search guarda el texto analizado DE LAS DOS MANERAS (spanish +
    // spanish_unaccent), así que tipear "habitacion" sin tilde ya encuentra
    // "Habitación" consultando con "spanish" — verificado contra la base.
    //
    // Pasar esto a "spanish_unaccent" no agrega nada y RESTA: el stemmer
    // español reconoce los sufijos POR la tilde, y sin ella "barbería" deja de
    // encontrar "barba" (medido: 5 → 4 resultados) y "orientación" pierde
    // "orientativa" (3 → 1). Se queda como está.
    query = query.textSearch("search", filters.q, { type: "websearch", config: "spanish" });
  }
  if (filters.precio !== null) {
    query = query.lte("price_amount", filters.precio);
  }
  if (filters.hab !== null) {
    query = query.gte("attrs->bedrooms", filters.hab);
  }
  // `attrs->>` (TEXTO) y no `attrs->` (jsonb): estos dos son cadenas, y con
  // `->` habría que comparar contra `"casa"` con comillas incluidas. Mismo
  // patrón que negocios/profesionales/empleos.
  //
  // RETROCOMPATIBILIDAD: un aviso viejo no tiene la clave, así que `attrs->>…`
  // es NULL y `eq` no lo devuelve. Eso es correcto —quien pide "venta" no está
  // pidiendo "avisos que quizá sean venta"— y es inofensivo, porque el filtro
  // sólo se agrega cuando la persona lo eligió. Sin filtro no hay condición y
  // los avisos viejos siguen apareciendo enteros.
  if (filters.tipo !== null) {
    query = query.eq(`attrs->>${PROPERTY_TYPE_ATTR}`, filters.tipo);
  }
  if (filters.operacion !== null) {
    query = query.eq(`attrs->>${PROPERTY_OPERATION_ATTR}`, filters.operacion);
  }
  if (filters.zona) {
    query = query.eq("area_label", filters.zona);
  }
  const cursor = decodeCursor(filters.cursor || undefined);
  if (cursor) {
    query = query.or(
      `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt."${cursor.id}")`,
    );
  }

  const { data: rows, error } = await query;

  if (error) {
    console.warn("[vivienda] query de listings falló", { code: error.code });
  }

  const pageRows = (rows ?? []).slice(0, PAGE_SIZE);
  const hasMore = (rows ?? []).length > PAGE_SIZE;

  // -------------------------------------------------------------------------
  // Boost (§7): los avisos pagos van primero, SOLO en la primera página (sin
  // cursor). HONESTO por diseño (FTC): cada uno lleva el chip "Patrocinado" —
  // la misma palabra que el feed, el reel y la búsqueda, porque una divulgación
  // que cambia de nombre según la pantalla deja de leerse como divulgación.
  // NO puede decir "Destacado": así se llama el nivel máximo del Trust Score,
  // que se gana por reputación, y confundirlos vende lo pago como mérito.
  // Pagar visibilidad no toca Trust Score ni verificación.
  // -------------------------------------------------------------------------
  //
  // ALCANCE GEOGRÁFICO (0092): el lugar pago dejó de aplicarle a todo el mundo.
  // Un impulso `local` sólo ocupa lugar para quien está en su zona —la que
  // declaró en el perfil, o la que está filtrando ahora mismo, que pesa más—;
  // `nacional` y `global` le aplican a toda la comunidad. La regla vive UNA vez
  // en `src/lib/boosts`, no cuatro copiada en cada listado.
  let boostedIds = new Set<string>();
  let boostedExtra: typeof pageRows = [];
  const sinFiltros =
    !filters.q &&
    filters.precio === null &&
    filters.hab === null &&
    filters.tipo === null &&
    filters.operacion === null &&
    !filters.zona;
  if (!cursor) {
    const viewer = await resolveViewerGeo(supabase, {
      tenantId: tenant.id,
      profileArea: userArea,
      zoneFilter: filters.zona || null,
    });
    const placement = await selectOwnBoosts(supabase, { tenantId: tenant.id, viewer });
    boostedIds = placement.listingIds;
    // Se sirvieron: se cuentan (0092). Best-effort y ruidoso ante la falla —
    // una métrica no puede tirar un listado, pero tampoco puede callarse.
    await recordBoostImpressions(placement.boostIds);

    // Destacados que no entraron por fecha: solo en la vista sin filtros
    // (con filtros activos jamás se inyecta un resultado que no matchea).
    const missingIds = [...boostedIds].filter(
      (id) => !pageRows.some((row) => row.id === id),
    );
    if (sinFiltros && missingIds.length > 0) {
      const { data: extra } = await supabase
        .from("listings")
        .select(
          "id, title, price_amount, price_currency, price_period, area_label, photos, attrs, created_by, publisher_name, source, created_at",
        )
        .eq("tenant_id", tenant.id)
        .eq("kind", "property")
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
  // Batch 1: verificaciones found_active de estos listings (regla estricta)
  // Batch 2: perfiles + trust scores de los publicadores con cuenta
  // Batch 3: zonas disponibles para el filtro
  // -------------------------------------------------------------------------
  const listingIds = orderedRows.map((row) => row.id);
  const publisherIds = [
    ...new Set(orderedRows.map((row) => row.created_by).filter((id): id is string => Boolean(id))),
  ];

  const [checksResult, profilesResult, trustResult, zonesResult] = await Promise.all([
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
    // Las zonas del filtro solo se derivan en la PRIMERA página (sin cursor):
    // en "cargar más" los chips ya se renderizaron, así que evitamos escanear
    // hasta 200 filas de nuevo.
    cursor
      ? Promise.resolve({ data: [] as { area_label: string | null }[] })
      : supabase
          .from("listings")
          .select("area_label")
          .eq("tenant_id", tenant.id)
          .eq("kind", "property")
          .eq("status", "published")
          .not("area_label", "is", null)
          .limit(200),
  ]);

  // Sólo el check MÁS RECIENTE por sujeto decide (viene ordenado checked_at desc).
  // Registramos ese primero visto para NO dejar que un found_active viejo pise a un
  // expired/mismatch posterior; y sólo mostramos sello si ese último es found_active.
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

  const zones = [
    ...new Set(
      (zonesResult.data ?? [])
        .map((row) => row.area_label)
        .filter((label): label is string => Boolean(label)),
    ),
  ].sort((a, b) => a.localeCompare(b, "es"));

  const cards: ListingCardModel[] = orderedRows.map((row) => {
    let publisher: PublisherView = null;
    if (row.created_by) {
      const profile = profileById.get(row.created_by);
      const trust = trustById.get(row.created_by);
      publisher = {
        type: "member",
        profileId: row.created_by,
        displayName: profile?.display_name ?? COPY.list.communityMember,
        avatarUrl: profile?.avatar_url ?? null,
        score: trust?.score ?? 0,
        level: toTrustLevel(trust?.level),
        signals: buildTrustSignals(trust?.signals ?? {}, profile?.identity_verified ?? false),
      };
    } else if (row.publisher_name) {
      publisher = { type: "external", name: row.publisher_name };
    }

    return {
      id: row.id,
      title: row.title,
      priceLabel: formatListingPrice(
        row.price_amount,
        row.price_currency,
        row.price_period,
        tenant.locale,
      ),
      areaLabel: row.area_label,
      photoUrl: firstPhotoUrl(row.photos),
      // TODAS las fotos ya resueltas: tocar la foto de la card abre el visor a
      // pantalla completa y se pasan de una, sin entrar al detalle.
      photos: (row.photos ?? [])
        .filter((path) => path && path.trim().length > 0)
        .map(listingPhotoUrl),
      verification: verificationByListing.get(row.id) ?? null,
      publisher,
    };
  });

  const lastRow = pageRows[pageRows.length - 1];
  const nextParams = new URLSearchParams();
  if (filters.q) nextParams.set("q", filters.q);
  if (filters.precio !== null) nextParams.set("precio", String(filters.precio));
  if (filters.hab !== null) nextParams.set("hab", String(filters.hab));
  if (filters.tipo !== null) nextParams.set("tipo", filters.tipo);
  if (filters.operacion !== null) nextParams.set("operacion", filters.operacion);
  if (filters.zona) nextParams.set("zona", filters.zona);
  if (hasMore && lastRow) nextParams.set("cursor", encodeCursor(lastRow.created_at, lastRow.id));

  const isSearching = Boolean(filters.q);

  return (
    <>
      <SectionHeading
        accent={SECCION.accent}
        image={SECCION.image}
        title={COPY.list.title}
        subtitle={userArea ? COPY.list.subtitleNearArea(userArea) : COPY.list.subtitleDefault}
      />

      <SectionCta
        accent={SECCION.accent}
        href={SECCION.publicarHref}
        title={t("sections", "publishPropertyTitle")}
        hint={t("sections", "publishPropertyHint")}
        className="mt-3"
      />

      {/* Bandeja de filtros: el buscador y los tres selectores flotaban sueltos
          sobre la página (justo lo que el cliente marcó como "todo suelto").
          Adentro de una cápsula hundida se leen como UN control de búsqueda —
          el que él describió que tiene que vivir adentro de cada categoría. */}
      <Bubble tone="tray" shape="tile" size="none" className="mb-5 mt-4 p-3">
        <ListingFilters zones={zones} />
      </Bubble>

      {/* Impulsos con alcance nacional/global comprados en OTRAS comunidades
          (0092). Va sólo en la primera página y sin filtros activos: es
          publicidad, y la publicidad no puede desplazar a lo que alguien
          buscó. Si no hay ninguno, el componente no renderiza nada. */}
      {!cursor && sinFiltros && <ImpulsosDeOtrasComunidades kind="property" />}

      {cards.length === 0 ? (
        <EmptyState
          illustration="/images/empty-state-search.png"
          title={isSearching ? COPY.list.emptySearchTitle : COPY.list.emptyTitle}
          message={isSearching ? COPY.list.emptySearchMessage : COPY.list.emptyMessage}
          action={
            <Link
              href="/publicar"
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              <Plus size={18} aria-hidden="true" />
              {COPY.list.emptyPublishCta}
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {cards.map((card) =>
            boostedIds.has(card.id) ? (
              // Contorno dorado + chip FTC (feedback cliente Geovanny,
              // 2026-08-05: "todo el contorno" en dorado, mismo idioma que el
              // AdChip del feed — ver card-ad-chip.tsx). El anillo rodea la
              // ListingCard completa (su propio Double-Bezel queda intacto
              // adentro); el chip flota sobre la foto, igual que el chip de
              // verificación que ya vive ahí, para no competir con "todo el
              // contorno" pidiendo además una fila propia arriba.
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
                <ListingCard listing={card} />
              </div>
            ) : (
              <ListingCard key={card.id} listing={card} />
            ),
          )}

          {hasMore && (
            <Link
              href={`/propiedades?${nextParams.toString()}`}
              className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full")}
            >
              {COPY.list.loadMore}
              <CaretDown size={16} aria-hidden="true" />
            </Link>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Fallback: silueta del header + filtros + cards (shimmer, §5.2)
// ---------------------------------------------------------------------------

function PageSkeleton() {
  return (
    <div aria-busy="true">
      <SectionHeading
        accent={SECCION.accent}
        image={SECCION.image}
        title={COPY.list.title}
        subtitle={COPY.list.subtitleDefault}
      />
      <SectionCta
        accent={SECCION.accent}
        href={SECCION.publicarHref}
        title={t("sections", "publishPropertyTitle")}
        hint={t("sections", "publishPropertyHint")}
        className="mt-3"
      />
      <Bubble tone="tray" shape="tile" size="none" className="mb-5 mt-4 flex flex-col gap-3 p-3">
        <Skeleton className="h-11 w-full rounded-md" />
        {/* Misma grilla que <ListingFilters/>: 5 selectores, el de zona a dos
            celdas. Si la silueta no coincidiera con el control real, la
            bandeja saltaría al hidratar (CLS) justo debajo del buscador. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Skeleton className="h-11 rounded-md" />
          <Skeleton className="h-11 rounded-md" />
          <Skeleton className="h-11 rounded-md" />
          <Skeleton className="h-11 rounded-md" />
          <Skeleton className="col-span-2 h-11 rounded-md" />
        </div>
      </Bubble>
      <ListingListSkeleton />
    </div>
  );
}
