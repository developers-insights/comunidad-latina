import "server-only";

import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/types/database.types";

/**
 * Gate server-side de los paneles admin (§12).
 *
 * La fuente de verdad del rol es SIEMPRE el JWT (`user.app_metadata.role`),
 * jamás `profiles.role` (columna informativa). Igual que las policies de RLS,
 * que leen el mismo claim vía app.current_user_role().
 */

export type StaffRole = "moderator" | "domain_admin" | "global_admin";

const ROLE_RANK: Record<StaffRole, number> = {
  moderator: 1,
  domain_admin: 2,
  global_admin: 3,
};

export function isStaffRole(role: unknown): role is StaffRole {
  return role === "moderator" || role === "domain_admin" || role === "global_admin";
}

export function roleAtLeast(role: StaffRole, min: StaffRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export interface StaffContext {
  supabase: SupabaseClient<Database>;
  user: User;
  role: StaffRole;
  /** tenant_id del JWT — el tenant REAL del staff (no el del Host header). */
  tenantId: string | null;
}

/**
 * Verifica sesión + rol staff contra Supabase Auth (getUser revalida el token
 * contra el servidor, no confía en la cookie). Si el usuario no es staff del
 * nivel pedido, redirige — nunca renderiza nada del panel.
 */
export async function requireStaff(min: StaffRole = "moderator"): Promise<StaffContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/entrar");

  const role = user.app_metadata?.role;
  if (!isStaffRole(role)) redirect("/");
  if (!roleAtLeast(role, min)) redirect("/admin/moderacion");

  const tenantId =
    typeof user.app_metadata?.tenant_id === "string" ? user.app_metadata.tenant_id : null;

  return { supabase, user, role, tenantId };
}

/**
 * Variante para server actions: mismas verificaciones pero SIN redirect
 * (una action devuelve estado, no navega). Retorna null si no cumple.
 */
export async function getStaffContext(min: StaffRole = "moderator"): Promise<StaffContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;
  const role = user.app_metadata?.role;
  if (!isStaffRole(role) || !roleAtLeast(role, min)) return null;

  const tenantId =
    typeof user.app_metadata?.tenant_id === "string" ? user.app_metadata.tenant_id : null;

  return { supabase, user, role, tenantId };
}

/**
 * Registra una acción administrativa en audit_log.
 *
 * audit_log tiene INSERT bloqueado por RLS para JWT de usuario (append-only
 * vía service_role) → acá el admin client es el ÚNICO camino, y solo se llama
 * DESPUÉS de verificar el rol con getUser() (nunca antes).
 *
 * §5.4: meta jamás lleva contenido de mensajes, IPs ni user-agents — solo ids.
 * Best-effort: si el admin client no está configurado, loguea y sigue (la
 * acción de negocio ya está protegida por RLS; el panel nunca rompe).
 */
export async function logAdminAction(input: {
  actorId: string;
  action: string;
  tenantId?: string | null;
  subjectKind?: string | null;
  subjectId?: string | null;
  meta?: Record<string, Json>;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("audit_log").insert({
      actor_id: input.actorId,
      action: input.action,
      tenant_id: input.tenantId ?? null,
      subject_kind: input.subjectKind ?? null,
      subject_id: input.subjectId ?? null,
      meta: (input.meta ?? {}) as Json,
    });
    if (error) {
      console.error("[admin] audit_log falló:", error.message);
    }
  } catch (error) {
    console.error(
      "[admin] audit_log no disponible:",
      error instanceof Error ? error.message : "error desconocido",
    );
  }
}
