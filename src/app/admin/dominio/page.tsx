import { CheckSquareOffset, Flag } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import {
  ListingReviewItem,
  type ListingReviewData,
} from "@/components/admin/listing-review-item";
import {
  ScamReportItem,
  type ScamReportData,
} from "@/components/admin/scam-report-item";
import { ModuleToggles } from "@/components/admin/module-toggles";
import { getTenant } from "@/lib/tenant/resolve";
import { formatMoney } from "@/lib/utils";
import { requireStaff } from "../guard";

export const metadata = { title: "Dominio" };

/**
 * Panel de Dominio (domain_admin+): estado del tenant de un vistazo, avisos en
 * revisión, reportes de estafa abiertos y módulos on/off.
 *
 * Todas las lecturas y las resoluciones de avisos/reportes van con el cliente
 * del usuario staff (RLS gobierna). El único path privilegiado es el update de
 * tenants.modules (ver dominio/actions.ts).
 */

const COPY = {
  title: "Tu comunidad",
  statsIntro: "Los números de hoy — sin métricas de vanidad, solo lo operativo.",
  stats: {
    members: "Miembros",
    posts: "Publicaciones",
    published: "Avisos activos",
    pending: "En revisión",
    reports: "Reportes abiertos",
  },
  byKindTitle: "Avisos publicados por tipo",
  kindLabel: {
    property: "Vivienda",
    business: "Negocios",
    professional: "Profesionales",
    event: "Eventos",
    // "Empleos" y no "Trabajos": las otras cuatro filas usan el nombre del
    // módulo tal como se ve en el menú, y "Trabajos" es como se llama la
    // sección de gigs de Creadores — otro módulo.
    job: "Empleos",
  } as Record<string, string>,
  reviewTitle: "Avisos esperando revisión",
  reviewEmptyTitle: "Nada en revisión",
  reviewEmptyMessage: "Cuando alguien publique un aviso nuevo, va a aparecer acá para tu ok.",
  reportsTitle: "Reportes de estafa abiertos",
  reportsEmptyTitle: "Sin reportes abiertos",
  reportsEmptyMessage: "La comunidad no reportó nada pendiente. El Escudo sigue atento.",
  modulesTitle: "Módulos de la comunidad",
  modulesIntro:
    "Decidí qué secciones ve tu comunidad. Podés dejar una anunciada como “Muy pronto” antes de abrirla. Los cambios se aplican al instante.",
  modulesUnavailable:
    "No pudimos leer cómo está configurada tu comunidad, así que abajo ves los valores por defecto. Recargá antes de guardar — si guardás ahora podrías prender secciones que tenías apagadas.",
  targetFallback: {
    listing: "Aviso reportado",
    profile: "Perfil reportado",
    message: "Mensaje reportado (contenido privado — §5.4)",
  } as Record<string, string>,
} as const;

const LISTING_KINDS = ["property", "business", "professional", "event", "job"] as const;

