"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DAY_MS, limit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionResult } from "@/components/auth/action-result";

const COPY = {
  nameShort: "Contanos cómo te llamás (al menos 2 letras).",
  nameLong: "El nombre es muy largo — probá con una versión más corta.",
  bioLong: "La bio es muy larga — el máximo son 500 caracteres.",
  areaLong: "La zona es muy larga — con el barrio alcanza.",
  noSession: "Tu sesión se cerró — entrá de nuevo para continuar.",
  genericError:
    "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo en un momento.",
  reportDetailsLong: "El detalle es muy largo — el máximo son 500 caracteres.",
  tooManyReports:
    "Hiciste varios reportes hoy y ya los estamos mirando. Volvé mañana si necesitás sumar otro — así el equipo llega a revisarlos bien.",
  businessAccountBlocked:
    "Tenés un negocio activo en la plataforma — antes de eliminar tu cuenta hay que dar de baja esa suscripción. Escribinos a hola@comunidadlatina.com y te ayudamos a resolverlo.",
} as const;

function firstIssuePerField(issues: z.core.$ZodIssue[]): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

// ---------------------------------------------------------------------------
// Editar perfil propio (RLS: solo el dueño puede tocar su fila).
// ---------------------------------------------------------------------------

const updateProfileSchema = z.object({
  displayName: z.string().trim().min(2, COPY.nameShort).max(60, COPY.nameLong),
  bio: z.string().trim().max(500, COPY.bioLong),
  area: z.string().trim().max(80, COPY.areaLong),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export async function updateProfileAction(
  input: UpdateProfileInput,
): Promise<ActionResult> {
  const parsed = updateProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: firstIssuePerField(parsed.error.issues) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, formError: COPY.noSession };

  const { displayName, bio, area } = parsed.data;
  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: displayName,
      bio: bio || null,
      area_label: area || null,
    })
    .eq("id", user.id);

  if (error) {
    console.error("[perfil] update falló", { code: error.code });
    return { ok: false, formError: COPY.genericError };
  }

  revalidatePath("/perfil");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Cerrar sesión.
// ---------------------------------------------------------------------------

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/entrar");
}

// ---------------------------------------------------------------------------
// Eliminar cuenta — minimización real (§ anti-honeypot): borra el auth user
// vía admin y el cascade de la DB (0015) se lleva todo lo demás en Postgres.
// El admin client acá es legítimo: solo actúa sobre el usuario autenticado de
// la sesión actual.
//
// Storage vive FUERA de Postgres: el cascade de 0015 borra las FILAS
// (listings, conversations, messages), pero no los archivos que esas filas
// referenciaban en Storage — sin limpieza explícita quedan huérfanos
// (avatar, fotos de avisos, currículums), y un archivo huérfano es una fuga
// de datos que sobrevive a la cuenta. Por eso: 1) recolectar QUÉ hay que
// borrar mientras todavía existe (solo lectura, no toca nada), 2) borrar el
// usuario (la acción irreversible real), 3) recién con éxito confirmado,
// limpiar Storage con lo recolectado — así un fallo en el paso 1 o 3 nunca
// deja una cuenta a medio borrar ni destruye archivos de una cuenta que
// sigue viva.
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;
type StorageCleanupPlan = ReadonlyArray<{ bucket: string; prefix: string }>;

/** Buckets cuyo path empieza con `{tenant_id}/{user_id}/…` (0012, 0025, 0047). */
const OWN_PREFIX_BUCKETS = ["avatars", "post-media", "job-cvs"] as const;

/**
 * Recolecta, de solo lectura, qué archivos de Storage hay que borrar para
 * esta cuenta. Corre ANTES de deleteUser: si algo falla acá no se tocó nada.
 */
async function collectStorageCleanup(
  admin: AdminClient,
  userId: string,
): Promise<StorageCleanupPlan> {
  try {
    const { data: profile } = await admin
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (!profile?.tenant_id) return [];

    const plan: { bucket: string; prefix: string }[] = OWN_PREFIX_BUCKETS.map((bucket) => ({
      bucket,
      prefix: `${profile.tenant_id}/${userId}`,
    }));

    // listing-photos usa {tenant_id}/{listing_id}/… — hay que resolver los
    // avisos propios ANTES de que el cascade de listings se los lleve.
    const { data: listings } = await admin
      .from("listings")
      .select("id")
      .eq("created_by", userId);
    for (const listing of listings ?? []) {
      plan.push({ bucket: "listing-photos", prefix: `${profile.tenant_id}/${listing.id}` });
    }

    return plan;
  } catch (error) {
    console.error(
      "[perfil] deleteAccount: collectStorageCleanup falló (se sigue igual):",
      error instanceof Error ? error.message : "error desconocido",
    );
    return [];
  }
}

/**
 * Ejecuta la limpieza recolectada. Corre DESPUÉS de que deleteUser confirmó
 * éxito. Best-effort por diseño: un archivo que no se pudo borrar queda
 * logueado para reconciliar a mano, pero NUNCA revierte ni bloquea un
 * borrado de cuenta ya confirmado (§5.4: menos dato > archivo prolijo).
 */
