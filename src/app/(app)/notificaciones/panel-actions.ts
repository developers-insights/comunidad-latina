"use server";

import { createClient } from "@/lib/supabase/server";
import { timeAgo } from "@/lib/utils";
import {
  isNotificationCategory,
  type NotificationCategory,
} from "@/lib/notifications/categories";
import type { InboxTab } from "@/lib/notifications/href";
import { PANEL_LIMIT, type NotificationPanelItem } from "@/lib/notifications/panel";
import type { PanelDeCampanaResult } from "@/lib/notifications/panel-campana";

/**
 * =============================================================================
 * LA GAVETA DE LA CAMPANA, POR CATEGORÍA
 * =============================================================================
 *
 * Pedido del cliente: «que la campanita tenga categorías cuando se la toca —
 * mensajes, amistad, seguir, publicación, pagos, creadores».
 *
 * Las catorce categorías YA EXISTEN (CHECK de la 0045 + `vencimientos` de la
 * 0098) y las pestañas también, pero sólo en la bandeja completa. Lo que
 * faltaba era traerlas a la gaveta. Esta action es la lectura de esa gaveta:
 * las mismas filas de siempre, filtradas por categoría, más los contadores.
 *
 * TRES CONSULTAS EN PARALELO, NINGUNA EN CASCADA
 * ----------------------------------------------
 *  1. Las seis filas de la pestaña pedida.
 *  2. `notification_counts()` — las no leídas de las catorce categorías en UNA
 *     query agrupada (0045). Sin ella harían falta catorce.
 *  3. El total sin leer, con `head: true`.
 *
 * El total sale de su propia consulta y no de sumar (2) a propósito: si la RPC
 * de contadores falla, las pestañas se quedan sin globito pero el número de la
 * campana —que es el que mira la gente— sigue siendo verdad.
 *
 * Sin `.eq()` de tenant ni de perfil: la RLS de `notifications` (0011) ya exige
 * `tenant_id = current_tenant_id() AND profile_id = auth.uid()`. Repetirlo sería
 * un filtro de más que tapa un error de política en vez de mostrarlo.
 */

/** La pestaña llega como texto del cliente; cualquier cosa rara cae en "todas". */
function parseTab(value: string | undefined): InboxTab {
  if (!value || value === "todas") return "todas";
  return isNotificationCategory(value) ? value : "todas";
}

export async function getPanelDeCampanaAction(
  tabPedida?: string,
): Promise<PanelDeCampanaResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const tab = parseTab(tabPedida);
  const nowIso = new Date().toISOString();

  let listaQuery = supabase
    .from("notifications")
    .select("id, title, body, href, read_at, created_at, category")
    .is("dismissed_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(PANEL_LIMIT);
  if (tab !== "todas") listaQuery = listaQuery.eq("category", tab);

  const [
    { data, error },
    { data: countsData, error: countsError },
    { count, error: countError },
  ] = await Promise.all([
    listaQuery,
    supabase.rpc("notification_counts"),
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

  // Un contador caído deja las pestañas sin globito; NO tumba la gaveta. Pero
  // tampoco se traga en silencio: sin esta línea, unas pestañas en blanco y un
  // "estás al día" falso serían indistinguibles de la verdad.
  if (countsError) {
    console.error("[notificaciones] notification_counts falló:", countsError.message);
  }

  const counts: Partial<Record<NotificationCategory, number>> = {};
  for (const fila of countsData ?? []) {
    if (isNotificationCategory(fila.category)) counts[fila.category] = fila.unread;
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

  return { ok: true, data: { tab, unread: count ?? 0, counts, items } };
}
