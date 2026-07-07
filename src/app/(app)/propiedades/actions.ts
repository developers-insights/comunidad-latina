"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

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

  return { ok: true, conversationId: typeof data === "string" ? data : "" };
}
