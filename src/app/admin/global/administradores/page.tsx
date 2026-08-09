import { MagnifyingGlass, UserGear, UsersThree } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import { CommunitySwitcher } from "@/components/admin/community-switcher";
import {
  StaffRoleActions,
  type StaffPersonRow,
} from "@/components/admin/staff-role-actions";
import { formatDate } from "@/lib/utils";
import { requireStaff } from "../../guard";
import { COMMUNITY_PARAM, firstParam, resolveAdminScope } from "../../scope";
import { STAFF_ROLES, type AssignableRole } from "./staff-roles";

export const metadata = { title: "Administradores" };

/**
 * Administradores locales de una comunidad (solo `global_admin`).
 *
 * Resuelve el pendiente del pliego: hasta acá, la única forma de darle a
 * alguien el rol de su comunidad era al momento de crearla (formulario o
 * `scripts/new-tenant.mjs`). Ahora se puede después, sobre alguien que ya es
 * parte de esa comunidad.
 *
 * POR QUÉ SOLO SE PROMUEVE A QUIEN YA ESTÁ ADENTRO: el rol viaja en el JWT
 * junto al tenant, así que "hacer administradora de la comunidad A" a una
 * cuenta de la comunidad B sería, en los hechos, mudarla de comunidad. Eso no
 * es un permiso, es otra operación — y una que el trigger
 * `app.protect_profile_columns` bloquea a propósito.
 *
 * NO HAY EMAILS EN ESTA PANTALLA. Se identifica a la persona por su nombre,
 * avatar y fecha de ingreso, igual que en el resto del panel: el producto se
 * construyó anti-honeypot (§5.4) y una lista de correos del staff sería
 * exactamente el dato que decidimos no juntar en una pantalla.
 */

const COPY = {
  title: "Administradores",
  intro:
    "Quién puede entrar al panel de cada comunidad. Elegí la comunidad arriba y sumá o sacá permisos.",
  teamTitle: "Equipo de esta comunidad",
  teamEmptyTitle: "Todavía no hay equipo",
  teamEmptyMessage:
    "Nadie administra ni modera esta comunidad además de vos. Buscá a alguien acá abajo y dale permisos.",
  addTitle: "Sumar a alguien",
  addIntro:
    "Buscá por nombre entre los miembros de esta comunidad. Solo aparecen personas que ya tienen cuenta acá.",
  searchLabel: "Buscar por nombre",
  searchPlaceholder: "Nombre de la persona…",
  searchSubmit: "Buscar",
  searchEmptyTitle: "Sin resultados",
  searchEmptyMessage: "No encontramos a nadie con ese nombre en esta comunidad.",
  searchIdleTitle: "Escribí un nombre",
  searchIdleMessage:
    "La lista de miembros puede ser larga, así que se busca en vez de mostrarla entera.",
  noCommunity: "Elegí una comunidad arriba para ver su equipo.",
  syncNote:
    "El permiso real viaja en la sesión de cada persona: si alguien está con la app abierta, lo ve al volver a entrar.",
} as const;

const PAGE_SIZE = 20;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdministradoresPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const ctx = await requireStaff("global_admin");
  const sp = await searchParams;
  const scope = await resolveAdminScope(ctx, firstParam(sp[COMMUNITY_PARAM]));
  const query = (firstParam(sp.q) ?? "").trim().slice(0, 120);
  const { supabase } = ctx;

  const tenantId = scope.tenantId;

  const [{ data: staffRows }, { data: candidates }] = await Promise.all([
    tenantId
      ? supabase
          .from("profiles")
          .select("id, display_name, avatar_url, role, created_at")
          .eq("tenant_id", tenantId)
          .in("role", [...STAFF_ROLES])
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: null }),
    tenantId && query
      ? supabase
          .from("profiles")
          .select("id, display_name, avatar_url, role, created_at")
          .eq("tenant_id", tenantId)
          .eq("role", "member")
          .ilike("display_name", `%${query}%`)
          .order("created_at", { ascending: false })
          .limit(PAGE_SIZE)
      : Promise.resolve({ data: null }),
  ]);

  const toRow = (row: {
    id: string;
    display_name: string;
    avatar_url: string | null;
    role: string;
    created_at: string;
  }): StaffPersonRow => ({
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role,
    joinedLabel: formatDate(row.created_at, { style: "long" }),
  });

  const team = (staffRows ?? []).map(toRow);
  const found = (candidates ?? []).map(toRow);

  /** Qué se le puede ofrecer a alguien según lo que ya tiene. */
  const offerFor = (role: string): AssignableRole[] =>
    role === "domain_admin"
      ? ["moderator", "member"]
      : role === "moderator"
        ? ["domain_admin", "member"]
        : ["domain_admin", "moderator"];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-foreground">{COPY.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">{COPY.intro}</p>
        </div>
        <CommunitySwitcher
          basePath="/admin/global/administradores"
          communities={scope.communities}
          activeTenantId={tenantId}
          isForeign={false}
          keep={{ q: query || undefined }}
        />
      </header>

      {!tenantId ? (
        <EmptyState icon={<UserGear />} title={COPY.noCommunity} message={COPY.intro} />
      ) : (
        <>
          <section aria-labelledby="staff-equipo" className="flex flex-col gap-3">
            <div>
              <h3
                id="staff-equipo"
                className="font-display text-lg font-semibold text-foreground"
              >
                {COPY.teamTitle}
              </h3>
              <p className="mt-1 text-xs text-foreground-muted">{COPY.syncNote}</p>
            </div>

            {team.length === 0 ? (
              <EmptyState
                icon={<UserGear />}
                title={COPY.teamEmptyTitle}
                message={COPY.teamEmptyMessage}
                className="py-8"
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {team.map((person) => (
                  <StaffRoleActions
                    key={person.id}
                    person={person}
                    tenantId={tenantId}
                    offer={offerFor(person.role)}
                  />
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="staff-sumar" className="flex flex-col gap-3">
            <div>
              <h3 id="staff-sumar" className="font-display text-lg font-semibold text-foreground">
                {COPY.addTitle}
              </h3>
              <p className="mt-1 text-sm text-foreground-secondary">{COPY.addIntro}</p>
            </div>

            <form method="GET" className="flex gap-2">
              <input type="hidden" name={COMMUNITY_PARAM} value={tenantId} />
              <label htmlFor="staff-q" className="sr-only">
                {COPY.searchLabel}
              </label>
              <div className="relative flex-1">
                <MagnifyingGlass
                  size={18}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-muted"
                />
                <input
                  id="staff-q"
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

            {!query ? (
              <EmptyState
                icon={<UsersThree />}
                title={COPY.searchIdleTitle}
                message={COPY.searchIdleMessage}
                className="py-8"
              />
            ) : found.length === 0 ? (
              <EmptyState
                icon={<UsersThree />}
                title={COPY.searchEmptyTitle}
                message={COPY.searchEmptyMessage}
                className="py-8"
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {found.map((person) => (
                  <StaffRoleActions
                    key={person.id}
                    person={person}
                    tenantId={tenantId}
                    offer={offerFor(person.role)}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
