"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { supabaseSinTiparGrupos } from "@/lib/messaging/grupos";

/**
 * CONTACTO DIRECTO PERSONA → PERSONA.
 *
 * Es la mitad del punto 7 del feedback del 3/9: «yo te quiero mensajear a ti:
 * busco Manuel Navarro y te mando un mensaje directo». Hasta hoy la única
 * puerta a un chat era un AVISO (`request_contact`), y el botón "Enviar
 * mensaje" del perfil mostraba un toast que decía «muy pronto».
 *
 * Toda la lógica sensible vive en la RPC `solicitar_contacto_directo` (0134),
 * que es SECURITY DEFINER y valida tenant, auto-contacto, bloqueo de perfil y
 * —lo importante— que no se pueda abrir un hilo nuevo con alguien que ya te
 * ignoró. Acá arriba sólo quedan zod, el techo por persona y la traducción de
 * los códigos del RPC a copy propio.
 */

const abrirSchema = z.object({ profileId: z.uuid() });

export type AbrirChatResult =
  | { ok: true; conversationId: string }
  | {
      ok: false;
      code: "unauthenticated" | "tenant-mismatch" | "blocked" | "self" | "invalid" | "rate-limited" | "error";
    };

/**
 * El RPC lanza excepciones con prefijo de código (`USER_BLOCKED: …`).
 * Se extrae SOLO el token: nunca string-match del texto en español ni el
 * mensaje crudo del RPC en pantalla (mismo criterio que `messageErrorFromRpc`
 * en inline-actions.ts).
 */
function errorDelRpc(message: string | undefined): AbrirChatResult {
  const code = message?.match(/^\s*([A-Z_]+)\s*:/)?.[1] ?? "";
  switch (code) {
    case "USER_BLOCKED":
      return { ok: false, code: "blocked" };
    case "CANNOT_CONTACT_SELF":
      return { ok: false, code: "self" };
    case "AUTH_REQUIRED":
      return { ok: false, code: "unauthenticated" };
    case "PROFILE_NOT_FOUND":
      // Deliberadamente indistinguible de un bloqueo hacia afuera: la RPC ya
      // contesta lo mismo para "no existe" y "es de otra comunidad", y acá no
      // se agrega una tercera señal que permita deducir cuál fue.
      return { ok: false, code: "blocked" };
    default:
      return { ok: false, code: "error" };
  }
}

export async function abrirChatDirectoAction(input: {
  profileId: string;
}): Promise<AbrirChatResult> {
  const parsed = abrirSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { ok: false, code: "unauthenticated" };
    if (guard.reason === "tenant-mismatch") return { ok: false, code: "tenant-mismatch" };
    return { ok: false, code: "error" };
  }
  const { supabase, user } = guard;

  /**
   * Techo propio y separado del de mensajes.
   *
   * Abrir un chat no manda texto, pero SÍ crea una fila que la otra persona ve
   * como "Fulano quiere contactarte". Con un buscador de nombres arriba de la
   * bandeja, sin tope una sola cuenta puede sembrar una solicitud a cada
   * persona de la comunidad en un rato. 40 por hora es holgado para alguien
   * que está buscando gente de verdad.
   */
  if (!limit(`contacto-directo:${user.id}`, 40, HOUR_MS).ok) {
    return { ok: false, code: "rate-limited" };
  }

  const { data, error } = await supabaseSinTiparGrupos(supabase).rpc(
    "solicitar_contacto_directo",
    { p_profile_id: parsed.data.profileId },
  );

  if (error) {
    // Sin PII: ni el nombre ni el id de la otra persona en el log.
    console.warn("[mensajes] solicitar_contacto_directo falló", { code: error.code });
    return errorDelRpc(error.message);
  }

  const conversationId = typeof data === "string" ? data : "";
  if (!conversationId) return { ok: false, code: "error" };

  revalidatePath("/mensajes");
  return { ok: true, conversationId };
}
