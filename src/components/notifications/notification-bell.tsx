import { createClient, getAuthUserId } from "@/lib/supabase/server";
import { NotificationPanel } from "./notification-panel";

/**
 * Cuántas notificaciones sin leer tiene la sesión actual, para el badge de la
 * campana. Mismo patrón exacto que `InboxList` en `/notificaciones`
 * (`src/app/(app)/notificaciones/page.tsx`): `createClient()` +
 * `.is("dismissed_at", null)` + `.gt("expires_at", nowIso)` + `.is("read_at",
 * null)`. Sin `.eq()` de tenant/perfil a mano — la RLS de `notifications`
 * (0011) ya exige `tenant_id = current_tenant_id() AND profile_id =
 * auth.uid()`, así que agregarlos acá sería un filtro de más, no de menos.
 *
 * `dismissed_at`/`expires_at` importan tanto como `read_at`: sin ellos el
 * badge cuenta algo que la bandeja ya no muestra (mismo bug que documenta
 * `getShellContext` para el punto del bottom nav).
 *
 * Nunca lanza: sin sesión o con la DB caída, la campana se pinta sin badge —
 * un contador roto no puede tumbar el header.
 */
async function getUnreadCount(): Promise<number> {
  const userId = await getAuthUserId();
  if (!userId) return 0;

  try {
    const supabase = await createClient();
    const nowIso = new Date().toISOString();
    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("dismissed_at", null)
      .gt("expires_at", nowIso)
      .is("read_at", null);

    if (error || typeof count !== "number") return 0;
    return count;
  } catch {
    return 0;
  }
}

/**
 * Campana del header, entre el selector de zona y Mensajes.
 *
 * Este archivo resuelve UNA sola cosa: cuántos avisos sin leer hay, para que el
 * globito esté bien desde el primer frame renderizado en el servidor. Todo lo
 * demás —abrir la gaveta, traer las últimas seis, marcarlas leídas— vive en
 * `NotificationPanel`, que es cliente.
 *
 * ── LO QUE CAMBIÓ EL 2026-08-25 ─────────────────────────────────────────────
 * Hasta esta fecha la campana era un `<Link href="/notificaciones">`: tocarla
 * te sacaba del feed y volver te devolvía arriba de todo, perdiendo la posición
 * de lectura. Ahora despliega un panel anclado al header. La bandeja completa
 * sigue existiendo igual que siempre —pestañas, filtros, ⋯ por fila, deshacer—
 * y el pie del panel lleva ahí en un toque. Ver el docblock de
 * `notification-panel.tsx`.
 *
 * La consulta del contador NO se movió al panel a propósito: si el número
 * naciera del cliente, el header aparecería sin globito y lo agregaría medio
 * segundo después. Un aviso de seguridad que parpadea en la pantalla es peor
 * que uno que está desde el principio.
 */
export async function NotificationBell() {
  const unread = await getUnreadCount();
  return <NotificationPanel initialUnread={unread} />;
}
