"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTenantMatch } from "@/lib/tenant/guard";
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
 *   (anon + cookies): RLS es la frontera real. La foto del post ahora sube al
 *   bucket post-media (0025) con el cliente del USUARIO (path {tenant}/{user}/…),
 *   así que ya no hay desvío por admin client para storage.
 * - Todo texto pasa por moderateText ANTES de decidir el status (§8).
 * - El admin client aparece SOLO para encolar en moderation_queue (RLS
 *   insert=false para usuarios) — uso permitido §6.
 *
 * FLUJO DE MODERACIÓN (feedback cliente 2026-07-19):
 * - Publicación INSTANTÁNEA de posts con foto: sin Vision configurado el post
 *   NACE 'published' y se encola para revisión asíncrona (tier humano). El
 *   pending_review con foto mataba el feed visual; la red de seguridad son
 *   reporte en 2 taps, bloqueos, sanciones y el panel /admin/moderacion.
 * - Si Vision SÍ está configurado, se mantiene el screening síncrono actual (la
 *   foto no fuerza revisión acá). El TEXTO sí gobierna pending_review: flagged
 *   o tier humano NO se publica hasta que un humano lo resuelva.
 *
 * DESVÍO DOCUMENTADO (gana el contrato de la DB):
 * - Comentario flagged: la policy comments_insert solo permite nacer
 *   'published' — no existe 'pending_review' para el JWT del autor. Se sigue
 *   el precedente de MENSAJES: el comentario NO se inserta, el intento se
 *   encola (tier 3, body en reasons) y el usuario recibe un aviso cálido
 *   para reformular.
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
  /** Publicar COMO esta entidad (listing propio published) — RLS lo valida. */
  entityId: z.uuid().optional(),
});

const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export type CreatePostResult =
  | {
      ok: true;
      status: "published" | "pending_review";
      /** Id del post creado — el composer arma el link a /impulsar-post. */
      postId: string;
      /** true si se publicó COMO una entidad (ofrecer promoción). */
      entity: boolean;
    }
  | { ok: false; code: "invalid" | "unauthenticated" | "photo" | "error" }
  /** El JWT y el header apuntan a comunidades distintas — copy ya resuelto. */
  | { ok: false; code: "tenant-mismatch"; message: string };

function devAutoApprove(): boolean {
  const isProduction =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  return process.env.MODERATION_DEV_AUTO_APPROVE === "true" && !isProduction;
}

export async function createPostAction(formData: FormData): Promise<CreatePostResult> {
  const parsed = postSchema.safeParse({
    body: formData.get("body"),
    kind: formData.get("kind"),
    entityId: formData.get("entityId") || undefined,
  });
  if (!parsed.success) return { ok: false, code: GENERIC_INVALID };
  const { body, kind, entityId } = parsed.data;

  const photoEntry = formData.get("photo");
  const photo = photoEntry instanceof File && photoEntry.size > 0 ? photoEntry : null;
  if (photo && (!PHOTO_TYPES[photo.type] || photo.size > MAX_PHOTO_BYTES)) {
    return { ok: false, code: "photo" };
  }

  // Foto OBLIGATORIA en posts (feedback cliente 2026-07-19), no en preguntas.
  // Defensa en profundidad: la UX del composer ya lo evita y el trigger
  // MEDIA_REQUIRED (0023) es la última línea; acá fallamos antes de tocar
  // storage/DB para no dejar basura ni una foto huérfana.
  if (kind === "post" && !photo) {
    return { ok: false, code: "photo" };
  }

  // Guard ANTES de moderar y ANTES de subir la foto. Sin este chequeo, la foto
  // de un usuario cuyo JWT es de otro tenant intentaría escribir en el prefijo
  // {tenant_id} equivocado del bucket (la policy post_media_insert la rechaza,
  // pero mejor no gastar el intento) y recién después fallaría el insert.
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

  // ---- Foto: publicación instantánea + revisión asíncrona -----------------
  // Sin Vision, la foto YA NO fuerza pending_review (mataba el feed visual): el
  // post nace published y la imagen entra a la cola humana para revisarse
  // después. Con Vision configurado se mantiene el screening síncrono actual
  // (la foto no encola acá). El TEXTO sigue gobernando pending_review.
  const autoApprove = devAutoApprove();
  const photoNeedsAsyncReview = Boolean(photo) && !isVisionConfigured && !autoApprove;

  const status: "published" | "pending_review" =
    moderation.flagged || tier === TIER_HUMAN ? "pending_review" : "published";

  // ---- Subida de foto: bucket post-media con el CLIENTE DEL USUARIO (0025).
  // La policy post_media_insert exige path {tenant_id}/{user_id}/… — ya no hace
  // falta el admin client (terminó el desvío histórico a listing-photos).
  let mediaPaths: string[] = [];
  if (photo) {
    const extension = PHOTO_TYPES[photo.type];
    const path = `${tenant.id}/${user.id}/post-${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("post-media")
      .upload(path, photo, { contentType: photo.type, upsert: false });
    if (uploadError) {
      console.warn("[feed] subida de foto de post falló", {
        message: uploadError.message,
      });
      return { ok: false, code: "photo" };
    }
    mediaPaths = [path];
  }

  // ---- Insert con el JWT del usuario: la RLS valida tenant/autor/status y,
  // si viene entity_listing_id, que el listing sea propio y published (0023).
  const { data: created, error: insertError } = await supabase
    .from("posts")
    .insert({
      tenant_id: tenant.id,
      author_id: user.id,
      body,
      kind,
      media: mediaPaths,
      status,
      entity_listing_id: entityId ?? null,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    console.warn("[feed] insert de post falló", { code: insertError?.code });
    return { ok: false, code: "error" };
  }

  // ---- Cola de moderación (admin, uso permitido §6) ------------------------
  const shouldEnqueue =
    moderation.flagged || moderation.skipped || tier > TIER_AUTO || photoNeedsAsyncReview;
  if (shouldEnqueue) {
    try {
      const reasons = [
        ...(moderation.skipped ? ["moderation_skipped"] : moderation.categories),
        ...(photoNeedsAsyncReview ? ["photo_async_review"] : []),
      ];
      // pending_review → cola humana; publicado con foto sin Vision → cola
      // humana igual (la imagen necesita ojos), pero el post ya está visible.
      const enqueueTier =
        status === "pending_review" || photoNeedsAsyncReview ? TIER_HUMAN : TIER_REVIEW;
      const outcome = await enqueueModeration(createAdminClient(), {
        tenantId: tenant.id,
        subjectKind: "post",
        subjectId: created.id,
        aiScore: moderation.skipped ? null : moderation.score,
        reasons,
        tier: enqueueTier,
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
  return { ok: true, status, postId: created.id, entity: Boolean(entityId) };
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
