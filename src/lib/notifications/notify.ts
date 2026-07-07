import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "@/lib/types/database.types";

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
 *   title: "Tenés un mensaje nuevo",
 *   href: `/mensajes/${conversationId}`,
 * });
 * ```
 *
 * NUNCA lanza: devuelve `{ ok: false }` y loguea (sin PII) para que el caller
 * siga — una notificación fallida jamás debe romper la acción principal.
 */

export type CreateNotificationInput = {
  tenantId: string;
  profileId: string;
  /** Etiqueta corta del tipo (ej. "contact_request", "message"). */
  kind: string;
  title: string;
  body?: string | null;
  /** Ruta interna a la que navega el click (ej. "/mensajes"). */
  href?: string | null;
  /**
   * Anti-ruido: si ya existe una notificación NO leída del mismo kind+href
   * para el mismo perfil, no inserta otra (ej.: 10 mensajes seguidos en la
   * misma conversación = 1 sola notificación hasta que la lea).
   */
  dedupeUnread?: boolean;
};

export type CreateNotificationOutcome =
  | { ok: true; deduped?: boolean }
  | { ok: false; error: string };

export async function createNotification(
  admin: SupabaseClient<Database>,
  input: CreateNotificationInput,
): Promise<CreateNotificationOutcome> {
  try {
    if (input.dedupeUnread && input.href) {
      const { data: existing, error: dedupeError } = await admin
        .from("notifications")
        .select("id")
        .eq("tenant_id", input.tenantId)
        .eq("profile_id", input.profileId)
        .eq("kind", input.kind)
        .eq("href", input.href)
        .is("read_at", null)
        .gt("expires_at", new Date().toISOString())
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
