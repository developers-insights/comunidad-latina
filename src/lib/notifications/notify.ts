import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "@/lib/types/database.types";
import {
  categoryForKind,
  priorityForKind,
  isAlwaysOnCategory,
  type NotificationCategory,
  type NotificationPriority,
} from "./categories";
import { buildGroupKey } from "./group";
import {
  prefsFromRows,
  shouldDeliverInApp,
  DEFAULT_PREF,
  type NotificationPref,
} from "./prefs";

/**
 * =============================================================================
 * NOTIFICACIONES (módulo NOTIFICACIONES) — helper para los demás módulos
 * =============================================================================
 *
 * `notifications` tiene RLS con `insert: with check (false)` para usuarios:
 * SOLO el sistema (service_role) emite notificaciones — nadie se auto-notifica
 * por API. Por eso este helper recibe el admin client y es server-only.
 *
 * USO TÍPICO desde una server action (best-effort, jamás rompe el flujo):
 *
 * ```ts
 * import { createAdminClient } from "@/lib/supabase/admin";
 * import { createNotification } from "@/lib/notifications/notify";
 *
 * await createNotification(createAdminClient(), {
 *   tenantId: conversation.tenant_id,
 *   profileId: recipientId,
 *   kind: "message",
 *   category: "mensajes",
 *   title: "Tenés un mensaje nuevo",
 *   href: `/mensajes/${conversationId}`,
 * });
 * ```
 *
 * TRES ANTI-RUIDOS, y no son lo mismo:
 *   · `dedupeUnread` — "ya hay una igual sin leer, no sumes otra" (10 mensajes
 *     seguidos del mismo hilo = 1 aviso). Compara kind + href.
 *   · `group`        — "sumá esta interacción a la que ya existe" (20 me gusta
 *     = 1 fila que dice "y 18 personas más"). Compara `group_key` y REESCRIBE la
 *     fila viva.
 *   · `notification_prefs` — "esta persona pidió no recibir esto".
 *
 * NUNCA lanza: devuelve `{ ok: false }` y loguea (sin PII) para que el caller
 * siga — una notificación fallida jamás debe romper la acción principal.
 */

export type CreateNotificationInput = {
  tenantId: string;
  profileId: string;
  /** Etiqueta FINA del evento (ej. "contact_request", "message"). */
  kind: string;
  title: string;
  body?: string | null;
  /** Ruta interna a la que navega el click (ej. "/mensajes"). */
  href?: string | null;
  /**
   * Pestaña donde cae. Si no viene, sale de `categoryForKind(kind)`. Pasarla
   * explícita es lo correcto cuando el mismo kind puede caer en dos lugares.
   */
  category?: NotificationCategory;
  /** Si no viene, sale de `priorityForKind(kind)`. */
  priority?: NotificationPriority;
  /**
   * Anti-ruido: si ya existe una notificación NO leída del mismo kind+href
   * para el mismo perfil, no inserta otra.
   */
  dedupeUnread?: boolean;
  /**
   * Agrupación de interacciones repetidas sobre el MISMO sujeto (me gusta,
   * seguidores). Actualiza la fila viva en vez de insertar otra; el "y 18
   * personas más" lo arma el caller con `summarizeActors` a partir del contador
   * real del sujeto (`posts.like_count`), porque acá no hay columna de conteo.
   */
  group?: { subjectKind: string; subjectId: string };
  /**
   * Salta la consulta de preferencias. Para notificaciones que son la respuesta
   * directa a algo que la persona acaba de hacer (el resultado de su propia
   * compra, de su propia verificación): ahí silenciar la categoría no significa
   * "no me cuentes cómo salió lo que pedí".
   */
  ignorePrefs?: boolean;
};

export type CreateNotificationOutcome =
  | { ok: true; deduped?: boolean; grouped?: boolean; muted?: boolean }
  | { ok: false; error: string };

/**
 * Preferencia efectiva para (persona, categoría), leída con el admin client.
 *
 * Las tres categorías críticas NI SIQUIERA CONSULTAN: es la regla del contrato
 * (0045). Ahorra un round-trip y, sobre todo, hace imposible que un bug de
 * lectura silencie una alerta de seguridad.
 *
 * Si la lectura falla, devuelve el default (todo prendido): ante la duda,
 * entregar. Perder un aviso por un timeout de red es peor que uno de más.
 */
