"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/notify";
import { getTenant } from "@/lib/tenant/resolve";
import { sendEmailInBackground } from "@/lib/email";
import { getRecipientEmail } from "@/lib/email/recipients";
import { leadReceivedEmail } from "@/lib/email/templates";

/**
 * Server actions del módulo VIVIENDA (lado detalle).
 * Contacto protegido §9.2: el teléfono/dirección jamás se exponen — todo
 * contacto nace como conversación pending vía RPC request_contact.
 */

const listingIdSchema = z.uuid();

export type RequestContactResult =
  | { ok: true; conversationId: string }
  | { ok: false; error: string; needsAuth?: boolean };

export async function requestContactAction(
  rawListingId: string,
): Promise<RequestContactResult> {
  const parsed = listingIdSchema.safeParse(rawListingId);
  if (!parsed.success) {
    return { ok: false, error: "Ese aviso no existe o ya no está disponible." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      needsAuth: true,
      error: "Para contactar necesitás entrar a tu cuenta.",
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
    const message = error.message?.toLowerCase() ?? "";
    if (message.includes("own") || message.includes("propio")) {
      return { ok: false, error: "Este aviso es tuyo — no hace falta que te contactes." };
    }
    if (message.includes("exists") || message.includes("ya")) {
      // Conversación ya iniciada: no es un error para el usuario.
      return { ok: true, conversationId: "" };
    }
    return {
      ok: false,
      error: "No pudimos enviar tu solicitud — probá de nuevo en un ratito.",
    };
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
