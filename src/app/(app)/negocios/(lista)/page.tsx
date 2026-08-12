import { Suspense } from "react";
import Link from "next/link";
import { MagicWand, Megaphone, SealCheck, Storefront } from "@phosphor-icons/react/dist/ssr";
import { allPhotoUrls, firstNameOf, firstPhotoUrl } from "@/components/listings";
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
  SectionCta,
  SectionHeading,
  buttonVariants,
} from "@/components/ui";
import { ImpulsosDeOtrasComunidades } from "@/components/boosts";
import {
  recordBoostImpressions,
  resolveViewerGeo,
  selectOwnBoosts,
} from "@/lib/boosts/select";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { toTrustProps } from "@/lib/trust/signals";
import type { Tables } from "@/lib/types/database.types";
import { cn } from "@/lib/utils";
import { BusinessCard, type BusinessCardModel, type OwnerTrust } from "../business-card";
import { BUSINESS_CATEGORIES, businessCategoryLabel, businessCategoryOf } from "../categories";
import { COPY, NegociosSkeleton, SECCION } from "./list-shell";

export const metadata = { title: "Negocios" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * FILTROS DE NEGOCIOS: los que la base puede responder HOY, y sólo esos.
 *
 *   · `q`           → `listings.search`, el índice FTS español de 0004;
 *   · `rubro`       → `attrs.category` (texto libre; el set curado vive en
 *                     ./categories.ts);
 *   · `verificados` → `listings.store_verified`, el espejo público de
 *                     `business_accounts.verified_presence` (0039).
 *
 * LO QUE PIDE LA SPEC Y NO SE CONSTRUYE, con el motivo:
 *   · "Abierto ahora" — no hay horarios de atención en ninguna tabla
 *     (`business_accounts` guarda categoría, plan y verificación; nada de
 *     horarios). Un filtro así necesita una columna nueva y un huso horario
 *     por negocio.
 *   · "Mejor calificados" — no existen reseñas de negocios. La única tabla de
 *     reseñas del esquema es `gig_reviews`, que es de Colaboraciones y no tiene
 *     nada que ver.
 * Los dos quedan anotados como pendientes de base: sin el dato, el filtro
 * devolvería siempre lo mismo y mentiría sobre lo que sabe la app.
 */
interface Filters {
  q: string;
  rubro: string;
  verificados: boolean;
}

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  return {
    q: sanitizeSearchQuery(firstValue(sp.q)),
    // Sin validar contra el set curado: `attrs.category` es texto libre y un
    // rubro fuera de la lista simplemente no devuelve filas.
    rubro: firstValue(sp.rubro).slice(0, 40),
    verificados: firstValue(sp.verificados) === "1",
  };
}

