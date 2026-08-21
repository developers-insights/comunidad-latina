"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";
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
  | {
      ok: true;
      conversationId: string;
      /**
       * `true` = ya había una conversación por este aviso y el mensaje se sumó
       * ahí. `undefined` = no se pudo averiguar, y entonces NO se afirma nada:
       * la pantalla usa el texto neutro. Nunca se pinta un alta nueva sobre una
       * conversación vieja (feedback de la revisión de código, 2026-08).
       */
      reused?: boolean;
    }
  | {
      ok: false;
      code:
        | "unauthenticated"
        | "tenant-mismatch"
        | "self"
        | "blocked"
        | "invalid"
        | "rate-limited"
        | "flagged"
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

  /**
   * TECHO Y MODERACIÓN, ANTES DE CREAR NADA (auditoría de seguridad 2026-08-20).
   *
   * Esta action nació para el "mensaje de presentación" del marketplace, pero
   * desde esta rama es también el canal de contacto de Propiedades y
   * Profesionales — donde antes se mandaba una solicitud VACÍA. O sea: pasó a
   * escribir texto libre de un usuario en `messages`, la misma tabla que
   * `sendMessageAction`, y esa hermana ya documenta por qué no se puede hacer
   * sin tope ni moderación: "una cuenta sola es a la vez una factura y un canal
   * de hostigamiento con nuestro remitente". Cada llamada además dispara una
   * notificación y un mail al dueño del aviso.
   *
   * El bucket es EL MISMO (`mensaje:<uid>`) que el de `sendMessageAction`: si
   * fueran dos, el techo real sería el doble y no serviría de nada.
   *
   * Va antes del RPC a propósito: un mensaje rechazado no tiene que dejar atrás
   * una conversación pendiente que la otra persona ve aparecer sin contenido.
   */
  if (!limit(`mensaje:${user.id}`, 120, HOUR_MS).ok) {
    return { ok: false, code: "rate-limited" };
  }

  const moderation = await moderateText(body);
  if (moderation.flagged) {
    // No se entrega, pero tampoco se pierde: queda para revisión humana.
    // `moderation_queue` es insert-only para el pipeline (RLS `with check
    // false` para JWT de usuario), así que va con admin client — uso permitido
    // por §6, igual que en `mensajes/actions.ts`.
    try {
      const admin = createAdminClient();
      const { error: queueError } = await admin.from("moderation_queue").insert({
        tenant_id: tenant.id,
        subject_kind: "message",
        // El mensaje nunca se insertó: id sintético del intento.
        subject_id: crypto.randomUUID(),
        tier: 3,
        reasons: {
          source: "openai_omni_moderation",
          categories: moderation.categories,
          body,
          listing_id: listingId,
          sender_id: user.id,
        },
      });
      if (queueError) {
        console.error("[mensajes] no se pudo encolar moderación:", queueError.message);
      }
    } catch (error) {
      console.error(
        "[mensajes] admin client no disponible para encolar moderación:",
        error instanceof Error ? error.message : "error desconocido",
      );
    }
    return { ok: false, code: "flagged" };
  }

  // ¿Ya veníamos hablando por este aviso? Se pregunta ANTES del RPC porque
  // después es tarde: `request_contact` es idempotente y devuelve el mismo id
  // haya creado la conversación o la haya encontrado, así que a la salida las
  // dos situaciones son indistinguibles. El índice único (listing_id,
  // created_by) garantiza que hay a lo sumo una fila.
  //
  // Best-effort a propósito: si esta lectura falla, `reused` queda `undefined`
  // y la pantalla usa el texto neutro. Preferimos no decir nada antes que
  // afirmar un alta nueva sobre una conversación que ya existía.
  let reused: boolean | undefined;
  try {
    const { data: prior } = await supabase
      .from("conversations")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("listing_id", listingId)
      .eq("created_by", user.id)
      .maybeSingle();
    reused = Boolean(prior);
  } catch {
    reused = undefined;
  }

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

  /**
   * Aviso al dueño (best-effort, espejo de requestContactAction §12): el insert
   * de notifications es solo del sistema (RLS with check false) → admin client.
   * Si esto falla, el mensaje YA salió — jamás rompe el resultado.
   *
   * Se saltea cuando la conversación YA existía (auditoría 2026-08-20). Ese
   * caso no es un contacto nuevo: es alguien escribiendo otra vez en un hilo
   * abierto, y ahí "te contactaron por tu aviso" —con su mail— es un aviso
   * repetido que la persona ya recibió. Además era el pedal que convertía
   * escribir muchas veces en mandar muchos mails con nuestro remitente.
   * `reused === undefined` (la lectura falló) avisa igual: ante la duda,
   * preferimos un aviso de más antes que perder un contacto real.
   */
  if (reused === true) {
    /**
     * Pero SÍ se avisa que hay un mensaje nuevo (revisión de código
     * 2026-08-21). Saltear el bloque entero era peor que el problema que venía
     * a resolver: el hilo ya existía, así que la bandeja no estrena badge, y
     * la persona podía quedarse sin enterarse para siempre mientras la
     * pantalla de quien escribió decía "te avisamos apenas te respondan".
     *
     * Lo que se saltea es el `contact_request` y su mail de lead: eso es "te
     * contactaron por tu aviso", y ya se mandó la primera vez. Acá va el aviso
     * de CHAT, con `dedupeUnread` — el mismo que usa `sendMessageAction`
     * (`mensajes/actions.ts:170`) justamente para no convertir una conversación
     * activa en una lluvia de notificaciones.
     */
    try {
      const [{ data: listing }, { data: me }] = await Promise.all([
        supabase
          .from("listings")
          .select("created_by, tenant_id")
          .eq("id", listingId)
          .maybeSingle(),
        supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
      ]);
      // Sin dueño, o si el dueño soy yo, no hay a quién avisarle.
      if (!listing?.created_by || listing.created_by === user.id) {
        revalidatePath("/mensajes");
        return { ok: true, conversationId, reused };
      }
      const admin = createAdminClient();
      await createNotification(admin, {
        tenantId: listing.tenant_id,
        profileId: listing.created_by,
        kind: "message",
        category: "mensajes",
        title: me?.display_name
          ? `${me.display_name} te escribió`
          : "Tenés un mensaje nuevo",
        // PRIVACIDAD: el cuerpo NUNCA lleva el texto (se lee de costado en
        // pantallas compartidas). Mismo criterio que el chat.
        body: "Abrí la conversación para leerlo.",
        href: `/mensajes/${conversationId}`,
        dedupeUnread: true,
      });
    } catch (notifyError) {
      // El mensaje YA se insertó: un aviso que falla nunca cambia el resultado.
      console.warn("[mensajes] no se pudo avisar del mensaje en el hilo existente:", {
        message:
          notifyError instanceof Error ? notifyError.message : "error desconocido",
      });
    }
    revalidatePath("/mensajes");
    return { ok: true, conversationId, reused };
  }

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
  return { ok: true, conversationId, reused };
}