async function runStorageCleanup(admin: AdminClient, plan: StorageCleanupPlan): Promise<void> {
  for (const { bucket, prefix } of plan) {
    try {
      const { data: files, error } = await admin.storage.from(bucket).list(prefix, {
        limit: 1000,
      });
      if (error || !files || files.length === 0) continue;
      const paths = files.map((file) => `${prefix}/${file.name}`);
      const { error: removeError } = await admin.storage.from(bucket).remove(paths);
      if (removeError) {
        console.error(
          `[perfil] deleteAccount: no se pudo limpiar Storage (${bucket}/${prefix}) — reconciliar a mano:`,
          removeError.message,
        );
      }
    } catch (error) {
      console.error(
        `[perfil] deleteAccount: limpieza de Storage (${bucket}) falló — reconciliar a mano:`,
        error instanceof Error ? error.message : "error desconocido",
      );
    }
  }
}

export async function deleteAccountAction(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, formError: COPY.noSession };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, formError: COPY.genericError };
  }

  // Precondición (0015): business_accounts.owner_id es ON DELETE RESTRICT a
  // propósito — una cuenta con suscripción Stripe activa NO debe cascadear
  // billing en silencio. Sin este chequeo, deleteUser fallaba más abajo con
  // un foreign_key_violation opaco y la persona recibía "probá de nuevo",
  // un mensaje que reintentar jamás arregla. Se distingue por plan_status:
  // sin suscripción real (inactive/canceled) se da de baja sola, con
  // suscripción real (active/past_due) se bloquea con una acción concreta.
  const { data: business } = await admin
    .from("business_accounts")
    .select("id, plan_status")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (business) {
    if (business.plan_status === "active" || business.plan_status === "past_due") {
      return { ok: false, formError: COPY.businessAccountBlocked };
    }
    // Sin suscripción real detrás (nunca pagó o ya canceló): no hay billing
    // que proteger — se da de baja la fila para que el borrado pueda seguir.
    const { error: cleanupError } = await admin
      .from("business_accounts")
      .delete()
      .eq("id", business.id);
    if (cleanupError) {
      console.error("[perfil] deleteAccount: no se pudo dar de baja business_account inactivo", {
        code: cleanupError.code,
      });
      return { ok: false, formError: COPY.genericError };
    }
  }

  const storageCleanup = await collectStorageCleanup(admin, user.id);

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("[perfil] deleteUser falló", { code: error.code });
    return { ok: false, formError: COPY.genericError };
  }

  await runStorageCleanup(admin, storageCleanup);

  await supabase.auth.signOut();
  redirect("/");
}

// ---------------------------------------------------------------------------
// Reportar un perfil como estafa — RPC report_scam (SECURITY DEFINER, RLS-safe).
// ---------------------------------------------------------------------------

const reportSchema = z.object({
  profileId: z.uuid(),
  reason: z.enum([
    "pidio_dinero_adelantado",
    "se_hace_pasar_por_otro",
    "publicacion_falsa",
    "otro",
  ]),
  details: z.string().trim().max(500, COPY.reportDetailsLong).optional(),
});

export type ReportProfileInput = z.infer<typeof reportSchema>;

export async function reportProfileAction(
  input: ReportProfileInput,
): Promise<ActionResult> {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: COPY.genericError };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, formError: COPY.noSession };

  // Mismo presupuesto y MISMA key que /escudo/reportar y /reportes: 10 por día
  // y por persona, compartidos entre todas las superficies de reporte. Un tope
  // por pantalla sería un tope multiplicado por la cantidad de pantallas, y
  // quien quiere brigadear a alguien no elige el botón, elige la víctima.
  if (!limit(`reporte:${user.id}`, 10, DAY_MS).ok) {
    return { ok: false, formError: COPY.tooManyReports };
  }

  const { error } = await supabase.rpc("report_scam", {
    p_target_kind: "profile",
    p_target_id: parsed.data.profileId,
    p_reason: parsed.data.reason,
    p_details: parsed.data.details || undefined,
  });

  if (error) {
    console.error("[perfil] report_scam falló", { code: error.code });
    return { ok: false, formError: COPY.genericError };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Bloquear/desbloquear a otra persona — RPCs block_user/unblock_user
// (SECURITY DEFINER, 0020_user_blocks.sql). El bloqueo es global: corta el
// contacto en ambas direcciones y cierra los hilos existentes entre ambos.
// ---------------------------------------------------------------------------

const blockProfileSchema = z.object({
  profileId: z.uuid(),
});

export type BlockActionResult =
  | { ok: true }
  | { ok: false; code: "unauthenticated" | "invalid" | "error" };

export async function blockUserAction(
  input: { profileId: string },
): Promise<BlockActionResult> {
  const parsed = blockProfileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "unauthenticated" };

  const { error } = await supabase.rpc("block_user", {
    p_profile_id: parsed.data.profileId,
  });
  if (error) {
    console.error("[perfil] block_user falló", { code: error.code });
    return { ok: false, code: "error" };
  }

  revalidatePath("/mensajes");
  revalidatePath("/perfil/bloqueados");
  return { ok: true };
}

export async function unblockUserAction(
  input: { profileId: string },
): Promise<BlockActionResult> {
  const parsed = blockProfileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "unauthenticated" };

  const { error } = await supabase.rpc("unblock_user", {
    p_profile_id: parsed.data.profileId,
  });
  if (error) {
    console.error("[perfil] unblock_user falló", { code: error.code });
    return { ok: false, code: "error" };
  }

  revalidatePath("/mensajes");
  revalidatePath("/perfil/bloqueados");
  return { ok: true };
}