export default async function DominioPage() {
  const { supabase, tenantId: jwtTenantId } = await requireStaff("domain_admin");
  const tenant = await getTenant();
  // El tenant REAL del admin es el del JWT (el Host header es cosmético acá).
  const tenantId = jwtTenantId ?? tenant.id;

  // Módulos de MI tenant (el del JWT) — no del tenant del Host header. Las dos
  // columnas hermanas viajan en el MISMO select: se leen siempre juntas y una
  // sin la otra no describe ningún estado.
  const { data: tenantRow, error: modulesError } = await supabase
    .from("tenants")
    .select("modules, modules_soon")
    .eq("id", tenantId)
    .maybeSingle();

  const asModuleRecord = (value: unknown): Record<string, boolean> | null =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, boolean>)
      : null;

  /**
   * OJO con el fallback: `tenant.modules` en un tenant fallback está VACÍO, y
   * vacío significa "todo activo" (ver moduleAvailability). Si la lectura falla
   * y caemos ahí, la pantalla pinta todo "Activo" y el próximo Guardar prende
   * secciones que el admin tenía apagadas. Por eso el fallback se usa solo
   * cuando la fila no trae módulos, y un ERROR de lectura se avisa en pantalla.
   */
  const modulesUnavailable = Boolean(modulesError);
  const modules: Record<string, boolean> =
    asModuleRecord(tenantRow?.modules) ?? tenant.modules;
  const modulesSoon: Record<string, boolean> =
    asModuleRecord(tenantRow?.modules_soon) ?? {};

  // --- Stats agregadas (counts head-only, la RLS acota igual) ---------------
  const countOf = async (
    query: PromiseLike<{ count: number | null }>,
  ): Promise<number> => (await query).count ?? 0;

  const [members, posts, published, pending, openReports, ...byKindCounts] =
    await Promise.all([
      countOf(
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId),
      ),
      countOf(
        supabase
          .from("posts")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("status", "published"),
      ),
      countOf(
        supabase
          .from("listings")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("status", "published"),
      ),
      countOf(
        supabase
          .from("listings")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("status", "pending_review"),
      ),
      countOf(
        supabase
          .from("scam_reports")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .in("status", ["open", "reviewing"]),
      ),
      ...LISTING_KINDS.map((kind) =>
        countOf(
          supabase
            .from("listings")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .eq("kind", kind)
            .eq("status", "published"),
        ),
      ),
    ]);

  // --- Avisos pending_review + reportes abiertos -----------------------------
  const [{ data: pendingListings }, { data: reports }] = await Promise.all([
    supabase
      .from("listings")
      .select("id, kind, title, description, area_label, price_amount, price_currency, price_period, photos, created_at")
      .eq("tenant_id", tenantId)
      .eq("status", "pending_review")
      .order("created_at", { ascending: true })
      .limit(20),
    supabase
      .from("scam_reports")
      .select("id, target_kind, target_id, reason, details, weight, created_at")
      .eq("tenant_id", tenantId)
      .in("status", ["open", "reviewing"])
      .order("created_at", { ascending: true })
      .limit(20),
  ]);

  // Etiquetas de los targets reportados (título del aviso / nombre del perfil).
  const targetLabels = new Map<string, string>();
  const reportedListings = (reports ?? [])
    .filter((r) => r.target_kind === "listing")
    .map((r) => r.target_id);
  const reportedProfiles = (reports ?? [])
    .filter((r) => r.target_kind === "profile")
    .map((r) => r.target_id);

  const [listingTargets, profileTargets] = await Promise.all([
    reportedListings.length
      ? supabase.from("listings").select("id, title").in("id", reportedListings)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    reportedProfiles.length
      ? supabase.from("profiles").select("id, display_name").in("id", reportedProfiles)
      : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
  ]);
  for (const row of listingTargets.data ?? []) targetLabels.set(`listing:${row.id}`, row.title);
  for (const row of profileTargets.data ?? [])
    targetLabels.set(`profile:${row.id}`, row.display_name);

  const stats: { label: string; value: number; alert?: boolean }[] = [
    { label: COPY.stats.members, value: members },
    { label: COPY.stats.posts, value: posts },
    { label: COPY.stats.published, value: published },
    { label: COPY.stats.pending, value: pending, alert: pending > 0 },
    { label: COPY.stats.reports, value: openReports, alert: openReports > 0 },
  ];

  const PERIOD_LABEL: Record<string, string> = {
    hour: "/hora",
    day: "/día",
    week: "/semana",
    month: "/mes",
    year: "/año",
    one_time: "",
  };

  const reviewItems: ListingReviewData[] = (pendingListings ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    areaLabel: row.area_label,
    price:
      typeof row.price_amount === "number"
        ? `${formatMoney(row.price_amount, { currency: row.price_currency })}${PERIOD_LABEL[row.price_period ?? ""] ?? ""}`
        : null,
    photosCount: Array.isArray(row.photos) ? row.photos.length : 0,
    createdAt: row.created_at,
  }));

  const reportItems: ScamReportData[] = (reports ?? []).map((row) => ({
    id: row.id,
    targetKind: row.target_kind,
    targetLabel:
      targetLabels.get(`${row.target_kind}:${row.target_id}`) ??
      COPY.targetFallback[row.target_kind] ??
      row.target_kind,
    reason: row.reason,
    details: row.details,
    weight: Number(row.weight),
    createdAt: row.created_at,
  }));

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="dominio-stats">
        <h2 id="dominio-stats" className="font-display text-2xl font-bold text-foreground">
          {COPY.title}
        </h2>
        <p className="mt-1 text-sm text-foreground-secondary">{COPY.statsIntro}</p>

        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border border-border bg-surface px-4 py-3 shadow-xs"
            >
              <dt className="text-xs text-foreground-muted">{stat.label}</dt>
              <dd
                className={`mt-0.5 text-2xl font-bold tabular-nums ${
                  stat.alert ? "text-warning-ink" : "text-foreground"
                }`}
              >
                {stat.value.toLocaleString("es-US")}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-3 flex flex-wrap gap-1.5" aria-label={COPY.byKindTitle}>
          {LISTING_KINDS.map((kind, index) => (
            <span
              key={kind}
              className="inline-flex items-center gap-1.5 rounded-full bg-surface-subtle px-2.5 py-1 text-xs text-foreground-secondary"
            >
              {COPY.kindLabel[kind]}
              <span className="font-semibold tabular-nums text-foreground">
                {byKindCounts[index]?.toLocaleString("es-US") ?? 0}
              </span>
            </span>
          ))}
        </div>
      </section>

      <section aria-labelledby="dominio-review" className="flex flex-col gap-3">
        <h2 id="dominio-review" className="font-display text-lg font-semibold text-foreground">
          {COPY.reviewTitle}
        </h2>
        {reviewItems.length === 0 ? (
          <EmptyState
            icon={<CheckSquareOffset />}
            title={COPY.reviewEmptyTitle}
            message={COPY.reviewEmptyMessage}
            className="py-8"
          />
        ) : (
          reviewItems.map((listing) => <ListingReviewItem key={listing.id} listing={listing} />)
        )}
      </section>

      <section aria-labelledby="dominio-reportes" className="flex flex-col gap-3">
        <h2 id="dominio-reportes" className="font-display text-lg font-semibold text-foreground">
          {COPY.reportsTitle}
        </h2>
        {reportItems.length === 0 ? (
          <EmptyState
            icon={<Flag />}
            title={COPY.reportsEmptyTitle}
            message={COPY.reportsEmptyMessage}
            className="py-8"
          />
        ) : (
          reportItems.map((report) => <ScamReportItem key={report.id} report={report} />)
        )}
      </section>

      <section aria-labelledby="dominio-modulos" className="flex flex-col gap-1">
        <h2 id="dominio-modulos" className="font-display text-lg font-semibold text-foreground">
          {COPY.modulesTitle}
        </h2>
        <p className="mb-3 text-sm text-foreground-secondary">{COPY.modulesIntro}</p>
        {modulesUnavailable && (
          <p role="alert" className="mb-3 text-sm text-warning-ink">
            {COPY.modulesUnavailable}
          </p>
        )}
        <ModuleToggles modules={modules} modulesSoon={modulesSoon} />
      </section>
    </div>
  );
}
