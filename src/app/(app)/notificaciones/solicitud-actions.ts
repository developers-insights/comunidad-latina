"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { avisarAceptacion } from "@/lib/notifications/solicitud-server";
import {
  estadoDeSolicitud,
  type ResponderSolicitudResult,
} from "@/lib/notifications/solicitud";

const schema = z.object({
  notificationId: z.uuid(),
  conversationId: z.uuid(),
  decision: z.enum(["confirmar", "eliminar"]),
});

/**
 * Confirmar o eliminar una solicitud de contacto desde la notificación, sin
 * navegar. Idempotente en las dos direcciones: el doble toque, la otra pestaña y
 * la respuesta que ya se dio desde Mensajes terminan en el mismo estado final
 * en vez de en un error.
 */
export async function responderSolicitudAction(input: {
  notificationId: string;
  conversationId: string;
  decision: "confirmar" | "eliminar";
}): Promise<ResponderSolicitudResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const { notificationId, conversationId, decision } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return { ok: false, code: guard.reason === "unauthenticated" ? "unauthenticated" : "error" };
  }
  const { supabase, user } = guard;

  const { data: conversacion, error: lecturaError } = await supabase
    .from("conversations")
    .select("id, tenant_id, status, created_by, counterpart_id")
    .eq("id", conversationId)
    .maybeSingle();

  if (lecturaError) {
    console.warn("[notificaciones] no se pudo leer la solicitud", { code: lecturaError.code });
    return { ok: false, code: "error" };
  }
  if (!conversacion || conversacion.counterpart_id !== user.id) {
    return { ok: false, code: "no_disponible" };
  }

  const actual = estadoDeSolicitud(conversacion.status);
  const buscado = decision === "confirmar" ? "aceptada" : "eliminada";

  if (actual !== "pendiente" && actual !== buscado) {
    return { ok: false, code: "ya_resuelta", estado: actual };
  }

  if (actual === "pendiente") {
    if (decision === "confirmar") {
      const { error } = await supabase.rpc("accept_conversation", {
        p_conversation_id: conversationId,
      });
      if (error) {
        console.warn("[notificaciones] accept_conversation falló", { code: error.code });
        return { ok: false, code: "error" };
      }
      await avisarAceptacion(supabase, {
        userId: user.id,
        tenantId: conversacion.tenant_id,
        solicitanteId: conversacion.created_by,
        conversationId,
      });
    } else {
      // El filtro por `pending` es lo que evita que un "Eliminar" tardío pise una
      // aceptación que llegó desde otro dispositivo entre la lectura y acá.
      const { data: cambiadas, error } = await supabase
        .from("conversations")
        .update({ status: "blocked" })
        .eq("id", conversationId)
        .eq("status", "pending")
        .select("id");
      if (error) {
        console.warn("[notificaciones] no se pudo eliminar la solicitud", { code: error.code });
        return { ok: false, code: "error" };
      }
      if (!cambiadas || cambiadas.length === 0) {
        return { ok: false, code: "ya_resuelta" };
      }
    }
  }

  const { error: leidaError } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .is("read_at", null);
  if (leidaError) {
    console.warn("[notificaciones] no se pudo marcar leída la solicitud", {
      code: leidaError.code,
    });
  }

  revalidatePath("/mensajes");
  return { ok: true, estado: buscado };
}
