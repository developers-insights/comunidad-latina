import Link from "next/link";
import { ArrowLeft, Scales } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, NavTabs, type NavTabItem } from "@/components/ui";
import { byteaToHex, shortHash } from "@/lib/integrity/hash";
import {
  DISPUTAS_ADMIN_COPY,
  DISPUTE_FILTERS,
  disputeFilterStatuses,
  resolveDisputeFilter,
  untypedSupabase,
  type ContentDisputeRow,
  type DisputeFilterId,
} from "@/lib/integrity/disputes";
import { requireStaff } from "../../../guard";
import { DisputeCard, type DisputeCardData } from "./dispute-card";

export const metadata = { title: DISPUTAS_ADMIN_COPY.title };

/**
 * =============================================================================
 * COLA DE RECLAMOS DE CONTENIDO
 * =============================================================================
 *
 * Hermana de `/admin/moderacion/integridad`, y separada de ella por el mismo
 * motivo por el que la 0086 hizo tabla aparte: una alerta es un HECHO MEDIBLE
 * entre dos archivos; un reclamo es una AFIRMACIÓN HUMANA que puede ser falsa.
 * Mezclarlas en una lista haría que un reclamo sin fundamento se leyera como
 * evidencia técnica.
 *
 * TODO SE LEE CON EL CLIENTE DEL STAFF, sin admin client: `content_disputes`,
 * `content_assets` y `profiles` tienen las tres SELECT con rama de staff acotada
 * al tenant. El admin client aparece una sola vez en este módulo —en
 * `actions.ts`, para espejar `review_status`— y por el motivo que está escrito
 * ahí.
 *
 * SE CARGA POR LOTE: una consulta por tabla y join en memoria, igual que la
 * página hermana. Con 50 casos, N+1 acá serían 150 round-trips.
 */

const MAX_DISPUTES = 50;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function filterTabs(): NavTabItem[] {
  return DISPUTE_FILTERS.map((filter) => ({
    id: filter.id,
    label: filter.label,
    href: `/admin/moderacion/integridad/disputas?estado=${filter.id}`,
  }));
}

function emptyCopy(filter: DisputeFilterId): { title: string; message: string } {
  if (filter === "resueltos") {
    return {
      title: DISPUTAS_ADMIN_COPY.emptyClosedTitle,
      message: DISPUTAS_ADMIN_COPY.emptyClosedMessage,
    };
  }
  if (filter === "todos") {
    return {
      title: DISPUTAS_ADMIN_COPY.emptyAllTitle,
      message: DISPUTAS_ADMIN_COPY.emptyAllMessage,
    };
  }
  return {
    title: DISPUTAS_ADMIN_COPY.emptyOpenTitle,
    message: DISPUTAS_ADMIN_COPY.emptyOpenMessage,
  };
}

