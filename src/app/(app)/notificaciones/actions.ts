"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { timeAgo } from "@/lib/utils";
import { requireTenantMatch } from "@/lib/tenant/guard";
import {
  NOTIFICATION_CATEGORIES,
  isAlwaysOnCategory,
  isNotificationCategory,
  type NotificationCategory,
} from "@/lib/notifications/categories";
import { NOTIFICATION_FREQUENCIES } from "@/lib/notifications/prefs";
import {
  PANEL_LIMIT,
  type NotificationPanelItem,
  type NotificationPanelResult,
} from "@/lib/notifications/panel";

/**
 * Server actions del módulo NOTIFICACIONES.
 *
 * Todo con el cliente server (anon + cookies): RLS es la frontera — el dueño
 * mueve SUS notificaciones y sus receipts de broadcast, y el trigger
 * `notifications_freeze` (0045) garantiza que de una notificación sólo se puedan
 * tocar `read_at` y `dismissed_at`. Si alguna de estas acciones intentara algo
 * más, la base la rechaza: no dependemos de que el código de acá se porte bien.
 */

const uuidSchema = z.uuid();

const categorySchema = z.enum(NOTIFICATION_CATEGORIES);

export type NotificationActionResult =
  | { ok: true }
  | { ok: false; code: "invalid" | "unauthenticated" | "error" };

/**
 * Sólo la bandeja. El punto del bottom nav sale de `getShellContext`, que es
 * `cache()` POR REQUEST y se recalcula en la próxima navegación: invalidar el
 * layout entero por marcar una notificación leída tiraría el router cache de
 * toda la app para actualizar un punto.
 */
function revalidateInbox() {
  revalidatePath("/notificaciones");
}

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

  revalidateInbox();
  return { ok: true };
}

/**
 * La vuelve a dejar sin leer. Es la contraparte honesta de "marcar leída": si
 * abriste algo por error y no lo podés devolver a la pila de pendientes, la
 * bandeja te obliga a acordarte de memoria.
 */
export async function markNotificationUnreadAction(
  notificationId: string,
): Promise<NotificationActionResult> {
  const parsed = uuidSchema.safeParse(notificationId);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "unauthenticated" };

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: null })
    .eq("id", parsed.data);
  if (error) return { ok: false, code: "error" };

  revalidateInbox();
  return { ok: true };
}

/**
 * Quita el aviso de la bandeja. BORRADO LÓGICO (`dismissed_at`, 0045):
 *
 *   ELIMINA EL AVISO, NUNCA LA ACTIVIDAD ORIGINAL.
 *
 * Borrar la notificación de un comentario no borra el comentario. Y la fila
 * sigue existiendo —la RLS a propósito no la esconde— para que "Deshacer"
 * pueda funcionar; es la app la que filtra `dismissed_at is null`.
 */
export async function dismissNotificationAction(
  notificationId: string,
): Promise<NotificationActionResult> {
  const parsed = uuidSchema.safeParse(notificationId);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "unauthenticated" };

  const { error } = await supabase
    .from("notifications")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", parsed.data)
    .is("dismissed_at", null);
  if (error) return { ok: false, code: "error" };

  revalidateInbox();
  return { ok: true };
}

/** Deshacer el quitado. */
export async function restoreNotificationAction(
  notificationId: string,
): Promise<NotificationActionResult> {
  const parsed = uuidSchema.safeParse(notificationId);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "unauthenticated" };

  const { error } = await supabase
    .from("notifications")
    .update({ dismissed_at: null })
    .eq("id", parsed.data);
  if (error) return { ok: false, code: "error" };

  revalidateInbox();
  return { ok: true };
}

/**
 * Marca todas como leídas. Con `category`, sólo esa pestaña — que es lo que
 * espera quien está parado en "Mensajes" y toca el botón: no querer vaciar
 * también las siete pestañas que no está mirando.
 *
 * Las descartadas quedan afuera: ya no están en la bandeja, marcarlas leídas no
 * significaría nada.
 */
export async function markAllNotificationsReadAction(
  category?: string,
): Promise<NotificationActionResult> {
  let scoped: NotificationCategory | null = null;
  if (category !== undefined && category !== "todas") {
    const parsed = categorySchema.safeParse(category);
    if (!parsed.success) return { ok: false, code: "invalid" };
    scoped = parsed.data;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "unauthenticated" };

  let query = supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null)
    .is("dismissed_at", null);
  if (scoped) query = query.eq("category", scoped);

  const { error } = await query;
  if (error) return { ok: false, code: "error" };

  revalidateInbox();
  return { ok: true };
}

/**
 * "Dejar de recibir avisos de esta categoría" desde el menú de una fila.
 *
 * Escribe `frequency = 'off'` en `notification_prefs`. Las tres categorías
 * críticas se rechazan ACÁ además de en el CHECK de la base: la acción no
 * debería ni ofrecerse (la UI no dibuja la opción), pero una server action es
 * una API pública y no puede confiar en que la pantalla se portó bien.
 */
