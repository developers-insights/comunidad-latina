import Link from "next/link";
import { ArrowLeft, Fingerprint, Scales } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import { byteaToHex, shortHash } from "@/lib/integrity/hash";
import { requireStaff } from "../../guard";
import {
  IntegrityAlertCard,
  type IntegrityAlertData,
  type IntegrityVersionData,
} from "./alert-card";

export const metadata = { title: "Integridad de contenido" };

/**
 * =============================================================================
 * COLA DE CONTENT INTEGRITY (§ pliego)
 * =============================================================================
 *
 * Es una cola APARTE de `/admin/moderacion` y no una pestaña más de la misma
 * tabla, por la misma razón por la que la 0061 hizo tablas separadas: la
 * decisión acá es de AUTORÍA y licencia, no de si el contenido es aceptable. Un
 * archivo puede ser perfectamente publicable y aun así no ser tuyo.
 *
 * TODO SE LEE CON EL CLIENTE DEL STAFF, sin admin client: las cuatro tablas de
 * la 0061 tienen SELECT con rama de staff acotada al tenant. El admin client
 * aparece una sola vez en este módulo —en `actions.ts`, para espejar
 * `review_status`— y por un motivo que está escrito ahí.
 *
 * Se cargan por LOTE (una consulta por tabla, no una por alerta): la cola llega
 * a 50 casos y N+1 acá serían 250 round-trips.
 */

const COPY = {
  title: "Integridad de contenido",
  intro:
    "Archivos que coinciden con otros de esta comunidad, o que se cargaron sin declarar de dónde salieron.",
  emptyTitle: "Sin casos abiertos",
  emptyMessage:
    "Ningún archivo quedó marcado. Cuando el análisis encuentre una coincidencia, aparece acá.",
  backToQueue: "Volver a la cola de moderación",
  disputesLink: "Reclamos de autoría",
  disputesHint: "Cuando alguien dice que un contenido es suyo, el caso se resuelve acá al lado.",
  openLabel: (n: number) => (n === 1 ? "1 caso abierto" : `${n} casos abiertos`),
  crossTenantNote:
    "El análisis sólo compara contenido de esta comunidad: nunca se cruzan dominios.",
} as const;

/** Abiertas + en investigación: las dos son "todavía hay que decidir". */
const OPEN_STATUSES = ["abierta", "en_investigacion"];

const MAX_ALERTS = 50;

