"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { supabaseSinTiparGrupos } from "@/lib/messaging/grupos";

/**
 * HASTA DÓNDE LEÍ — la marca que hace posible el contador de no leídos.
 *
 * Una fila por (conversación, persona) en `conversation_reads`: `last_read_at`
 * avanza, nunca retrocede. El contador de la bandeja es "mensajes de la otra
 * persona con `created_at` mayor a esa marca".
 *
 * QUIÉN LLAMA A ESTO. Hoy, la propia bandeja cuando se toca una fila
 * (`InboxRowLink`): abrir el chat desde la lista es el momento en que la
 * persona dice "esto ya lo vi", y es la única superficie que este frente
 * controla. La pantalla del hilo debería llamarla también —se puede llegar
 * desde una notificación o desde un enlace— y eso queda anotado, no hecho: ese
 * archivo es de otro frente.
 *
 * Si la tabla todavía no existe, la acción devuelve `{ ok: false }` y no pasa
 * nada más: la navegación ya ocurrió y el contador simplemente no baja.
 */

const schema = z.object({ conversationId: z.uuid() });

export type MarcarLeidaResult =
  | { ok: true }
  | { ok: false; code: "invalid" | "unauthenticated" | "rate-limited" | "error" };

export async function marcarConversacionLeidaAction(input: {
  conversationId: string;
}): Promise<MarcarLeidaResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return {
      ok: false,
      code: guard.reason === "unauthenticated" ? "unauthenticated" : "error",
    };
  }

  // Techo generoso: corta un script, no a alguien que recorre su bandeja.
  if (!limit(`lectura:${guard.user.id}`, 600, HOUR_MS).ok) {
    return { ok: false, code: "rate-limited" };
  }

  // La RPC de la 0137 y no un upsert a mano: la fecha la pone la base (nunca el
  // cliente) y el trigger `app.avanzar_marca_de_lectura()` garantiza que la
  // marca sólo AVANCE. Escribiendo la tabla directo, un reloj de cliente atrasado
  // podría retroceder la marca y revivir mensajes ya leídos.
  const { error } = await supabaseSinTiparGrupos(guard.supabase).rpc(
    "marcar_leido_en_conversacion",
    { p_conversation_id: parsed.data.conversationId },
  );

  if (error) {
    console.warn("[mensajes] no se pudo marcar la conversación leída", {
      code: error.code,
    });
    return { ok: false, code: "error" };
  }

  revalidatePath("/mensajes");
  return { ok: true };
}
