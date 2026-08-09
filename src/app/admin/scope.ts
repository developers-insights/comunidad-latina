import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import type { StaffContext, StaffRole } from "./guard";

/**
 * ALCANCE DE COMUNIDAD DEL PANEL — quién puede mirar qué, resuelto EN EL SERVER.
 *
 * El pliego pide que el súper admin pueda elegir sobre qué comunidad está
 * operando desde Miembros / Dominio / Empleos. Eso es, literalmente, dejar que
 * un parámetro de la URL cambie el tenant de una consulta — el camino más corto
 * a una fuga cross-tenant si se hace mal.
 *
 * CÓMO SE EVITA (tres candados, ninguno cosmético)
 * ------------------------------------------------
 *  1. EL ROL NO VIENE DE LA URL NI DE UNA COOKIE. Viene de `requireStaff()` /
 *     `getStaffContext()`, que llaman a `supabase.auth.getUser()` — o sea que
 *     el token se revalida contra Supabase Auth EN CADA REQUEST. No existe
 *     ningún estado "estoy mirando la comunidad X" guardado del lado del
 *     cliente: si no se manda el parámetro, no hay cambio de contexto.
 *  2. EL PARÁMETRO SE IGNORA SI NO SOS `global_admin`. No se "rechaza con un
 *     error" ni se esconde el control: para cualquier otro rol el tenant
 *     efectivo ES el del JWT, punto (`effectiveTenantId`). Un `domain_admin`
 *     que escriba `?comunidad=<uuid ajeno>` a mano ve exactamente su propia
 *     comunidad, como si no hubiera escrito nada.
 *  3. LA BASE VUELVE A DECIDIR. Las policies de `listings`, `posts`,
 *     `scam_reports` y compañía tienen rama `app.is_global_admin()`; el resto
 *     de los roles quedan acotados a `app.current_tenant_id()`, que sale del
 *     mismo claim del JWT. Aunque los dos candados de arriba fallaran, la
 *     consulta cross-tenant de un `domain_admin` devuelve vacío.
 *
 * Y para ESCRITURAS existe `canWriteTenant()`, que toda server action del panel
 * llama antes de tocar nada. Ahí la regla es la misma, sin el fallback amable:
 * o sos global_admin, o el tenant destino es el tuyo.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Nombre del parámetro de URL con el que se cambia de comunidad. */
export const COMMUNITY_PARAM = "comunidad";

export interface CommunityOption {
  id: string;
  name: string;
  slug: string;
  /** `tenants.status`: 'active' | 'paused'. */
  status: string;
}

export interface AdminScope {
  /** Comunidad que se está mirando. `null` = el staff no tiene ninguna. */
  tenantId: string | null;
  tenantName: string | null;
  /** true solo para `global_admin`: es quien puede cambiar de comunidad. */
  canSwitch: boolean;
  /** true cuando el súper admin está mirando una comunidad que no es la suya. */
  isForeign: boolean;
  /** Vacío para todo el que no puede cambiar — no se filtra ni la lista. */
  communities: CommunityOption[];
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Primer valor de un searchParam (Next entrega `string | string[] | undefined`). */
export function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.length > 0 ? raw : null;
}

/**
 * LA REGLA, sin I/O y por eso testeable sola.
 *
 * `requested` es dato del usuario (URL). Para todo rol que no sea global_admin
 * se descarta ENTERO — ni siquiera se compara. Para el global_admin se acepta
 * únicamente si es una comunidad que existe: un uuid con forma válida pero
 * inventado no puede convertirse en un filtro `tenant_id` arbitrario.
 */
export function effectiveTenantId(input: {
  role: StaffRole;
  jwtTenantId: string | null;
  requested: string | null;
  knownTenantIds: readonly string[];
}): string | null {
  if (input.role !== "global_admin") return input.jwtTenantId;

  if (input.requested && isUuid(input.requested) && input.knownTenantIds.includes(input.requested)) {
    return input.requested;
  }
  if (input.jwtTenantId && input.knownTenantIds.includes(input.jwtTenantId)) {
    return input.jwtTenantId;
  }
  // Un súper admin sin tenant propio (o con uno borrado) igual necesita mirar
  // algo: la primera comunidad de la lista. Nunca un uuid que vino de afuera.
  return input.knownTenantIds[0] ?? input.jwtTenantId ?? null;
}

/**
 * ¿Puede este staff ESCRIBIR sobre `targetTenantId`?
 *
 * Sin fallback y sin cortesías: si el tenant destino no es el propio y no sos
 * global_admin, es `false`. La llaman las server actions ANTES de tocar la
 * base — el UI que esconde el botón es una comodidad, esto es el permiso.
 */
export function canWriteTenant(
  actor: { role: StaffRole; tenantId: string | null },
  targetTenantId: string | null,
): targetTenantId is string {
  if (!isUuid(targetTenantId)) return false;
  if (actor.role === "global_admin") return true;
  return actor.tenantId !== null && actor.tenantId === targetTenantId;
}

/** Todas las comunidades, para el selector. Solo se pide si el rol lo habilita. */
export async function listCommunities(
  supabase: SupabaseClient<Database>,
): Promise<CommunityOption[]> {
  const { data } = await supabase
    .from("tenants")
    .select("id, name, slug, status")
    .order("created_at", { ascending: true });
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
  }));
}

/**
 * Resuelve el alcance de la pantalla. Se llama DESPUÉS de `requireStaff()`,
 * nunca antes: el rol que entra acá ya fue verificado contra Supabase Auth.
 */
export async function resolveAdminScope(
  ctx: StaffContext,
  requested: string | null,
): Promise<AdminScope> {
  const canSwitch = ctx.role === "global_admin";

  if (!canSwitch) {
    return {
      tenantId: ctx.tenantId,
      tenantName: null,
      canSwitch: false,
      isForeign: false,
      communities: [],
    };
  }

  const communities = await listCommunities(ctx.supabase);
  const tenantId = effectiveTenantId({
    role: ctx.role,
    jwtTenantId: ctx.tenantId,
    requested,
    knownTenantIds: communities.map((community) => community.id),
  });

  return {
    tenantId,
    tenantName: communities.find((community) => community.id === tenantId)?.name ?? null,
    canSwitch: true,
    isForeign: tenantId !== null && tenantId !== ctx.tenantId,
    communities,
  };
}