export default async function DisputasPage({ searchParams }: { searchParams: SearchParams }) {
  const [{ supabase }, sp] = await Promise.all([requireStaff("moderator"), searchParams]);

  const filter = resolveDisputeFilter(sp.estado);

  const { data: disputeRows, error: disputesError } = await untypedSupabase(supabase)
    .from("content_disputes")
    .select(
      "id, tenant_id, asset_id, claimant_id, respondent_id, claim_kind, claim_text, evidence_urls, status, resolution_note, resolved_by, resolved_at, created_at, updated_at",
    )
    .in("status", disputeFilterStatuses(filter))
    .order("created_at", { ascending: false })
    .limit(MAX_DISPUTES);

  if (disputesError) {
    console.error("[disputas] no se pudo leer la cola:", disputesError.message);
  }

  const disputes = (disputeRows as ContentDisputeRow[] | null) ?? [];

  // ---- Assets reclamados ----------------------------------------------------
  const assetIds = [...new Set(disputes.map((row) => row.asset_id))];

  // El `select` va en UNA línea a propósito: supabase-js deriva el tipo de la
  // fila parseando ese string literal.
  const assetRows = assetIds.length
    ? ((
        await supabase
          .from("content_assets")
          .select(
            "id, media_kind, subject_kind, original_filename, sha256, first_uploaded_at, review_status, originality_declared, license_kind, license_statement",
          )
          .in("id", assetIds)
      ).data ?? [])
    : [];

  const assetById = new Map(assetRows.map((row) => [row.id, row]));

  // ---- Nombres de las tres personas que pueden aparecer ---------------------
  const profileIds = [
    ...new Set(
      disputes
        .flatMap((row) => [row.claimant_id, row.respondent_id, row.resolved_by])
        .filter((id): id is string => typeof id === "string"),
    ),
  ];

  const profileRows = profileIds.length
    ? ((await supabase.from("profiles").select("id, display_name").in("id", profileIds)).data ?? [])
    : [];

  const nameById = new Map(profileRows.map((row) => [row.id, row.display_name]));

  // ---- Armado de la vista ---------------------------------------------------
  const cards: DisputeCardData[] = disputes.map((row) => {
    const asset = assetById.get(row.asset_id);
    return {
      id: row.id,
      status: row.status,
      claimKind: row.claim_kind,
      claimText: row.claim_text,
      evidenceUrls: row.evidence_urls ?? [],
      createdAt: row.created_at,
      resolutionNote: row.resolution_note,
      resolvedAt: row.resolved_at,
      resolvedByName: row.resolved_by ? (nameById.get(row.resolved_by) ?? null) : null,
      claimantName: nameById.get(row.claimant_id) ?? null,
      respondentName: row.respondent_id ? (nameById.get(row.respondent_id) ?? null) : null,
      // Sin el asset la tarjeta igual se muestra: el reclamo y las dos partes son
      // lo que hay que decidir, y ocultarlo dejaría un caso invisible en la cola.
      asset: asset
        ? {
            reviewStatus: asset.review_status,
            mediaKind: asset.media_kind,
            subjectKind: asset.subject_kind,
            filename: asset.original_filename,
            shortHash: shortHash(byteaToHex(asset.sha256)),
            firstUploadedAt: asset.first_uploaded_at,
            originalityDeclared: asset.originality_declared,
            licenseKind: asset.license_kind,
            licenseStatement: asset.license_statement,
          }
        : null,
    };
  });

  const empty = emptyCopy(filter);

  return (
    <section aria-labelledby="disputas-title" className="flex flex-col gap-4">
      <header>
        <Link
          href="/admin/moderacion/integridad"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-foreground-secondary transition-colors duration-(--duration-fast) hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          {DISPUTAS_ADMIN_COPY.backToIntegrity}
        </Link>
        <h2 id="disputas-title" className="mt-1 font-display text-2xl font-bold text-foreground">
          {DISPUTAS_ADMIN_COPY.title}
        </h2>
        <p className="mt-1 max-w-[70ch] text-sm text-foreground-secondary">
          {DISPUTAS_ADMIN_COPY.intro}
        </p>
        <p className="mt-1 max-w-[70ch] text-xs leading-relaxed text-foreground-muted">
          {DISPUTAS_ADMIN_COPY.disclaimer}
        </p>
      </header>

      <NavTabs
        items={filterTabs()}
        active={filter}
        label={DISPUTAS_ADMIN_COPY.filterLabel}
      />

      {cards.length > 0 && (
        <p className="text-xs font-medium tabular-nums text-foreground-muted">
          {DISPUTAS_ADMIN_COPY.openLabel(cards.length)}
        </p>
      )}

      {cards.length === 0 ? (
        <EmptyState icon={<Scales />} title={empty.title} message={empty.message} />
      ) : (
        <div className="flex flex-col gap-3">
          {cards.map((dispute) => (
            <DisputeCard key={dispute.id} dispute={dispute} />
          ))}
        </div>
      )}
    </section>
  );
}
