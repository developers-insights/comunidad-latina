import { Globe } from "@phosphor-icons/react/dist/ssr";
import { Badge, EmptyState } from "@/components/ui";
import {
  DomainAddForm,
  DomainRow,
  type AdminDomainRow,
} from "@/components/admin/domain-manager";
import { requireStaff } from "../../guard";

export const metadata = { title: "Dominios" };

/**
 * Gestión de dominios por comunidad (solo `global_admin`).
 *
 * Es la pantalla que faltaba para cumplir el pliego: "agregar un dominio" y
 * "activar, suspender o archivar un dominio" ya existían en la base desde la
 * migración 0060, pero no había forma de tocarlos sin entrar a Supabase.
 *
 * Lectura con el cliente del usuario: `tenant_domains` es de lectura pública
 * (el middleware resuelve Host→tenant antes de que exista una sesión), así que
 * acá no hace falta ningún privilegio extra para MIRAR. Escribir sí es
 * exclusivo de `global_admin`, y eso lo garantizan las policies, no la
 * pantalla.
 */

const COPY = {
  title: "Dominios",
  intro:
    "Cada comunidad puede tener varias direcciones. La principal es con la que se muestra y se comparte; las demás funcionan igual, como alias.",
  emptyTitle: "Todavía no hay comunidades",
  emptyMessage: "Creá la primera desde Resumen y volvé acá para darle su dirección.",
  noDomainsTitle: "Sin dirección propia",
  noDomainsMessage:
    "Esta comunidad todavía se entra por el dominio compartido. Cargá la suya acá abajo.",
  addTitle: "Sumar una dirección",
  paused: "Pausada",
  reminder:
    "Cargar el dominio acá es el paso de la app. Para que la dirección responda de verdad falta apuntar el DNS y darla de alta en el hosting — eso se hace afuera, una sola vez por dominio.",
} as const;

export default async function DominiosPage() {
  const { supabase } = await requireStaff("global_admin");

  const [{ data: tenants }, { data: domains }] = await Promise.all([
    supabase
      .from("tenants")
      .select("id, name, slug, status")
      .order("created_at", { ascending: true }),
    supabase
      .from("tenant_domains")
      .select("id, tenant_id, domain, status, is_primary, notes")
      .order("is_primary", { ascending: false })
      .order("domain", { ascending: true }),
  ]);

  const tenantRows = tenants ?? [];
  const byTenant = new Map<string, AdminDomainRow[]>();
  for (const row of domains ?? []) {
    const list = byTenant.get(row.tenant_id) ?? [];
    list.push({
      id: row.id,
      domain: row.domain,
      status: row.status,
      isPrimary: row.is_primary,
      notes: row.notes,
    });
    byTenant.set(row.tenant_id, list);
  }

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h2 className="font-display text-2xl font-bold text-foreground">{COPY.title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">{COPY.intro}</p>
        <p className="mt-3 rounded-md border border-border-subtle bg-surface-subtle px-3 py-2 text-xs leading-relaxed text-foreground-secondary">
          {COPY.reminder}
        </p>
      </header>

      {tenantRows.length === 0 ? (
        <EmptyState icon={<Globe />} title={COPY.emptyTitle} message={COPY.emptyMessage} />
      ) : (
        tenantRows.map((tenant) => {
          const list = byTenant.get(tenant.id) ?? [];
          return (
            <section
              key={tenant.id}
              aria-labelledby={`dominios-${tenant.id}`}
              className="flex flex-col gap-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3
                  id={`dominios-${tenant.id}`}
                  className="font-display text-lg font-semibold text-foreground"
                >
                  {tenant.name}
                </h3>
                <span className="font-mono text-xs text-foreground-muted">{tenant.slug}</span>
                {tenant.status !== "active" && <Badge variant="neutral">{COPY.paused}</Badge>}
              </div>

              {list.length === 0 ? (
                <EmptyState
                  icon={<Globe />}
                  title={COPY.noDomainsTitle}
                  message={COPY.noDomainsMessage}
                  className="py-6"
                />
              ) : (
                <ul className="flex flex-col gap-2">
                  {list.map((domain) => (
                    <DomainRow key={domain.id} domain={domain} />
                  ))}
                </ul>
              )}

              <details className="rounded-lg border border-border-subtle bg-surface-subtle px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium text-foreground-secondary transition-colors duration-(--duration-fast) hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring">
                  {COPY.addTitle}
                </summary>
                <div className="mt-3">
                  <DomainAddForm tenantId={tenant.id} />
                </div>
              </details>
            </section>
          );
        })
      )}
    </div>
  );
}
