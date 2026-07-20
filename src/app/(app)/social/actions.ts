"use server";

import { z } from "zod";
import { requireTenantMatch } from "@/lib/tenant/guard";

/**
 * Server actions del grafo social (0023 — feedback cliente 2026-07-19).
 *
 * Seguir una entidad (listing: negocio/evento/profesional/propiedad/tienda/
 * aviso de creadores) o a un creador (profile). La RLS de follows garantiza:
 * follower propio, sujeto published del mismo tenant, sin pares bloqueados;
 * el unique (follower, target_kind, target_id) hace el toggle idempotente.
 *
 * Regla de alcance que habilita este grafo: lo orgánico de una entidad llega
 * SOLO a sus seguidores en el feed; lo promocionado llega a todos.
 */

const targetSchema = z.object({
  targetKind: z.enum(["listing", "profile"]),
  targetId: z.uuid(),
});

const GENERIC_ERROR =
  "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo en un ratito.";

export type ToggleFollowResult =
  | { ok: true; following: boolean }
  | { ok: false; error: string; needsAuth?: boolean };

export async function toggleFollowAction(raw: {
  targetKind: string;
  targetId: string;
}): Promise<ToggleFollowResult> {
  const parsed = targetSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Eso que querés seguir ya no está disponible." };
  }
  const { targetKind, targetId } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: "Para seguir necesitás entrar a tu cuenta." };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  const { data: existing, error: readError } = await supabase
    .from("follows")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("follower_id", user.id)
    .eq("target_kind", targetKind)
    .eq("target_id", targetId)
    .maybeSingle();

  if (readError) {
    console.warn("[social] lectura de follow falló", { targetKind, targetId, code: readError.code });
    return { ok: false, error: GENERIC_ERROR };
  }

  if (existing) {
    const { error: deleteError } = await supabase
      .from("follows")
      .delete()
      .eq("id", existing.id)
      .eq("follower_id", user.id);
    if (deleteError) {
      console.warn("[social] dejar de seguir falló", { targetKind, targetId, code: deleteError.code });
      return { ok: false, error: GENERIC_ERROR };
    }
    return { ok: true, following: false };
  }

  const { error: insertError } = await supabase.from("follows").insert({
    tenant_id: tenant.id,
    follower_id: user.id,
    target_kind: targetKind,
    target_id: targetId,
  });

  if (insertError) {
    // 23505: carrera con otro toggle — ya lo estás siguiendo, no es un error.
    if (insertError.code === "23505") {
      return { ok: true, following: true };
    }
    console.warn("[social] seguir falló", { targetKind, targetId, code: insertError.code });
    return { ok: false, error: GENERIC_ERROR };
  }

  return { ok: true, following: true };
}