export async function muteCategoryAction(
  category: string,
): Promise<NotificationActionResult> {
  const parsed = categorySchema.safeParse(category);
  if (!parsed.success) return { ok: false, code: "invalid" };
  if (isAlwaysOnCategory(parsed.data)) return { ok: false, code: "invalid" };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return {
      ok: false,
      code: guard.reason === "unauthenticated" ? "unauthenticated" : "error",
    };
  }

  const { error } = await guard.supabase.from("notification_prefs").upsert(
    {
      tenant_id: guard.tenant.id,
      profile_id: guard.user.id,
      category: parsed.data,
      frequency: "off",
    },
    { onConflict: "profile_id,category" },
  );
  if (error) return { ok: false, code: "error" };

  revalidateInbox();
  revalidatePath("/ajustes/notificaciones");
  return { ok: true };
}

/* ========================================================================== */
/* El desplegable de la campana — lectura                                     */
/* ========================================================================== */

/**
 * Los últimos avisos + cuántos quedan sin leer, para la gaveta que abre la
 * campana del header (`NotificationPanel`).
 *
 * Es la MISMA consulta que la bandeja, recortada: `dismissed_at is null` +
 * `expires_at` en el futuro + orden por fecha. Sin `.eq()` de tenant ni de
 * perfil — la RLS de `notifications` (0011) ya exige `tenant_id =
 * current_tenant_id() AND profile_id = auth.uid()`, y repetirlo acá sería un
 * filtro de más que tapa un error de política en vez de mostrarlo.
 *
 * Los dos números salen de dos consultas en paralelo y no de contar la página:
 * `unread` es el total de la persona, no cuántos de estos seis están sin leer.
 * Si dijera lo segundo, el globito bajaría de 12 a 6 con sólo abrir la gaveta.
 *
 * Devuelve `{ ok: false }` ante cualquier fallo de lectura: el panel muestra un
 * aviso de error, nunca "estás al día".
 */
export async function getNotificationPanelAction(): Promise<NotificationPanelResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const nowIso = new Date().toISOString();

  const [{ data, error }, { count, error: countError }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, title, body, href, read_at, created_at, category")
      .is("dismissed_at", null)
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(PANEL_LIMIT),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("dismissed_at", null)
      .gt("expires_at", nowIso)
      .is("read_at", null),
  ]);

  if (error || countError) {
    console.error(
      "[notificaciones] panel de la campana:",
      error?.message ?? countError?.message,
    );
    return { ok: false };
  }

  const now = new Date();
  const items: NotificationPanelItem[] = (data ?? []).map((row) => ({
    id: row.id,
    // La columna llega como `text`. Si mañana se suma una categoría y este
    // deploy es viejo, la fila cae en una conocida en vez de romper el ícono.
    category: isNotificationCategory(row.category) ? row.category : "social",
    title: row.title,
    body: row.body,
    href: row.href,
    read: row.read_at !== null,
    createdAt: row.created_at,
    timeLabel: timeAgo(new Date(row.created_at), now),
  }));

  return { ok: true, data: { unread: count ?? 0, items } };
}

/* ========================================================================== */
/* Preferencias — /ajustes/notificaciones                                     */
/* ========================================================================== */

const prefSchema = z.object({
  category: categorySchema,
  inApp: z.boolean(),
  email: z.boolean(),
  push: z.boolean(),
  frequency: z.enum(NOTIFICATION_FREQUENCIES),
});

export type SavePrefInput = z.infer<typeof prefSchema>;

/**
 * Guarda la preferencia de UNA categoría (la pantalla guarda sola, sin botón
 * "Guardar": son trece filas y nadie quiere confirmar cada interruptor).
 *
 * `upsert` sobre la PK (profile_id, category): la primera vez inserta, después
 * actualiza. El `tenant_id` sale del guard, jamás del cliente.
 *
 * En seguridad / pagos / cuenta sólo se acepta el canal (`email`, `push`): el
 * `in_app` y la frecuencia se fuerzan a los valores del CHECK. Elegir no recibir
 * un mail no es silenciar la alerta, es elegir el canal — la alerta llega igual
 * a la bandeja.
 */
export async function saveNotificationPrefAction(
  input: SavePrefInput,
): Promise<NotificationActionResult> {
  const parsed = prefSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const pref = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return {
      ok: false,
      code: guard.reason === "unauthenticated" ? "unauthenticated" : "error",
    };
  }

  const alwaysOn = isAlwaysOnCategory(pref.category);

  const { error } = await guard.supabase.from("notification_prefs").upsert(
    {
      tenant_id: guard.tenant.id,
      profile_id: guard.user.id,
      category: pref.category,
      in_app: alwaysOn ? true : pref.inApp,
      email: pref.email,
      push: pref.push,
      frequency: alwaysOn ? "all" : pref.frequency,
    },
    { onConflict: "profile_id,category" },
  );
  if (error) return { ok: false, code: "error" };

  revalidatePath("/ajustes/notificaciones");
  revalidateInbox();
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
