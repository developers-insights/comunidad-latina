"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
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
// vía admin y el cascade de la DB se lleva todo lo demás. El admin client acá
// es legítimo: solo actúa sobre el usuario autenticado de la sesión actual.
// ---------------------------------------------------------------------------

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

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("[perfil] deleteUser falló", { code: error.code });
    return { ok: false, formError: COPY.genericError };
  }

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
