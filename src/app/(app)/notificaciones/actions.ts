"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Server actions del módulo NOTIFICACIONES.
 * Todo con el cliente server (anon + cookies): RLS es la frontera —
 * el dueño marca leídas SUS notificaciones y sus receipts de broadcast.
 */

const uuidSchema = z.string().uuid();

export type NotificationActionResult =
  | { ok: true }
  | { ok: false; code: "invalid" | "unauthenticated" | "error" };

/** Marca una notificación como leída (idempotente: solo si seguía sin leer). */
export async function markNotificationReadAction(
  notificationId: string,
): Promise<NotificationActionResult> {
  const parsed = uuidSchema.safeParse(notificationId);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "unauthenticated" };

  // RLS: update solo del dueño; el filtro read_at hace la acción idempotente.
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", parsed.data)
    .is("read_at", null);
  if (error) return { ok: false, code: "error" };

  revalidatePath("/notificaciones");
  return { ok: true };
}

/**
 * Registra que el usuario vio/descartó un broadcast (modelo pull §12):
 * inserta su receipt y el anuncio deja de mostrarse. Idempotente ante
 * doble click (PK broadcast+profile → 23505 se trata como éxito).
 */
export async function dismissBroadcastAction(
  broadcastId: string,
): Promise<NotificationActionResult> {
  const parsed = uuidSchema.safeParse(broadcastId);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "unauthenticated" };

  // RLS: solo marco visto YO y solo broadcasts targeteados a MI tenant.
  const { error } = await supabase.from("broadcast_receipts").insert({
    broadcast_id: parsed.data,
    profile_id: user.id,
  });
  if (error && error.code !== "23505") return { ok: false, code: "error" };

  revalidatePath("/notificaciones");
  return { ok: true };
}
