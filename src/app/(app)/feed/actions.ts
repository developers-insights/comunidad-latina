"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTenantMatch } from "@/lib/tenant/guard";
import type { Json } from "@/lib/types/database.types";
import { isVisionConfigured } from "@/lib/config/services";
import {
  TIER_HUMAN,
  TIER_REVIEW,
  enqueueModeration,
  moderateText,
  moderationTier,
  TIER_AUTO,
} from "@/lib/moderation";

/**
 * Server actions del módulo FEED SOCIAL.
 *
 * Reglas que gobiernan este archivo:
 * - Todo INSERT/UPDATE de contenido va con el cliente server del usuario
 *   (anon + cookies): RLS es la frontera real.
 * - Todo texto pasa por moderateText ANTES de decidir el status (§8).
 * - El admin client aparece SOLO para actos de moderación server-side
 *   (encolar en moderation_queue, subir la foto del post al bucket) y cada
 *   uso privilegiado queda registrado en audit_log (§6 del contrato).
 *
 * DESVÍOS DOCUMENTADOS (gana el contrato de la DB):
 * 1. Comentario flagged: la policy comments_insert solo permite nacer
 *    'published' — no existe 'pending_review' para el JWT del autor. Se sigue
 *    el precedente de MENSAJES: el comentario NO se inserta, el intento se
 *    encola (tier 3, body en reasons) y el usuario recibe un aviso cálido
 *    para reformular.
 * 2. Foto de post: la policy de storage de listing-photos exige que el
 *    segundo segmento del path sea un LISTING propio — un post no tiene
 *    listing. La subida va vía admin client (acto server-side controlado:
 *    sesión verificada, tipo/tamaño validados, path canónico
 *    {tenant_id}/{user_id}/post-{uuid}.{ext}) y se registra en audit_log.
 * 3. §5.6 sigue intacto: post con foto y sin Vision configurado queda
 *    'pending_review' (salvo MODERATION_DEV_AUTO_APPROVE fuera de prod).
 */

const GENERIC_INVALID = "invalid" as const;

// ---------------------------------------------------------------------------
// Crear post (composer del feed)
// ---------------------------------------------------------------------------

const postSchema = z.object({
  body: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(2).max(2000)),
  kind: z.enum(["post", "question"]),
});

const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export type CreatePostResult =
  | { ok: true; status: "published" | "pending_review" }
  | { ok: false; code: "invalid" | "unauthenticated" | "photo" | "error" }
  /** El JWT y el header apuntan a comunidades distintas — copy ya resuelto. */
  | { ok: false; code: "tenant-mismatch"; message: string };

/** Registra en audit_log (via admin) un acto privilegiado — best effort. */
async function auditAdminAction(input: {
  tenantId: string;
  actorId: string;
  action: string;
  subjectKind: string;
  subjectId: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("audit_log").insert({
      tenant_id: input.tenantId,
      actor_id: input.actorId,
      action: input.action,
      subject_kind: input.subjectKind,
      subject_id: input.subjectId,
      meta: (input.meta ?? {}) as Json,
    });
    if (error) {
      console.warn("[feed] audit_log no disponible", { code: error.code });
    }
  } catch {
    // Admin no configurado: la acción principal no se bloquea por el log.
  }
}

function devAutoApprove(): boolean {
  const isProduction =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  return process.env.MODERATION_DEV_AUTO_APPROVE === "true" && !isProduction;
}