export default async function IntegridadPage() {
  const { supabase } = await requireStaff("moderator");

  const { data: alertRows } = await supabase
    .from("content_integrity_alerts")
    .select("id, asset_id, match_id, kind, severity, detail, status, created_at")
    .in("status", OPEN_STATUSES)
    .order("created_at", { ascending: false })
    .limit(MAX_ALERTS);

  const alerts = alertRows ?? [];

  // ---- Matches (la evidencia: qué algoritmo y a qué distancia) -------------
  const matchIds = alerts
    .map((row) => row.match_id)
    .filter((id): id is string => typeof id === "string");

  // Los `select` van en UNA línea a propósito: supabase-js deriva el tipo de la
  // fila parseando ese string literal, así que una concatenación lo deja ciego
  // y todas las columnas pasan a ser errores de tipo.
  const matchRows = matchIds.length
    ? ((
        await supabase
          .from("content_matches")
          .select("id, matched_asset_id, match_type, algorithm, distance")
          .in("id", matchIds)
      ).data ?? [])
    : [];

  const matchById = new Map(matchRows.map((row) => [row.id, row]));

  // ---- Assets: los de las alertas y sus contrapartes ------------------------
  const assetIds = new Set(alerts.map((row) => row.asset_id));
  const counterpartIds = new Set<string>();
  for (const match of matchRows) counterpartIds.add(match.matched_asset_id);

  const allAssetIds = [...new Set([...assetIds, ...counterpartIds])];

  const assetRows = allAssetIds.length
    ? ((
        await supabase
          .from("content_assets")
          .select(
            "id, uploader_id, subject_kind, subject_id, media_kind, original_filename, sha256, source_host, first_uploaded_at, review_status, originality_declared, license_kind, license_statement, license_url",
          )
          .in("id", allAssetIds)
      ).data ?? [])
    : [];

  const assetById = new Map(assetRows.map((row) => [row.id, row]));

  // ---- Historial de versiones de los assets de las alertas -----------------
  const versionRows = assetIds.size
    ? ((
        await supabase
          .from("content_asset_versions")
          .select("asset_id, version, sha256, change_reason, created_at")
          .in("asset_id", [...assetIds])
          .order("version", { ascending: false })
      ).data ?? [])
    : [];

  const versionsByAsset = new Map<string, IntegrityVersionData[]>();
  for (const row of versionRows) {
    const list = versionsByAsset.get(row.asset_id) ?? [];
    list.push({
      version: row.version,
      createdAt: row.created_at,
      shortHash: shortHash(byteaToHex(row.sha256)),
      reason: row.change_reason,
    });
    versionsByAsset.set(row.asset_id, list);
  }

  // ---- Nombres de quienes subieron ----------------------------------------
  const uploaderIds = [...new Set(assetRows.map((row) => row.uploader_id))];

  const profileRows = uploaderIds.length
    ? ((await supabase.from("profiles").select("id, display_name").in("id", uploaderIds))
        .data ?? [])
    : [];

  const nameById = new Map(profileRows.map((row) => [row.id, row.display_name]));

  // ---- Armado de la vista ---------------------------------------------------
  const viewAlerts: IntegrityAlertData[] = [];
  for (const alert of alerts) {
    const asset = assetById.get(alert.asset_id);
    // Sin el asset no hay nada que mostrarle a nadie (RLS o borrado en cascada):
    // se omite en vez de pintar una tarjeta vacía.
    if (!asset) continue;

    const match = alert.match_id ? matchById.get(alert.match_id) : undefined;
    const counterpartAsset = match ? assetById.get(match.matched_asset_id) : undefined;

    viewAlerts.push({
      id: alert.id,
      kind: alert.kind,
      severity: alert.severity,
      status: alert.status,
      detail: alert.detail,
      createdAt: alert.created_at,
      algorithm: match?.algorithm ?? null,
      distance: match?.distance ?? null,
      asset: {
        id: asset.id,
        subjectKind: asset.subject_kind,
        subjectId: asset.subject_id,
        mediaKind: asset.media_kind,
        uploaderName: nameById.get(asset.uploader_id) ?? null,
        firstUploadedAt: asset.first_uploaded_at,
        sourceHost: asset.source_host,
        filename: asset.original_filename,
        shortHash: shortHash(byteaToHex(asset.sha256)),
        reviewStatus: asset.review_status,
        originalityDeclared: asset.originality_declared,
        licenseKind: asset.license_kind,
        licenseStatement: asset.license_statement,
        licenseUrl: asset.license_url,
        versions: versionsByAsset.get(asset.id) ?? [],
      },
      counterpart: counterpartAsset
        ? {
            uploaderName: nameById.get(counterpartAsset.uploader_id) ?? null,
            firstUploadedAt: counterpartAsset.first_uploaded_at,
            shortHash: shortHash(byteaToHex(counterpartAsset.sha256)),
            subjectKind: counterpartAsset.subject_kind,
          }
        : null,
    });
  }

  return (
    <section aria-labelledby="integridad-title" className="flex flex-col gap-4">
      <header>
        <Link
          href="/admin/moderacion"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-foreground-secondary transition-colors duration-(--duration-fast) hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          {COPY.backToQueue}
        </Link>
        <h2
          id="integridad-title"
          className="mt-1 font-display text-2xl font-bold text-foreground"
        >
          {COPY.title}
        </h2>
        <p className="mt-1 text-sm text-foreground-secondary">{COPY.intro}</p>
        <p className="mt-1 text-xs text-foreground-muted">{COPY.crossTenantNote}</p>
        {/* Las dos colas son hermanas y se miran juntas: una nace del análisis
            automático, la otra de una persona que reclama. Sin este link, a la
            de reclamos sólo se llegaba escribiendo la URL a mano. */}
        <Link
          href="/admin/moderacion/integridad/disputas"
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-foreground-secondary transition-colors duration-(--duration-fast) hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
        >
          <Scales size={16} aria-hidden="true" />
          {COPY.disputesLink}
        </Link>
        <p className="mt-0.5 text-xs text-foreground-muted">{COPY.disputesHint}</p>
        {viewAlerts.length > 0 && (
          <p className="mt-2 text-xs font-medium tabular-nums text-foreground-muted">
            {COPY.openLabel(viewAlerts.length)}
          </p>
        )}
      </header>

      {viewAlerts.length === 0 ? (
        <EmptyState
          icon={<Fingerprint />}
          title={COPY.emptyTitle}
          message={COPY.emptyMessage}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {viewAlerts.map((alert) => (
            <IntegrityAlertCard key={alert.id} alert={alert} />
          ))}
        </div>
      )}
    </section>
  );
}