async function readPref(
  admin: SupabaseClient<Database>,
  profileId: string,
  category: NotificationCategory,
): Promise<NotificationPref> {
  if (isAlwaysOnCategory(category)) return DEFAULT_PREF;

  const { data, error } = await admin
    .from("notification_prefs")
    .select("category, in_app, email, push, frequency")
    .eq("profile_id", profileId)
    .eq("category", category)
    .maybeSingle();

  if (error || !data) return DEFAULT_PREF;
  return prefsFromRows([data])[category] ?? DEFAULT_PREF;
}

export async function createNotification(
  admin: SupabaseClient<Database>,
  input: CreateNotificationInput,
): Promise<CreateNotificationOutcome> {
  try {
    const category = input.category ?? categoryForKind(input.kind);
    const priority = input.priority ?? priorityForKind(input.kind);

    if (!input.ignorePrefs) {
      const pref = await readPref(admin, input.profileId, category);
      if (!shouldDeliverInApp(pref, priority)) {
        return { ok: true, muted: true };
      }
    }

    const nowIso = new Date().toISOString();

    // --- Agrupación: reescribir la fila viva del mismo sujeto ---------------
    // Va ANTES del dedupe porque es más específica: si el caller pidió agrupar,
    // el resultado que quiere es una fila que se actualiza, no una que no se
    // crea. "Viva" = misma clave, sin leer, sin descartar y sin vencer — una vez
    // leída, la próxima interacción abre fila nueva (si no, no te enterarías
    // nunca más).
    const groupKey = input.group
      ? buildGroupKey(input.kind, input.group.subjectKind, input.group.subjectId)
      : null;

    if (groupKey) {
      const { data: live, error: liveError } = await admin
        .from("notifications")
        .select("id")
        .eq("tenant_id", input.tenantId)
        .eq("profile_id", input.profileId)
        .eq("group_key", groupKey)
        .is("read_at", null)
        .is("dismissed_at", null)
        .gt("expires_at", nowIso)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!liveError && live) {
        // `created_at` se mueve al momento de la última interacción para que la
        // fila vuelva arriba de la bandeja. Lo puede hacer porque corre con
        // service_role: el trigger `notifications_freeze` congela estas columnas
        // para el dueño, no para el emisor. `expires_at` NO se toca — el TTL de
        // 60 días cuenta desde el primer aviso y no se renueva por actividad.
        const { error: updateError } = await admin
          .from("notifications")
          .update({
            title: input.title,
            body: input.body ?? null,
            href: input.href ?? null,
            created_at: nowIso,
          })
          .eq("id", live.id);

        if (!updateError) return { ok: true, grouped: true };
        // Si la actualización falla, se inserta igual: mejor dos filas que
        // ninguna. Cae al insert de abajo.
      }
    }

    // --- Dedupe: no repetir lo que todavía no leyó -------------------------
    if (input.dedupeUnread && input.href && !groupKey) {
      const { data: existing, error: dedupeError } = await admin
        .from("notifications")
        .select("id")
        .eq("tenant_id", input.tenantId)
        .eq("profile_id", input.profileId)
        .eq("kind", input.kind)
        .eq("href", input.href)
        .is("read_at", null)
        .is("dismissed_at", null)
        .gt("expires_at", nowIso)
        .limit(1)
        .maybeSingle();

      // Si el chequeo falla se inserta igual (mejor una notificación de más
      // que una de menos); si ya hay una sin leer, no sumamos ruido.
      if (!dedupeError && existing) return { ok: true, deduped: true };
    }

    const row: TablesInsert<"notifications"> = {
      tenant_id: input.tenantId,
      profile_id: input.profileId,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      category,
      priority,
      group_key: groupKey,
    };

    const { error } = await admin.from("notifications").insert(row);
    if (error) {
      console.error("[notificaciones] createNotification falló:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "error desconocido";
    console.error("[notificaciones] createNotification falló:", message);
    return { ok: false, error: message };
  }
}
