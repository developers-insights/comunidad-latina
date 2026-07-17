"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStaffContext, logAdminAction } from "../guard";

/**
 * Server actions de sanciones de cuenta (§12/§8): suspender, dar de baja y
 * reactivar miembros. Las RPCs (0021_account_sanctions.sql) son SECURITY
 * DEFINER y validan el rol del staff contra el claim del JWT internamente
 * (app.is_staff() / app.current_user_role()) — por eso van con el CLIENTE
 * DEL STAFF (supabase.rpc), no con el admin client. getStaffContext() acá es
 * una segunda barrera (UX temprana, mismo patrón que moderacion/dominio):
 * la autorización real vive en la función de Postgres.
 *
 * Excepción: banUserAction/reactivateUserAction TAMBIÉN tocan Supabase Auth
 * (bloquear/desbloquear el login en sí, no solo el estado de la fila) — eso
 * requiere el admin client, gateado por el rol ya verificado arriba y
 * envuelto en try/catch: si falla, la sanción en DB ya rige por los
 * triggers app.enforce_account_active (no publica ni manda mensajes), así
 * que el panel nunca se rompe por un login que quedó sin banear.
 */

const COPY = {
  notModerator: "Tu sesión no tiene permisos de moderación. Entrá de nuevo e intentá otra vez.",
  notDomainAdmin:
    "Dar de baja una cuenta necesita permisos de administración del dominio.",
  invalid: "No pudimos leer los datos — recargá la página e intentá de nuevo.",
  reasonRequired: "Contanos el motivo de la sanción antes de confirmar.",
  cannotSanctionStaff: "No podés sancionar a alguien del equipo desde acá.",
  profileNotFound: "Ese perfil ya no está en tu comunidad — la lista se actualizó.",
  genericError: "No pudimos guardar el cambio — no es tu culpa. Probá de nuevo en un momento.",
} as const;

export type MemberActionResult = { ok: true } | { ok: false; message: string };

/** Traduce las excepciones de las RPCs admin_* (mensaje `CODE: detalle…') a copy. */
function messageFromRpcError(error: { message: string }): string {
  const msg = error.message;
  if (msg.includes("CANNOT_SANCTION_STAFF")) return COPY.cannotSanctionStaff;
  if (msg.includes("PROFILE_NOT_FOUND")) return COPY.profileNotFound;
  if (msg.includes("REASON_REQUIRED")) return COPY.reasonRequired;
  if (msg.includes("FORBIDDEN") || msg.includes("AUTH_REQUIRED")) return COPY.notModerator;
  return COPY.genericError;
}

/* ------------------------------- Suspender -------------------------------- */

const suspendSchema = z.object({
  profileId: z.uuid(),
  days: z.union([z.literal(7), z.literal(30)]),
  reason: z.string().trim().min(5, COPY.reasonRequired).max(500),
});

export type SuspendUserInput = z.infer<typeof suspendSchema>;

export async function suspendUserAction(input: SuspendUserInput): Promise<MemberActionResult> {
  const parsed = suspendSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? COPY.invalid };
  }
  const { profileId, days, reason } = parsed.data;

  const ctx = await getStaffContext("moderator");
  if (!ctx) return { ok: false, message: COPY.notModerator };
  const { supabase, user, tenantId } = ctx;

  const { error } = await supabase.rpc("admin_suspend_user", {
    p_profile_id: profileId,
    p_days: days,
    p_reason: reason,
  });

  if (error) {
    console.error("[admin] admin_suspend_user falló:", error.message);
    return { ok: false, message: messageFromRpcError(error) };
  }

  await logAdminAction({
    actorId: user.id,
    action: "member.suspended",
    tenantId,
    subjectKind: "profile",
    subjectId: profileId,
    meta: { days },
  });

  revalidatePath("/admin/miembros");
  return { ok: true };
}

/* ------------------------------- Dar de baja ------------------------------- */

const banSchema = z.object({
  profileId: z.uuid(),
  reason: z.string().trim().min(5, COPY.reasonRequired).max(500),
});

export type BanUserInput = z.infer<typeof banSchema>;

export async function banUserAction(input: BanUserInput): Promise<MemberActionResult> {
  const parsed = banSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? COPY.invalid };
  }
  const { profileId, reason } = parsed.data;

  const ctx = await getStaffContext("domain_admin");
  if (!ctx) return { ok: false, message: COPY.notDomainAdmin };
  const { supabase, user, tenantId } = ctx;

  const { error } = await supabase.rpc("admin_ban_user", {
    p_profile_id: profileId,
    p_reason: reason,
  });

  if (error) {
    console.error("[admin] admin_ban_user falló:", error.message);
    return { ok: false, message: messageFromRpcError(error) };
  }

  // Bloquea el login en sí (la baja en DB ya rige vía triggers aunque esto
  // falle — ver nota del módulo).
  try {
    const admin = createAdminClient();
    const { error: authError } = await admin.auth.admin.updateUserById(profileId, {
      ban_duration: "87600h",
    });
    if (authError) {
      console.warn("[admin] no se pudo banear el login (la baja en DB ya rige):", authError.message);
    }
  } catch (authException) {
    console.warn(
      "[admin] admin client no disponible al banear el login (la baja en DB ya rige):",
      authException instanceof Error ? authException.message : "error desconocido",
    );
  }

  await logAdminAction({
    actorId: user.id,
    action: "member.banned",
    tenantId,
    subjectKind: "profile",
    subjectId: profileId,
  });

  revalidatePath("/admin/miembros");
  return { ok: true };
}

/* ------------------------------- Reactivar --------------------------------- */

const reactivateSchema = z.object({ profileId: z.uuid() });

export type ReactivateUserInput = z.infer<typeof reactivateSchema>;

export async function reactivateUserAction(
  input: ReactivateUserInput,
): Promise<MemberActionResult> {
  const parsed = reactivateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: COPY.invalid };
  const { profileId } = parsed.data;

  const ctx = await getStaffContext("moderator");
  if (!ctx) return { ok: false, message: COPY.notModerator };
  const { supabase, user, tenantId } = ctx;

  const { error } = await supabase.rpc("admin_reactivate_user", {
    p_profile_id: profileId,
  });

  if (error) {
    console.error("[admin] admin_reactivate_user falló:", error.message);
    return { ok: false, message: messageFromRpcError(error) };
  }

  // Desbanea el login en sí (best-effort: si no había ban de Auth —p. ej.
  // venía de una suspensión, no de una baja— esto es un no-op inofensivo).
  try {
    const admin = createAdminClient();
    const { error: authError } = await admin.auth.admin.updateUserById(profileId, {
      ban_duration: "none",
    });
    if (authError) {
      console.warn(
        "[admin] no se pudo desbanear el login (el estado en DB ya rige):",
        authError.message,
      );
    }
  } catch (authException) {
    console.warn(
      "[admin] admin client no disponible al desbanear el login (el estado en DB ya rige):",
      authException instanceof Error ? authException.message : "error desconocido",
    );
  }

  await logAdminAction({
    actorId: user.id,
    action: "member.reactivated",
    tenantId,
    subjectKind: "profile",
    subjectId: profileId,
  });

  revalidatePath("/admin/miembros");
  return { ok: true };
}