const CATEGORY_OPTIONS: FilterOption[] = [
  { value: "", label: t("sections", "businessCategoryAny") },
  ...BUSINESS_CATEGORIES.map((option) => ({ value: option.value, label: option.label })),
];

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
  const filters = parseFilters(await searchParams);

  // Streaming (§5.2): el shell + banners se pintan ya; el listado (que depende de
  // la DB) llega por Suspense sin bloquear el resto de la página. La key remonta
  // el Suspense en cada cambio de filtro para que vuelva el skeleton.
  return (
    <Suspense key={JSON.stringify(filters)} fallback={<NegociosSkeleton />}>
      <NegociosContent filters={filters} />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Contenido (streamed): datos reales con RLS del usuario
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

  const LISTING_COLUMNS =
    "id, title, description, area_label, attrs, photos, publisher_name, created_by, published_at, created_at, store_verified";

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

  const { data: negocios } = await query
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(30);

  const rows = negocios ?? [];
  const filtering = Boolean(filters.q || filters.rubro || filters.verificados);

  // -------------------------------------------------------------------------
  // Boost (§7): mismo patrón que /propiedades — los negocios con boost activo
  // van primero, SIEMPRE con el chip "Patrocinado" (misma palabra que
  // vivienda/feed/reel; una divulgación que cambia de nombre según la pantalla
  // deja de leerse como divulgación). A diferencia de vivienda, negocios no
  // pagina por cursor (trae hasta 30 de una), así que el boost corre siempre
  // y no solo "en la primera página". Pagar visibilidad no toca Trust Score
  // ni `store_verified`.
  // -------------------------------------------------------------------------
  //
  // ALCANCE GEOGRÁFICO (0092): un impulso `local` sólo ocupa lugar para quien
  // está en su zona; `nacional` y `global`, para toda la comunidad. Negocios no
  // tiene filtro de zona, así que la zona del espectador sale de su perfil.
  let boostedExtra: typeof rows = [];
  const sinFiltros = !filters.q && !filters.rubro && !filters.verificados;

  const viewer = await resolveViewerGeo(supabase, {
    tenantId: tenant.id,
    userId: user?.id ?? null,
  });
  const placement = await selectOwnBoosts(supabase, { tenantId: tenant.id, viewer });
  const boostedIds = placement.listingIds;
  // Se sirvieron: se cuentan (0092). Best-effort y ruidoso ante la falla.
  await recordBoostImpressions(placement.boostIds);

  // Destacados que no entraron en las 30 filas de la query principal: solo se
  // inyectan en la vista SIN filtros — con filtros activos jamás se cuela un
  // resultado que no matchea (un negocio patrocinado de otro rubro no entra).
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

  // Boosted-first estable: destacados arriba, el resto en su orden natural.
  const orderedRows = [
    ...boostedExtra,
    ...rows.filter((row) => boostedIds.has(row.id)),
    ...rows.filter((row) => !boostedIds.has(row.id)),
  ];

  // Trust Score del dueño (si el negocio tiene dueño con score computado).
  const ownerIds = Array.from(
    new Set(orderedRows.map((row) => row.created_by).filter((id): id is string => Boolean(id))),
  );
  const trustByOwner = new Map<string, OwnerTrustRow>();
  const nameByOwner = new Map<string, string>();
  const verifiedByOwner = new Map<string, boolean>();
  if (ownerIds.length > 0) {
    const [{ data: scores }, { data: owners }] = await Promise.all([
      supabase
        .from("trust_scores")
        .select("profile_id, score, level, signals")
        .in("profile_id", ownerIds),
      supabase.from("profiles").select("id, display_name, identity_verified").in("id", ownerIds),
    ]);
    for (const score of scores ?? []) trustByOwner.set(score.profile_id, score);
    for (const owner of owners ?? []) {
      nameByOwner.set(owner.id, owner.display_name);
      verifiedByOwner.set(owner.id, owner.identity_verified ?? false);
    }
  }

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
          <ModuleFilterToggle
            param="verificados"
            label={t("sections", "businessVerifiedFilter")}
            icon={<SealCheck weight="fill" />}
          />
        </div>
      </div>

      {/* Banner premium para dueños de negocio → Presencia Verificada (§7) */}
      <BezelCard
        variant="featured"
        className="mt-4"
        coreClassName="flex flex-col gap-3 p-5"
      >
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
              <p className="mt-0.5 text-sm text-foreground-secondary">
                {COPY.copilotoTexto}
              </p>
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
      {!filtering && <ImpulsosDeOtrasComunidades className="mt-6" kind="business" />}

      {orderedRows.length === 0 ? (
        filtering ? (
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
          {orderedRows.map((negocio) => {
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

            const business: BusinessCardModel = {
              id: negocio.id,
              title: negocio.title,
              description: negocio.description,
              categoryLabel: businessCategoryLabel(businessCategoryOf(negocio.attrs)),
              areaLabel: negocio.area_label,
              photoUrl: firstPhotoUrl(negocio.photos),
              // Tocar la foto abre el visor con todas; "Ver negocio" sigue
              // abriendo la hoja (feedback 2026-07-26).
              photos: allPhotoUrls(negocio.photos),
              ownerTrust,
              publisherName: negocio.publisher_name,
              storeVerified: negocio.store_verified,
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
