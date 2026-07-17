import { MagnifyingGlass, UsersThree } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import { MemberRow, type MemberRowData } from "@/components/admin/member-row";
import { getTenant } from "@/lib/tenant/resolve";
import { requireStaff } from "../guard";

export const metadata = { title: "Miembros" };

/**
 * Panel de Miembros (§8/§12, moderator+): quién está en la comunidad, su
 * estado de cuenta y cuántos reportes abiertos tiene encima — con las
 * acciones de sanción (suspender/dar de baja/reactivar) a un tap.
 *
 * Lectura con el cliente del staff: profiles es de lectura pública (§0003,
 * `using (true)`) así que no hace falta el admin client acá — solo se filtra
 * SIEMPRE por el tenant del JWT, nunca por el Host header (mismo patrón que
 * /admin/dominio).
 */

const COPY = {
  title: "Miembros",
  intro: "Quién está en tu comunidad — estado de cuenta y reportes abiertos, todo en un lugar.",
  searchLabel: "Buscar por nombre",
  searchPlaceholder: "Nombre del miembro…",
  searchSubmit: "Buscar",
  emptyTitleSearch: "Sin resultados",
  emptyMessageSearch: "No encontramos a nadie con ese nombre — probá con otra búsqueda.",
  emptyTitle: "Sin miembros todavía",
  emptyMessage: "Todavía no hay miembros en tu comunidad.",
  count: (n: number) => (n === 1 ? "1 miembro" : `${n} miembros`),
} as const;

const PAGE_SIZE = 40;

export default async function MiembrosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { supabase, tenantId: jwtTenantId, role: staffRole } = await requireStaff("moderator");
  const tenant = await getTenant();
  // El tenant REAL del staff es el del JWT (el Host header es cosmético acá).
  const tenantId = jwtTenantId ?? tenant.id;
  const { q } = await searchParams;
  const query = (q ?? "").trim().slice(0, 120);

  let profilesQuery = supabase
    .from("profiles")
    .select("id, display_name, avatar_url, role, account_status, suspended_until, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (query) {
    profilesQuery = profilesQuery.ilike("display_name", `%${query}%`);
  }

  const { data: rows } = await profilesQuery;
  const profiles = rows ?? [];

  // Reportes ABIERTOS contra cada perfil listado — una sola query, no una por
  // fila. Se cuenta por DENUNCIANTE ÚNICO: un solo actor mandando 20 reportes
  // no infla la señal que el staff usa para sancionar (review adversarial).
  const profileIds = profiles.map((row) => row.id);
  const reportCounts = new Map<string, number>();
  if (profileIds.length > 0) {
    const { data: reports } = await supabase
      .from("scam_reports")
      .select("target_id, reporter_id")
      .eq("tenant_id", tenantId)
      .eq("target_kind", "profile")
      .eq("status", "open")
      .in("target_id", profileIds);
    const uniquePairs = new Set<string>();
    for (const report of reports ?? []) {
      const pairKey = `${report.target_id}:${report.reporter_id ?? "anon"}`;
      if (uniquePairs.has(pairKey)) continue;
      uniquePairs.add(pairKey);
      reportCounts.set(report.target_id, (reportCounts.get(report.target_id) ?? 0) + 1);
    }
  }

  const members: MemberRowData[] = profiles.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role,
    accountStatus:
      row.account_status === "suspended" || row.account_status === "banned"
        ? row.account_status
        : "active",
    suspendedUntil: row.suspended_until,
    openReports: reportCounts.get(row.id) ?? 0,
  }));

  return (
    <section aria-labelledby="miembros-title" className="flex flex-col gap-4">
      <header>
        <h2 id="miembros-title" className="font-display text-2xl font-bold text-foreground">
          {COPY.title}
        </h2>
        <p className="mt-1 text-sm text-foreground-secondary">{COPY.intro}</p>
        {members.length > 0 && (
          <p className="mt-2 text-xs font-medium tabular-nums text-foreground-muted">
            {COPY.count(members.length)}
          </p>
        )}
      </header>

      <form method="GET" className="flex gap-2">
        <label htmlFor="miembros-q" className="sr-only">
          {COPY.searchLabel}
        </label>
        <div className="relative flex-1">
          <MagnifyingGlass
            size={18}
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-muted"
          />
          <input
            id="miembros-q"
            type="search"
            name="q"
            defaultValue={query}
            placeholder={COPY.searchPlaceholder}
            className="h-11 w-full rounded-md border border-border bg-surface pl-10 pr-4 text-base text-foreground placeholder:text-placeholder transition-[border-color,box-shadow] duration-(--duration-fast) ease-(--ease-out-premium) hover:border-border-strong focus-visible:border-brand focus-visible:outline-none"
          />
        </div>
        <button
          type="submit"
          className="flex h-11 shrink-0 items-center rounded-md bg-surface-subtle px-4 text-sm font-medium text-foreground transition-colors duration-(--duration-fast) hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
        >
          {COPY.searchSubmit}
        </button>
      </form>

      {members.length === 0 ? (
        <EmptyState
          icon={<UsersThree />}
          title={query ? COPY.emptyTitleSearch : COPY.emptyTitle}
          message={query ? COPY.emptyMessageSearch : COPY.emptyMessage}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {members.map((member) => (
            <MemberRow key={member.id} member={member} staffRole={staffRole} />
          ))}
        </div>
      )}
    </section>
  );
}
