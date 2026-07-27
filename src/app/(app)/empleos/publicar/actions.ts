"use server";

import { z } from "zod";
import { DAY_MS, limit } from "@/lib/rate-limit";
import { isVisionConfigured } from "@/lib/config/services";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTenantMatch } from "@/lib/tenant/guard";
import {
  TIER_AUTO,
  TIER_HUMAN,
  TIER_REVIEW,
  enqueueModeration,
  moderateText,
  moderationTier,
} from "@/lib/moderation";
import {
  EMPLOYMENT_TYPES,
  JOB_PAY_PERIODS,
  jobQuestionsSchema,
  parseJobAttrs,
} from "@/components/empleos/helpers";
import { COPY } from "@/components/empleos/copy";

/**
 * Server actions de /empleos/publicar — publicar un EMPLEO comunitario
 * (listing kind='job'). Espejo fiel del publish de Creadores
 * (creadores/actions.ts) y del Marketplace: MISMO flujo de dos fases, dictado
 * por los contratos de DB/Storage, no por gusto:
 *
 *  1. createJobDraft → INSERT status='draft' (la RLS de listings, 0004, prohíbe
 *     que un aviso de usuario NAZCA published). Devuelve el listingId, que hace
 *     falta para subir fotos: la policy de storage exige el path
 *     {tenant_id}/{listing_id}/…
 *  2. El cliente sube hasta 4 fotos (OPCIONALES) al bucket listing-photos.
 *  3. finalizeJob → escribe las fotos, modera el texto y decide el status.
 *
 * DIFERENCIAS PROPIAS DE EMPLEOS (todo lo demás es el patrón del repo):
 *  - `kind: 'job'` se fija ACÁ, nunca llega del cliente.
 *  - SALARIO OBLIGATORIO (transparencia — feedback 24/7): a diferencia del
 *    wizard genérico, un empleo sin monto no se publica. Va a price_amount con
 *    price_period ∈ {hour, day, week, month} — la DB ya admite 'hour' (0004) y
 *    PERIOD_SUFFIX ya rinde "/hora".
 *  - attrs = { employment_type, questions }: las preguntas al postulante viven
 *    en el aviso (contrato de components/empleos/helpers.ts, jobQuestionsSchema)
 *    y se validan de nuevo acá — el cliente puede mandar cualquier cosa.
 */

const C = COPY.publish;

// ===========================================================================
// Borrador
// ===========================================================================

const jobDraftSchema = z.object({
  title: z.string().trim().min(8).max(120),
  description: z.string().trim().min(30).max(4000),
  /** Obligatorio: no hay empleo sin salario a la vista. */
  salaryAmount: z.number().positive().max(1_000_000),
  payPeriod: z.enum(JOB_PAY_PERIODS),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  areaLabel: z.string().trim().min(3).max(80),
  /** Contrato compartido: hasta 5, sí/no u opción múltiple con 2–6 opciones. */
  questions: jobQuestionsSchema,
});

export type JobDraftInput = z.input<typeof jobDraftSchema>;

export type CreateJobDraftResult =
  | { ok: true; listingId: string }
  | { ok: false; error: string; needsAuth?: boolean };

export async function createJobDraft(
  rawInput: JobDraftInput,
): Promise<CreateJobDraftResult> {
  // Zod PURO primero (sin I/O): un payload roto no consume guard ni cuota.
  const parsed = jobDraftSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: C.errors.generic };
  }
  const input = parsed.data;

  // Guard ANTES de cualquier efecto colateral (regla del repo, lib/tenant/guard.ts):
  // si el tenant del JWT no coincide con el del request, la RLS va a rechazar el
  // insert — no quemamos rate limit ni tocamos storage por una escritura muerta.
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: C.needLoginCta };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`empleos-publicar:${user.id}`, 10, DAY_MS).ok) {
    return { ok: false, error: C.errors.generic };
  }

  const attrs = {
    employment_type: input.employmentType,
    questions: input.questions,
  };

  const { data: created, error } = await supabase
    .from("listings")
    .insert({
      tenant_id: tenant.id,
      kind: "job",
      title: input.title,
      description: input.description,
      price_amount: input.salaryAmount,
      price_currency: tenant.currency,
      price_period: input.payPeriod,
      attrs,
      area_label: input.areaLabel,
      status: "draft",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !created) {
    console.warn("[empleos] insert de borrador falló", { code: error?.code });
    return { ok: false, error: C.errors.generic };
  }

  return { ok: true, listingId: created.id };
}

// ===========================================================================
// Cierre (fotos + moderación + status)
// ===========================================================================

const finalizeJobSchema = z.object({
  listingId: z.uuid(),
  photoPaths: z.array(z.string().min(1).max(300)).max(4),
});

export type FinalizeJobResult =
  | { ok: true; status: "published" | "pending_review" }
  | { ok: false; error: string; needsAuth?: boolean };

// Auto-aprobación SOLO fuera de producción — helper idéntico al del FEED
// (feed/actions.ts), Creadores y Marketplace. Duplicado a propósito: cada
// módulo es dueño de su política de publicación.
function devAutoApprove(): boolean {
  const isProduction =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  return process.env.MODERATION_DEV_AUTO_APPROVE === "true" && !isProduction;
}

