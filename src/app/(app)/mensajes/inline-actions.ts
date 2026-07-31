"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { getTenant } from "@/lib/tenant/resolve";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/notify";
import { sendEmailInBackground } from "@/lib/email";
import { getRecipientEmail } from "@/lib/email/recipients";
import { leadReceivedEmail } from "@/lib/email/templates";
import { COPY } from "@/components/listings/copy";

/**
 * Mensaje INLINE desde una publicación (marketplace/eventos): crea —o reutiliza—
 * la conversación pendiente vía `request_contact` y le adjunta el mensaje de
 * presentación, sin sacar a nadie de la pantalla donde estaba.
 *
 * Contacto protegido §9.2 intacto: el teléfono/dirección jamás se exponen; el
 * hilo nace `pending` y la contraparte acepta o ignora. La policy
 * `messages_insert` (0006) permite escribir al CREADOR mientras está pending
 * —justo este caso, el "mensaje de presentación"— y también si ya está
 * accepted; en `blocked` no escribe nadie.
 *
 * Reglas del archivo: zod puro primero, `requireTenantMatch()` ANTES de tocar el
 * RPC (crear la conversación es un efecto: no queremos hilos huérfanos de un
 * request que la RLS iba a rechazar), y todo con el cliente del USUARIO.
 */

const sendSchema = z.object({
  listingId: z.uuid(),
  body: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(2000)),
});

export type SendListingMessageResult =
  | { ok: true; conversationId: string }
  | {
      ok: false;
      code:
        | "unauthenticated"
        | "tenant-mismatch"
        | "self"
        | "blocked"
        | "invalid"
        | "error";
      message?: string;
    };

/**
 * El RPC lanza excepciones con prefijo de código (`CANNOT_CONTACT_SELF: …`).
 * Extraemos SOLO el token y lo mapeamos a copy propio — nunca string-match del
 * mensaje en español, ni el texto crudo del RPC en pantalla (mismo criterio que
 * `contactErrorFromRpc` en propiedades/actions.ts).
 */
function messageErrorFromRpc(message: string | undefined): SendListingMessageResult {
  const code = message?.match(/^\s*([A-Z_]+)\s*:/)?.[1] ?? "";
  switch (code) {
    case "CANNOT_CONTACT_SELF":
      // No es un error: el aviso es suyo. La UI lo dice en tono amable.
      return { ok: false, code: "self", message: COPY.detail.contactOwnBody };
    case "USER_BLOCKED":
      // MISMO texto en ambas direcciones: quién bloqueó a quién no se filtra.
      return {
        ok: false,
        code: "blocked",
        message: "El contacto con esta persona no está disponible.",
      };
    case "AUTH_REQUIRED":
      return {
        ok: false,
        code: "unauthenticated",
        message: COPY.detail.contactAuthBody,
      };
    case "ACCOUNT_SUSPENDED":
      return {
        ok: false,
        code: "error",
        message: "Tu cuenta está en revisión y por ahora no puede enviar mensajes.",
      };
    case "LISTING_HAS_NO_ACCOUNT":
      return {
        ok: false,
        code: "error",
        message: COPY.detail.contactNoAccountBody,
      };
    case "LISTING_NOT_AVAILABLE":
    case "LISTING_NOT_FOUND":
      return {
        ok: false,
        code: "error",
        message: COPY.detail.contactUnavailableBody,
      };
    default:
      // Código desconocido: no sabemos qué pasó — lo tratamos como demo.
      return { ok: false, code: "error", message: COPY.detail.contactDemoBody };
  }
}

export async function sendListingMessageAction(input: {
  listingId: string;
  body: string;
}): Promise<SendListingMessageResult> {
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const { listingId, body } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return {
        ok: false,
        code: "unauthenticated",
        message: COPY.detail.contactAuthBody,
      };
    }
    if (guard.reason === "tenant-mismatch") {
      return { ok: false, code: "tenant-mismatch", message: guard.message };
    }
    return { ok: false, code: "error", message: guard.message };
  }
  const { tenant, supabase, user } = guard;

  // Idempotente por contrato del RPC: si ya pedí contacto por este aviso,
  // devuelve la conversación existente en vez de crear otra.
  const { data, error } = await supabase.rpc("request_contact", {
    p_listing_id: listingId,
  });

  if (error) {
    // Sin PII: solo el id del aviso y el código técnico.
    console.warn("[mensajes] request_contact falló", {
      listingId,
      code: error.code,
    });
    return messageErrorFromRpc(error.message);
  }

  const conversationId = typeof data === "string" ? data : "";
  if (!conversationId) {
    return { ok: false, code: "error", message: COPY.detail.contactDemoBody };
  }

  const { error: messageError } = await supabase.from("messages").insert({
    tenant_id: tenant.id,
    conversation_id: conversationId,
    sender_id: user.id,
    body,
  });

  if (messageError) {
    console.warn("[mensajes] insert del mensaje de presentación falló", {
      code: messageError.code,
    });
    // La solicitud YA salió: no mentimos diciendo que no pasó nada.
    return {
      ok: false,
      code: "error",
      message:
        "Enviamos tu solicitud, pero el mensaje no se pudo adjuntar. Podés escribirle desde Mensajes.",
    };
  }

  // Aviso al dueño (best-effort, espejo de requestContactAction §12): el insert
  // de notifications es solo del sistema (RLS with check false) → admin client.
  // Si esto falla, el mensaje YA salió — jamás rompe el resultado.
  try {
    const { data: listing } = await supabase
      .from("listings")
      .select("title, created_by, tenant_id")
      .eq("id", listingId)
      .maybeSingle();
    if (listing?.created_by && listing.created_by !== user.id) {
      const admin = createAdminClient();
      await createNotification(admin, {
        tenantId: listing.tenant_id,
        profileId: listing.created_by,
        kind: "contact_request",
        // "mensajes" y no "propiedades": una solicitud de contacto ABRE una
        // conversación, así que vive en el mismo hilo que el chat. Es el mismo
        // criterio del backfill de 0045; separarlos partiría en dos pestañas la
        // misma conversación.
        category: "mensajes",
        priority: "high",
        title: `Te escribieron por "${listing.title}"`,
        body: "Entrá a Mensajes para leer el mensaje y aceptar o ignorar la solicitud.",
        href: "/mensajes",
      });

      // Email "lead recibido" (fire-and-forget). Minimización §11: del
      // interesado viaja SOLO su display_name.
      const [fullTenant, ownerEmail, { data: requester }] = await Promise.all([
        getTenant(),
        getRecipientEmail(admin, listing.created_by),
        supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
      ]);
      if (ownerEmail) {
        const lead = leadReceivedEmail({
          listingTitle: listing.title,
          requesterDisplayName: requester?.display_name ?? "Alguien de la comunidad",
          tenantName: fullTenant.name,
          brandHex: fullTenant.brandHex,
        });
        sendEmailInBackground({ to: ownerEmail, subject: lead.subject, html: lead.html });
      }
    }
  } catch (notifyError) {
    // Sin PII: solo el error técnico.
    console.warn("[mensajes] no se pudo notificar al dueño del aviso:", {
      listingId,
      message: notifyError instanceof Error ? notifyError.message : "error desconocido",
    });
  }

  revalidatePath("/mensajes");
  return { ok: true, conversationId };
}
