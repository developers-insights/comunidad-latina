"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/notify";
import { getTenant } from "@/lib/tenant/resolve";
import { sendEmailInBackground } from "@/lib/email";
import { getRecipientEmail } from "@/lib/email/recipients";
import { newMessageEmail } from "@/lib/email/templates";
import { isOpenAIConfigured } from "@/lib/config/services";

/**
 * Server actions del módulo MENSAJES — contacto protegido (§9.2).
 * Todo pasa por el cliente server (anon + cookies): RLS es la frontera real.
 * El admin client aparece SOLO para encolar moderación server-side (§6 del contrato).
 */

export type ActionResult =
  | { ok: true }
  | { ok: false; code: "flagged" | "invalid" | "unauthenticated" | "error" };

const uuidSchema = z.string().uuid();

const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  body: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(2000)),
});

const reportScamSchema = z.object({
  // Los kinds válidos del RPC report_scam (0014_rpcs.sql): listing | profile | message.
  targetKind: z.enum(["profile", "listing", "message"]),
  targetId: z.string().uuid(),
  reason: z.string().min(1).max(80),
  details: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(1000))
    .optional(),
});

/**
 * Moderación de texto inline (omni-moderation). Degradación elegante §5.6:
 * sin OPENAI_API_KEY o ante error de red se salta con log (null) — el mensaje
 * de texto se entrega igual; el gate duro es solo para imágenes.
 * NUNCA se loguea el contenido del mensaje (PII).
 */
async function moderateText(
  body: string,
): Promise<{ flagged: boolean; categories: string[] } | null> {
  if (!isOpenAIConfigured) return null;
  try {
    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI();
    const response = await openai.moderations.create({
      model: "omni-moderation-latest",
      input: body,
    });
    const result = response.results[0];
    if (!result) return null;
    const categories = Object.entries(result.categories)
      .filter(([, value]) => value === true)
      .map(([key]) => key);
    return { flagged: result.flagged, categories };
  } catch (error) {
    console.error(
      "[mensajes] moderación de texto no disponible — se envía sin moderar:",
      error instanceof Error ? error.message : "error desconocido",
    );
    return null;
  }
}

export async function sendMessageAction(input: {
  conversationId: string;
  body: string;
}): Promise<ActionResult> {
  const parsed = sendMessageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const { conversationId, body } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "unauthenticated" };

  // La conversación solo es visible para sus participantes (RLS) — esto valida
  // membresía y nos da el tenant_id real sin confiar en el cliente.
  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .select("id, tenant_id, status, created_by, counterpart_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (convError || !conversation) return { ok: false, code: "error" };
  if (conversation.status !== "accepted") return { ok: false, code: "invalid" };

  const moderation = await moderateText(body);
  if (moderation?.flagged) {
    // No se entrega: queda en la cola para revisión humana. El insert va con
    // admin client porque moderation_queue es insert-only para el pipeline
    // (RLS with check false para JWT de usuario) — uso permitido por §6.
    try {
      const admin = createAdminClient();
      const { error: queueError } = await admin.from("moderation_queue").insert({
        tenant_id: conversation.tenant_id,
        subject_kind: "message",
        subject_id: crypto.randomUUID(), // el mensaje nunca se insertó: id sintético del intento
        tier: 3,
        reasons: {
          source: "openai_omni_moderation",
          categories: moderation.categories,
          body,
          conversation_id: conversationId,
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

  const { error: insertError } = await supabase.from("messages").insert({
    tenant_id: conversation.tenant_id,
    conversation_id: conversationId,
    sender_id: user.id,
    body,
  });
  if (insertError) return { ok: false, code: "error" };

  // Aviso a la contraparte (best-effort, §12): la conversación ya está
  // accepted (validado arriba). El insert de notifications es solo del
  // sistema (RLS with check false) → admin client. dedupeUnread evita una
  // notificación por mensaje: mientras tenga una sin leer de este hilo, no
  // se apila otra. Si falla, el mensaje ya se entregó — no se rompe nada.
  try {
    const recipientId =
      conversation.created_by === user.id
        ? conversation.counterpart_id
        : conversation.created_by;
    const { data: me } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();
    const admin = createAdminClient();
    const notified = await createNotification(admin, {
      tenantId: conversation.tenant_id,
      profileId: recipientId,
      kind: "message",
      title: me?.display_name
        ? `${me.display_name} te escribió`
        : "Tenés un mensaje nuevo",
      body: "Abrí la conversación para leerlo.",
      href: `/mensajes/${conversationId}`,
      dedupeUnread: true,
    });

    // Email "mensaje nuevo" (módulo EMAILS, fire-and-forget). Anti-ruido:
    // si la notificación se dedupeó (ya tiene una sin leer de este hilo),
    // tampoco mandamos otro email — un solo aviso hasta que abra el chat.
    // Privacidad: el email JAMÁS incluye el contenido del mensaje.
    if (notified.ok && !notified.deduped) {
      const [tenant, recipientEmail] = await Promise.all([
        getTenant(),
        getRecipientEmail(admin, recipientId),
      ]);
      if (recipientEmail) {
        const mail = newMessageEmail({
          senderDisplayName: me?.display_name ?? "Alguien de la comunidad",
          conversationId,
          tenantName: tenant.name,
          brandHex: tenant.brandHex,
        });
        sendEmailInBackground({ to: recipientEmail, subject: mail.subject, html: mail.html });
      }
    }
  } catch (notifyError) {
    // Sin PII: solo el error técnico, nunca el contenido del mensaje.
    console.warn(
      "[mensajes] no se pudo notificar a la contraparte:",
      notifyError instanceof Error ? notifyError.message : "error desconocido",
    );
  }

  revalidatePath(`/mensajes/${conversationId}`);
  revalidatePath("/mensajes");
  return { ok: true };
}

export async function acceptConversationAction(
  conversationId: string,
): Promise<ActionResult> {
  const parsed = uuidSchema.safeParse(conversationId);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "unauthenticated" };

  // RPC canónica: solo la contraparte puede aceptar (lo valida la función).
  const { error } = await supabase.rpc("accept_conversation", {
    p_conversation_id: parsed.data,
  });
  if (error) return { ok: false, code: "error" };

  revalidatePath(`/mensajes/${parsed.data}`);
  revalidatePath("/mensajes");
  return { ok: true };
}

export async function ignoreConversationAction(
  conversationId: string,
): Promise<ActionResult> {
  const parsed = uuidSchema.safeParse(conversationId);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "unauthenticated" };

  // "Ignorar" = blocked. RLS: solo la contraparte puede cambiar el estado,
  // y la lista filtra blocked — desaparece del inbox sin drama.
  const { error } = await supabase
    .from("conversations")
    .update({ status: "blocked" })
    .eq("id", parsed.data);
  if (error) return { ok: false, code: "error" };

  revalidatePath("/mensajes");
  return { ok: true };
}

export async function reportScamAction(input: {
  targetKind: "profile" | "listing" | "message";
  targetId: string;
  reason: string;
  details?: string;
}): Promise<ActionResult> {
  const parsed = reportScamSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "unauthenticated" };

  const { error } = await supabase.rpc("report_scam", {
    p_target_kind: parsed.data.targetKind,
    p_target_id: parsed.data.targetId,
    p_reason: parsed.data.reason,
    ...(parsed.data.details ? { p_details: parsed.data.details } : {}),
  });
  if (error) return { ok: false, code: "error" };

  return { ok: true };
}
