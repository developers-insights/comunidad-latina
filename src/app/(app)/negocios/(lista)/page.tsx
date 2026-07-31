import { Suspense } from "react";
import Link from "next/link";
import { MagicWand, SealCheck, Storefront } from "@phosphor-icons/react/dist/ssr";
import { allPhotoUrls, firstPhotoUrl } from "@/components/listings";
import {
  ModuleFilterSelect,
  ModuleFilterToggle,
  ModuleSearchBar,
  sanitizeSearchQuery,
  type FilterOption,
} from "@/components/search";
import {
  BezelCard,
  EmptyState,
  SectionCta,
  SectionHeading,
  buttonVariants,
} from "@/components/ui";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { toTrustProps } from "@/lib/trust/signals";
import type { Tables } from "@/lib/types/database.types";
import { cn } from "@/lib/utils";
import { BusinessCard, type BusinessCardModel } from "../business-card";
import type { OwnerTrust } from "../business-trust-badge";
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
 * Trust Score del dueño → props del badge. Usa la fuente única
 * (@/lib/trust/signals): las mismas señales que ve el usuario en vivienda,
 * mensajes y profesionales. `identity_verified` viene del perfil del dueño.
 */
function buildOwnerTrust(
  score: OwnerTrustRow | undefined,
  ownerName: string,
  identityVerified: boolean,
): OwnerTrust | null {
  const props = toTrustProps(score ?? null, identityVerified);
  if (!props) return null;
  return { name: ownerName, ...props };
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

  let query = supabase
    .from("listings")
    .select(
      "id, title, description, area_label, attrs, photos, publisher_name, created_by, published_at, created_at",
    )
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

  // Trust Score del dueño (si el negocio tiene dueño con score computado).
  const ownerIds = Array.from(
    new Set(rows.map((row) => row.created_by).filter((id): id is string => Boolean(id))),
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

      {rows.length === 0 ? (
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
          {rows.map((negocio) => {
            const ownerName = negocio.created_by
              ? (nameByOwner.get(negocio.created_by) ?? negocio.publisher_name ?? "")
              : "";
            const ownerTrust = negocio.created_by
              ? buildOwnerTrust(
                  trustByOwner.get(negocio.created_by),
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
            };

            return <BusinessCard key={negocio.id} business={business} />;
          })}
        </div>
      )}
    </>
  );
}