export async function createPostAction(formData: FormData): Promise<CreatePostResult> {
  const parsed = postSchema.safeParse({
    body: formData.get("body"),
    kind: formData.get("kind"),
  });
  if (!parsed.success) return { ok: false, code: GENERIC_INVALID };
  const { body, kind } = parsed.data;

  const photoEntry = formData.get("photo");
  const photo = photoEntry instanceof File && photoEntry.size > 0 ? photoEntry : null;
  if (photo && (!PHOTO_TYPES[photo.type] || photo.size > MAX_PHOTO_BYTES)) {
    return { ok: false, code: "photo" };
  }

  // Guard ANTES de moderar y ANTES de subir la foto. La subida va con el admin
  // client (bypassea la RLS de storage, desvío #2): sin este chequeo, la foto
  // de un usuario cuyo JWT es de otro tenant aterrizaba en el prefijo
  // {tenant_id} EQUIVOCADO del bucket y recién después la RLS rechazaba el
  // insert de `posts` — archivo huérfano, sin fila, sin audit_log.
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { ok: false, code: "unauthenticated" };
    if (guard.reason === "tenant-mismatch") {
      return { ok: false, code: "tenant-mismatch", message: guard.message };
    }
    return { ok: false, code: "error" };
  }
  const { tenant, supabase, user } = guard;

  // ---- Moderación de texto ANTES de publicar (§8) -------------------------
  const moderation = await moderateText(body);
  const tier = moderation.flagged ? TIER_HUMAN : moderationTier(moderation.score);

  // ---- Foto: sin Vision, una imagen JAMÁS se publica sola (§5.6) ----------
  const autoApprove = devAutoApprove();
  const photoNeedsReview = Boolean(photo) && !isVisionConfigured && !autoApprove;

  const status: "published" | "pending_review" =
    moderation.flagged || tier === TIER_HUMAN || photoNeedsReview
      ? "pending_review"
      : "published";

  // ---- Subida de foto (admin, desvío documentado #2) -----------------------
  let mediaPaths: string[] = [];
  if (photo) {
    const extension = PHOTO_TYPES[photo.type];
    const path = `${tenant.id}/${user.id}/post-${crypto.randomUUID()}.${extension}`;
    try {
      const admin = createAdminClient();
      const { error: uploadError } = await admin.storage
        .from("listing-photos")
        .upload(path, photo, { contentType: photo.type, upsert: false });
      if (uploadError) {
        console.warn("[feed] subida de foto de post falló", {
          message: uploadError.message,
        });
        return { ok: false, code: "photo" };
      }
      mediaPaths = [path];
    } catch {
      // Admin no configurado — degradación elegante: pedimos publicar sin foto.
      return { ok: false, code: "photo" };
    }
  }

  // ---- Insert con el JWT del usuario: la RLS valida tenant/autor/status ----
  const { data: created, error: insertError } = await supabase
    .from("posts")
    .insert({
      tenant_id: tenant.id,
      author_id: user.id,
      body,
      kind,
      media: mediaPaths,
      status,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    console.warn("[feed] insert de post falló", { code: insertError?.code });
    return { ok: false, code: "error" };
  }

  if (mediaPaths.length > 0) {
    await auditAdminAction({
      tenantId: tenant.id,
      actorId: user.id,
      action: "feed.post_photo_uploaded_via_admin",
      subjectKind: "post",
      subjectId: created.id,
      meta: { path: mediaPaths[0], reason: "storage_policy_listing_scoped" },
    });
  }

  // ---- Cola de moderación (admin, uso permitido §6) ------------------------
  const shouldEnqueue =
    moderation.flagged || moderation.skipped || tier > TIER_AUTO || photoNeedsReview;
  if (shouldEnqueue) {
    try {
      const reasons = [
        ...(moderation.skipped ? ["moderation_skipped"] : moderation.categories),
        ...(photoNeedsReview ? ["photo_pending_review"] : []),
      ];
      const outcome = await enqueueModeration(createAdminClient(), {
        tenantId: tenant.id,
        subjectKind: "post",
        subjectId: created.id,
        aiScore: moderation.skipped ? null : moderation.score,
        reasons,
        tier: status === "pending_review" ? TIER_HUMAN : TIER_REVIEW,
      });
      if (!outcome.ok) {
        console.warn("[feed] no se pudo encolar moderación del post", {
          postId: created.id,
        });
      }
    } catch {
      console.warn("[feed] admin client no disponible para encolar moderación");
    }
  }

  revalidatePath("/feed");
  return { ok: true, status };
}

// ---------------------------------------------------------------------------
// Crear comentario (detalle de post) — misma moderación
// ---------------------------------------------------------------------------

const commentSchema = z.object({
  postId: z.uuid(),
  body: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(1000)),
});

export type CreateCommentResult =
  | { ok: true }
  | { ok: false; code: "invalid" | "unauthenticated" | "flagged" | "error" }
  /** El JWT y el header apuntan a comunidades distintas — copy ya resuelto. */
  | { ok: false; code: "tenant-mismatch"; message: string };

