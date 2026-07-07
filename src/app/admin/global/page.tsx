import { Badge, BezelCard } from "@/components/ui";
import { CreateTenantForm } from "@/components/admin/create-tenant-form";
import { BroadcastForm, type BroadcastTenantOption } from "@/components/admin/broadcast-form";
import { requireStaff } from "../guard";

export const metadata = { title: "Global" };

/**
 * Panel Global (SOLO global_admin): tabla de tenants con stats cross-tenant,
 * alta de tenant con preview del pipeline de marca y compositor de Broadcast.
 *
 * Lecturas cross-tenant con el cliente del usuario: las policies de tenants /
 * tenant_domains / profiles / listings ya le dan a global_admin (o al público)
 * el SELECT necesario — no hace falta service_role para mirar.
 */

const COPY = {
  title: "Plataforma",
  intro: "Todas las comunidades, de un vistazo. Acá se fundan y se les habla.",
  table: {
    name: "Comunidad",
    domain: "Dominio",
    members: "Miembros",
    listings: "Avisos",
    status: "Estado",
  },
  statusLabel: {
    active: "Activa",
    paused: "Pausada",
  } as Record<string, string>,
  createTitle: "Crear comunidad",
  broadcastTitle: "Broadcast global",
  empty: "Todavía no hay comunidades — creá la primera acá abajo.",
} as const;

export default async function GlobalPage() {
  const { supabase } = await requireStaff("global_admin");

  const [{ data: tenants }, { data: domains }] = await Promise.all([
    supabase
      .from("tenants")
      .select("id, name, slug, status, created_at")
      .order("created_at", { ascending: true }),
    supabase.from("tenant_domains").select("tenant_id, domain, is_primary"),
  ]);

  const tenantRows = tenants ?? [];

  // Stats por tenant (counts head-only; pocos tenants → pocas queries).
  const stats = await Promise.all(
    tenantRows.map(async (tenant) => {
      const [members, listings] = await Promise.all([
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id),
        supabase
          .from("listings")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id)
          .eq("status", "published"),
      ]);
      return {
        id: tenant.id,
        members: members.count ?? 0,
        listings: listings.count ?? 0,
      };
    }),
  );
  const statsById = new Map(stats.map((s) => [s.id, s]));

  const primaryDomain = new Map<string, string>();
  for (const row of domains ?? []) {
    if (row.is_primary || !primaryDomain.has(row.tenant_id)) {
      primaryDomain.set(row.tenant_id, row.domain);
    }
  }

  const options: BroadcastTenantOption[] = tenantRows
    .filter((t) => t.status === "active")
    .map((t) => ({ id: t.id, name: t.name, slug: t.slug }));

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="global-tenants">
        <h2 id="global-tenants" className="font-display text-2xl font-bold text-foreground">
          {COPY.title}
        </h2>
        <p className="mt-1 text-sm text-foreground-secondary">{COPY.intro}</p>

        <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface shadow-xs">
          {tenantRows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-foreground-secondary">
              {COPY.empty}
            </p>
          ) : (
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs text-foreground-muted">
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    {COPY.table.name}
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    {COPY.table.domain}
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    {COPY.table.members}
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    {COPY.table.listings}
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    {COPY.table.status}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {tenantRows.map((tenant) => {
                  const stat = statsById.get(tenant.id);
                  return (
                    <tr key={tenant.id}>
                      <td className="px-4 py-3">
                        <span className="block font-medium text-foreground">{tenant.name}</span>
                        <span className="block font-mono text-xs text-foreground-muted">
                          {tenant.slug}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-foreground-secondary">
                        {primaryDomain.get(tenant.id) ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">
                        {(stat?.members ?? 0).toLocaleString("es-US")}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">
                        {(stat?.listings ?? 0).toLocaleString("es-US")}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={tenant.status === "active" ? "success" : "neutral"}>
                          {COPY.statusLabel[tenant.status] ?? tenant.status}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section aria-labelledby="global-crear">
        <h2 id="global-crear" className="font-display text-lg font-semibold text-foreground">
          {COPY.createTitle}
        </h2>
        <BezelCard variant="featured" className="mt-3">
          <CreateTenantForm />
        </BezelCard>
      </section>

      <section aria-labelledby="global-broadcast">
        <h2 id="global-broadcast" className="font-display text-lg font-semibold text-foreground">
          {COPY.broadcastTitle}
        </h2>
        <BezelCard className="mt-3">
          <BroadcastForm tenants={options} />
        </BezelCard>
      </section>
    </div>
  );
}
