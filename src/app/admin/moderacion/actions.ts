"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStaffContext, logAdminAction } from "../guard";

/**
 * Resolución de la cola de moderación (§12 / §8).
 *
 * DECISIÓN DE PRIVILEGIOS (verificado contra 0007_social.sql y 0004_listings.sql):
 * las policies de UPDATE de posts, comments y listings SÍ tienen rama de staff
 * (`app.is_staff()` + tenant del JWT) → el subject se actualiza con el CLIENTE
 * DEL USUARIO STAFF, con RLS aplicando. El admin client queda SOLO para:
 *   - audit_log (INSERT bloqueado por RLS para JWT — append-only por diseño)
 *   - borrar un mensaje rechazado (messages: participantes-only por §5.4;
 *     no existe rama de staff a propósito — gateado acá por rol verificado)
 */

const COPY = {
  notStaff: "Tu sesión no tiene permisos de moderación. Entrá de nuevo e intentá otra vez.",
  invalid: "No pudimos leer la decisión — recargá la página e intentá de nuevo.",
  alreadyResolved: "Este caso ya lo resolvió otra persona del equipo — la cola se actualizó.",
  genericError: "No pudimos guardar la resolución — no es tu culpa. Probá de nuevo en un momento.",
} as const;

const schema = z.object({
  itemId: z.uuid(),
  decision: z.enum(["approve", "reject"]),
});

export type ResolveModerationState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success" };

export async function resolveModerationItem(
  _prev: ResolveModerationState,
  formData: FormData,
): Promise<ResolveModerationState> {
  const parsed = schema.safeParse({
    itemId: formData.get("itemId"),
    decision: formData.get("decision"),
  });
  if (!parsed.success) return { status: "error", message: COPY.invalid };
  const { itemId, decision } = parsed.data;

  const ctx = await getStaffContext("moderator");
  if (!ctx) return { status: "error", message: COPY.notStaff };
  const { supabase, user } = ctx;

  // 1. Leer el ítem con el cliente del staff (RLS: solo cola de SU tenant).
  const { data: item, error: itemError } = await supabase
    .from("moderation_queue")
    .select("id, tenant_id, subject_kind, subject_id, tier, status")
    .eq("id", itemId)
    .maybeSingle();

  if (itemError || !item) return { status: "error", message: COPY.genericError };
  if (item.status !== "pending") return { status: "error", message: COPY.alreadyResolved };

  // 2. Resolver la cola FIRMANDO como uno mismo (la policy exige
  //    resolved_by = auth.uid()). El filtro status=pending evita pisar una
  //    resolución concurrente de otro moderador.
  const { data: resolved, error: resolveError } = await supabase
    .from("moderation_queue")
    .update({
      status: decision === "approve" ? "approved" : "rejected",
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", item.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (resolveError) return { status: "error", message: COPY.genericError };
  if (!resolved) return { status: "error", message: COPY.alreadyResolved };

  // 3. Efecto sobre el subject — cliente del usuario staff (RLS aplica).
  const nextStatus = decision === "approve" ? "published" : "removed";
  try {
    switch (item.subject_kind) {
      case "post": {
        await supabase.from("posts").update({ status: nextStatus }).eq("id", item.subject_id);
        break;
      }
      case "comment": {
        await supabase.from("comments").update({ status: nextStatus }).eq("id", item.subject_id);
        break;
      }
      case "listing":
      case "photo": {
        // photo: el pipeline encola las fotos con el id del listing dueño.
        const patch =
          decision === "approve"
            ? { status: "published", published_at: new Date().toISOString() }
            : { status: "removed" };
        await supabase.from("listings").update(patch).eq("id", item.subject_id);
        break;
      }
      case "message": {
        // §5.4: los mensajes son de los participantes; el staff no tiene rama
        // de UPDATE/DELETE por RLS a propósito. Rechazar un mensaje flaggeado
        // = borrarlo vía admin client, SOLO tras verificar el rol arriba.
        if (decision === "reject") {
          const admin = createAdminClient();
          await admin
            .from("messages")
            .delete()
            .eq("id", item.subject_id)
            .eq("tenant_id", item.tenant_id);
        }
        break;
      }
      case "profile":
      default:
        // profiles no tiene status moderable hoy: la resolución de la cola es
        // el registro; sanciones de cuenta son otra rebanada (Trust/It. futura).
        break;
    }
  } catch (error) {
    // La cola ya quedó resuelta y auditada — el efecto secundario fallido se
    // loguea sin contenido y no rompe el panel.
    console.error(
      "[admin] efecto sobre el subject falló:",
      error instanceof Error ? error.message : "error desconocido",
    );
  }

  // 4. Auditoría (admin client gateado — solo ids, jamás contenido §5.4).
  await logAdminAction({
    actorId: user.id,
    action: decision === "approve" ? "moderation.approved" : "moderation.rejected",
    tenantId: item.tenant_id,
    subjectKind: item.subject_kind,
    subjectId: item.subject_id,
    meta: { queue_id: item.id, tier: item.tier },
  });

  revalidatePath("/admin/moderacion");
  revalidatePath("/admin", "layout");
  return { status: "success" };
}
