"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/notify";
import { getTenant } from "@/lib/tenant/resolve";
import { sendEmailInBackground } from "@/lib/email";
import { getRecipientEmail } from "@/lib/email/recipients";
import { leadReceivedEmail } from "@/lib/email/templates";
import { COPY } from "@/components/listings/copy";

/**
 * Server actions del módulo VIVIENDA (lado detalle).
 * Contacto protegido §9.2: el teléfono/dirección jamás se exponen — todo
 * contacto nace como conversación pending vía RPC request_contact.
 */

const listingIdSchema = z.uuid();

/**
 * `tone` le dice al cliente qué variante de toast usar sin que tenga que
 * interpretar el mensaje: "info" para aclaraciones amables (aviso propio, sin
 * cuenta) y "error" para fallas reales. Nunca "danger" — ningún caso acá amerita
 * un toast alarmante.
 */
export type RequestContactResult =
  | { ok: true; conversationId: string }
  | {
      ok: false;
      title: string;
      error: string;
      tone: "info" | "error";
      needsAuth?: boolean;
    };

/**
 * El RPC request_contact lanza excepciones con prefijo de código
 * (`CANNOT_CONTACT_SELF: …`, `LISTING_NOT_AVAILABLE: …`). Extraemos SOLO el
 * token de código y lo mapeamos a copy propio — nunca hacemos string-match del
 * mensaje en español (frágil) ni exponemos el texto crudo del RPC.
 */
function contactErrorFromRpc(message: string | undefined): RequestContactResult {
  const code = message?.match(/^\s*([A-Z_]+)\s*:/)?.[1] ?? "";
  switch (code) {
    case "CANNOT_CONTACT_SELF":
      // No es un error: el usuario es el dueño del aviso. Toast informativo.
      return {
        ok: false,
        tone: "info",
        title: COPY.detail.contactOwnTitle,
        error: COPY.detail.contactOwnBody,
      };
    case "LISTING_HAS_NO_ACCOUNT":
      // Caso demo típico: el publicador no tiene cuenta, no hay a quién escribir.
      return {
        ok: false,
        tone: "info",
        title: COPY.detail.contactNoAccountTitle,
        error: COPY.detail.contactNoAccountBody,
      };
    case "LISTING_NOT_AVAILABLE":
    case "LISTING_NOT_FOUND":
      return {
        ok: false,
        tone: "error",
        title: COPY.detail.contactUnavailableTitle,
        error: COPY.detail.contactUnavailableBody,
      };
    case "AUTH_REQUIRED":
      return {
        ok: false,
        tone: "info",
        needsAuth: true,
        title: COPY.detail.contactAuthTitle,
        error: COPY.detail.contactAuthBody,
      };
    default:
      // Código desconocido: no sabemos qué pasó — lo tratamos como demo.
      return {
        ok: false,
        tone: "error",
        title: COPY.detail.contactDemoTitle,
        error: COPY.detail.contactDemoBody,
      };
  }
}

export async function requestContactAction(
  rawListingId: string,
): Promise<RequestContactResult> {
  const parsed = listingIdSchema.safeParse(rawListingId);
  if (!parsed.success) {
    return {
      ok: false,
      tone: "error",
      title: COPY.detail.contactUnavailableTitle,
      error: COPY.detail.contactUnavailableBody,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      tone: "info",
      needsAuth: true,
      title: COPY.detail.contactAuthTitle,
      error: COPY.detail.contactAuthBody,
    };
  }

  const { data, error } = await supabase.rpc("request_contact", {
    p_listing_id: parsed.data,
  });

  if (error) {
    // Sin PII en logs: solo el id del listing y el código del error.
    console.warn("[vivienda] request_contact falló", {
      listingId: parsed.data,
      code: error.code,
    });
    // Mapeo robusto por CÓDIGO del RPC (prefijo antes de `:`), no por substring
    // del mensaje. La idempotencia la resuelve el propio RPC: si ya existe una
    // conversación, devuelve su id por el camino ok:true — no lanza excepción.
    return contactErrorFromRpc(error.message);
  }

  // Aviso al dueño del listing (best-effort, §12): el insert de notifications
  // es solo del sistema (RLS with check false), por eso va con admin client.
  // Si algo falla acá, la solicitud de contacto ya salió — jamás se rompe.
  try {
    const { data: listing } = await supabase
      .from("listings")
      .select("title, created_by, tenant_id")
      .eq("id", parsed.data)
      .maybeSingle();
    if (listing?.created_by && listing.created_by !== user.id) {
      const admin = createAdminClient();
      await createNotification(admin, {
        tenantId: listing.tenant_id,
        profileId: listing.created_by,
        kind: "contact_request",
        title: `Alguien quiere contactarte por "${listing.title}"`,
        body: "Entrá a Mensajes para aceptar o ignorar la solicitud.",
        href: "/mensajes",
      });

      // Email "lead recibido" al dueño (módulo EMAILS, fire-and-forget).
      // Minimización §11: del interesado viaja SOLO su display_name.
      const [tenant, ownerEmail, { data: requester }] = await Promise.all([
        getTenant(),
        getRecipientEmail(admin, listing.created_by),
        supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
      ]);
      if (ownerEmail) {
        const lead = leadReceivedEmail({
          listingTitle: listing.title,
          requesterDisplayName: requester?.display_name ?? "Alguien de la comunidad",
          tenantName: tenant.name,
          brandHex: tenant.brandHex,
        });
        sendEmailInBackground({ to: ownerEmail, subject: lead.subject, html: lead.html });
      }
    }
  } catch (notifyError) {
    // Sin PII: solo el error técnico.
    console.warn("[vivienda] no se pudo notificar al dueño del listing:", {
      listingId: parsed.data,
      message: notifyError instanceof Error ? notifyError.message : "error desconocido",
    });
  }

  return { ok: true, conversationId: typeof data === "string" ? data : "" };
}