export async function finalizeJob(rawInput: {
  listingId: string;
  photoPaths: string[];
}): Promise<FinalizeJobResult> {
  const parsed = finalizeJobSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: C.errors.generic };
  }
  const { listingId, photoPaths } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: C.needLoginCta };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  // Finalize es re-invocable (reintentos legítimos de subida de fotos), pero
  // no gratis: sin cuota propia sería el motor de la re-publicación en loop.
  if (!limit(`empleos-finalize:${user.id}`, 20, DAY_MS).ok) {
    return { ok: false, error: C.errors.generic };
  }

  // Paths canónicos {tenant_id}/{listing_id}/archivo — bucket listing-photos.
  const pathPattern = new RegExp(
    `^${tenant.id}/${listingId}/[A-Za-z0-9._-]+\\.(webp|jpe?g|png)$`,
    "i",
  );
  if (!photoPaths.every((path) => pathPattern.test(path) && !path.includes(".."))) {
    return { ok: false, error: C.errors.generic };
  }

  // UPDATE con el cliente del USUARIO: escribe las fotos y pasa a
  // 'pending_review'. La RLS de listings (0004) NUNCA deja que el dueño escriba
  // status='published' (anti bait-and-switch post-verificación) — ese salto lo
  // hace el admin client más abajo. El mismo round-trip RE-CONFIRMA ownership
  // (.eq de tenant/creador/kind) y trae el texto para moderar.
  // `.in(status, draft|pending_review)`: un aviso dado de baja por moderación
  // ('removed') NO se re-publica llamando finalize de nuevo — eso lo decide
  // un humano en la cola, no este flujo.
  const { data: updated, error: updateError } = await supabase
    .from("listings")
    .update({ photos: photoPaths, status: "pending_review" })
    .eq("id", listingId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    .eq("kind", "job")
    .in("status", ["draft", "pending_review"])
    .select("id, title, description, attrs")
    .maybeSingle();

  if (updateError || !updated) {
    console.warn("[empleos] finalize del aviso falló", {
      listingId,
      code: updateError?.code,
    });
    return { ok: false, error: C.errors.generic };
  }

  // ---- Moderación de texto ANTES de decidir el status (§8). Las PREGUNTAS y
  // sus opciones son texto público del anunciante (se renderizan en el detalle
  // y en la hoja de postulación): entran a la moderación junto con el título —
  // el "mandá $75 por Zelle para reservar la entrevista" clásico vive ahí, no
  // en la descripción.
  const questionsText = parseJobAttrs(updated.attrs)
    .questions.flatMap((question) => [question.label, ...(question.options ?? [])])
    .join("\n");
  const moderation = await moderateText(
    `${updated.title}\n${updated.description ?? ""}\n${questionsText}`,
  );
  const tier = moderation.flagged ? TIER_HUMAN : moderationTier(moderation.score);

  // ---- Foto: publicación instantánea + revisión asíncrona (feedback cliente
  // 2026-07-19, misma política que el FEED y que Creadores). Sin Vision la foto
  // NO retiene el aviso —si lo hiciera, un empleo con foto se "publicaría" y no
  // aparecería nunca— pero entra a la cola humana para revisarse después.
  // El TEXTO sigue siendo lo único que gobierna pending_review.
  const autoApprove = devAutoApprove();
  const photoNeedsAsyncReview = photoPaths.length > 0 && !isVisionConfigured && !autoApprove;

  let status: "published" | "pending_review" =
    moderation.flagged || tier === TIER_HUMAN ? "pending_review" : "published";

  // ---- Nacer published: exclusivo del admin client (la RLS del dueño lo
  // prohíbe). Ownership ya verificado en el UPDATE de arriba.
  if (status === "published") {
    try {
      const admin = createAdminClient();
      const { error: publishError } = await admin
        .from("listings")
        .update({ status: "published", published_at: new Date().toISOString() })
        .eq("id", listingId)
        .eq("tenant_id", tenant.id)
        .eq("created_by", user.id);
      if (publishError) {
        // No se pudo publicar → queda en revisión (nunca rompemos el flujo).
        console.warn("[empleos] no se pudo publicar el aviso, queda en revisión", {
          listingId,
          code: publishError.code,
        });
        status = "pending_review";
      }
    } catch {
      // Admin no configurado → el aviso queda en revisión.
      status = "pending_review";
    }
  }

  // ---- Cola de moderación (admin, uso permitido §6) — para que el aviso sea
  // resoluble desde /admin/moderacion en vez de quedar huérfano.
  const shouldEnqueue =
    moderation.flagged || moderation.skipped || tier > TIER_AUTO || photoNeedsAsyncReview;
  if (shouldEnqueue) {
    try {
      const reasons = [
        ...(moderation.skipped ? ["moderation_skipped"] : moderation.categories),
        ...(photoNeedsAsyncReview ? ["photo_async_review"] : []),
      ];
      const enqueueTier =
        status === "pending_review" || photoNeedsAsyncReview ? TIER_HUMAN : TIER_REVIEW;
      const outcome = await enqueueModeration(createAdminClient(), {
        tenantId: tenant.id,
        subjectKind: "listing",
        subjectId: listingId,
        aiScore: moderation.skipped ? null : moderation.score,
        reasons,
        tier: enqueueTier,
      });
      if (!outcome.ok) {
        console.warn("[empleos] no se pudo encolar moderación del aviso", { listingId });
      }
    } catch {
      console.warn("[empleos] admin client no disponible para encolar moderación");
    }
  }

  return { ok: true, status };
}