export async function createCommentAction(input: {
  postId: string;
  body: string;
}): Promise<CreateCommentResult> {
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: GENERIC_INVALID };
  const { postId, body } = parsed.data;

  // Guard antes de moderar: sin coincidencia de tenant, `comments_insert` va a
  // rechazar igual — no gastamos una llamada a la API de moderación.
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { ok: false, code: "unauthenticated" };
    if (guard.reason === "tenant-mismatch") {
      return { ok: false, code: "tenant-mismatch", message: guard.message };
    }
    return { ok: false, code: "error" };
  }
  const { tenant, supabase, user } = guard;

  const moderation = await moderateText(body);

  if (moderation.flagged) {
    // Desvío documentado #1: comments_insert solo permite 'published' — el
    // comentario flagged NO se inserta; el intento queda en la cola humana
    // (precedente del módulo MENSAJES) y el autor recibe aviso cálido.
    try {
      const admin = createAdminClient();
      const { error: queueError } = await admin.from("moderation_queue").insert({
        tenant_id: tenant.id,
        subject_kind: "comment",
        subject_id: crypto.randomUUID(), // nunca se insertó: id sintético del intento
        tier: TIER_HUMAN,
        ai_score: moderation.score,
        reasons: {
          source: "openai_omni_moderation",
          categories: moderation.categories,
          body,
          post_id: postId,
          author_id: user.id,
        },
      });
      if (queueError) {
        console.warn("[feed] no se pudo encolar comentario flagged", {
          code: queueError.code,
        });
      }
    } catch {
      console.warn("[feed] admin client no disponible para encolar comentario");
    }
    return { ok: false, code: "flagged" };
  }

  // RLS: valida autor, tenant y que el post exista published en este tenant.
  const { data: created, error: insertError } = await supabase
    .from("comments")
    .insert({
      tenant_id: tenant.id,
      post_id: postId,
      author_id: user.id,
      body,
      status: "published",
    })
    .select("id")
    .single();

  if (insertError || !created) {
    console.warn("[feed] insert de comentario falló", { code: insertError?.code });
    return { ok: false, code: "error" };
  }

  // Score intermedio o moderación saltada → publica pero entra a monitoreo.
  const tier = moderationTier(moderation.score);
  if (moderation.skipped || tier > TIER_AUTO) {
    try {
      await enqueueModeration(createAdminClient(), {
        tenantId: tenant.id,
        subjectKind: "comment",
        subjectId: created.id,
        aiScore: moderation.skipped ? null : moderation.score,
        reasons: moderation.skipped ? ["moderation_skipped"] : moderation.categories,
        tier: TIER_REVIEW,
      });
    } catch {
      console.warn("[feed] admin client no disponible para encolar comentario");
    }
  }

  revalidatePath(`/feed/${postId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reportar un post como estafa → RPC report_scam contra el PERFIL del autor
// (la RPC solo acepta listing | profile | message — no existe kind 'post';
// el post reportado viaja en p_details para el equipo de moderación).
// ---------------------------------------------------------------------------

// Espejo de REPORT_REASONS en src/components/escudo/report-reasons.ts
// (un archivo "use server" solo puede exportar funciones async).
const REPORT_REASON_VALUES = [
  "Pidió dinero por adelantado",
  "La dirección no existe",
  "Se hace pasar por otra persona",
  "El precio es irreal",
  "Otro",
] as const;

const reportSchema = z.object({
  postId: z.uuid(),
  reason: z.enum(REPORT_REASON_VALUES),
  details: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(500))
    .optional(),
});

export type ReportPostResult =
  | { ok: true }
  | { ok: false; code: "invalid" | "unauthenticated" | "error" };

export async function reportPostAction(input: {
  postId: string;
  reason: string;
  details?: string;
}): Promise<ReportPostResult> {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: GENERIC_INVALID };
  const { postId, reason, details } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "unauthenticated" };

  // El post visible via RLS nos da el autor real — no confiamos en el cliente.
  const { data: post, error: postError } = await supabase
    .from("posts")
    .select("id, author_id")
    .eq("id", postId)
    .maybeSingle();
  if (postError || !post?.author_id) return { ok: false, code: "error" };

  const detailsWithContext = [`Post reportado: /feed/${postId}`, details]
    .filter(Boolean)
    .join(" — ");

  const { error } = await supabase.rpc("report_scam", {
    p_target_kind: "profile",
    p_target_id: post.author_id,
    p_reason: reason,
    p_details: detailsWithContext,
  });
  if (error) {
    console.warn("[feed] report_scam falló", { code: error.code });
    return { ok: false, code: "error" };
  }

  return { ok: true };
}
