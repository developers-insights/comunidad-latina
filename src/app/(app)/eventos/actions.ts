"use server";

import { z } from "zod";
import { requireTenantMatch } from "@/lib/tenant/guard";

/**
 * Server actions del módulo DIRECTORIOS (lado eventos).
 *
 * "Quiero ir" = reaction (subject_kind='listing', kind='like') sobre el
 * evento. La RLS de reactions ya garantiza: profile_id propio, sujeto del
 * mismo tenant y published; el unique (subject_kind, subject_id, profile_id)
 * hace el toggle idempotente.
 */

const eventIdSchema = z.uuid();

const GENERIC_ERROR =
  "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo en un ratito.";

export type ToggleInterestResult =
  | { ok: true; interested: boolean }
  | { ok: false; error: string; needsAuth?: boolean };

export async function toggleEventInterestAction(
  rawEventId: string,
): Promise<ToggleInterestResult> {
  const parsed = eventIdSchema.safeParse(rawEventId);
  if (!parsed.success) {
    return { ok: false, error: "Ese evento no existe o ya no está disponible." };
  }
  const eventId = parsed.data;

  // Sin coincidencia de tenant el toggle miente en las dos direcciones: la
  // lectura filtrada por el tenant del header no encuentra la reaction que sí
  // existe, y el insert que sigue rebota contra la RLS.
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: "Para anotarte necesitás entrar a tu cuenta." };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  // ¿Ya está anotada esta persona? (toggle)
  const { data: existing, error: readError } = await supabase
    .from("reactions")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("subject_kind", "listing")
    .eq("subject_id", eventId)
    .eq("profile_id", user.id)
    .eq("kind", "like")
    .maybeSingle();

  if (readError) {
    console.warn("[directorios] lectura de interés falló", { eventId, code: readError.code });
    return { ok: false, error: GENERIC_ERROR };
  }

  if (existing) {
    const { error: deleteError } = await supabase
      .from("reactions")
      .delete()
      .eq("id", existing.id)
      .eq("profile_id", user.id);
    if (deleteError) {
      console.warn("[directorios] baja de interés falló", { eventId, code: deleteError.code });
      return { ok: false, error: GENERIC_ERROR };
    }
    return { ok: true, interested: false };
  }

  const { error: insertError } = await supabase.from("reactions").insert({
    tenant_id: tenant.id,
    subject_kind: "listing",
    subject_id: eventId,
    profile_id: user.id,
    kind: "like",
  });

  if (insertError) {
    // 23505: carrera con otro toggle — ya quedó anotada, no es un error.
    if (insertError.code === "23505") {
      return { ok: true, interested: true };
    }
    console.warn("[directorios] alta de interés falló", { eventId, code: insertError.code });
    return { ok: false, error: GENERIC_ERROR };
  }

  return { ok: true, interested: true };
}
