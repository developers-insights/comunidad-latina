import "server-only";

import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isOpenAIConfigured } from "@/lib/config/services";
import type { Database, Json, TablesInsert } from "@/lib/types/database.types";

/**
 * =============================================================================
 * MODERACIÓN BASE (módulo PWA+MODERACIÓN) — API para los demás módulos
 * =============================================================================
 *
 * Regla §5.6 (INNEGOCIABLE): NUNCA publicar contenido con imagen sin moderar.
 * Regla §8: ruteo por score 0-100 → 3 niveles (tier 1 auto / 2 revisar /
 * 3 cola humana).
 *
 * USO TÍPICO desde una server action (ej.: publicar un listing):
 *
 * ```ts
 * import { createAdminClient } from "@/lib/supabase/admin";
 * import {
 *   enqueueModeration,
 *   moderateText,
 *   moderationTier,
 *   TIER_AUTO,
 * } from "@/lib/moderation";
 *
 * const result = await moderateText(`${titulo}\n${descripcion}`);
 *
 * if (result.skipped) {
 *   // OpenAI no configurado / falló → degradación elegante: NO bloquear el
 *   // texto, pero dejar constancia en la cola como tier 2 (monitoreo).
 * }
 *
 * const tier = moderationTier(result.score);
 * if (tier > TIER_AUTO || result.skipped) {
 *   await enqueueModeration(createAdminClient(), {
 *     tenantId: tenant.id,
 *     subjectKind: "listing",
 *     subjectId: listing.id,
 *     aiScore: result.skipped ? null : result.score,
 *     reasons: result.skipped ? ["moderation_skipped"] : result.categories,
 *     tier: result.skipped ? TIER_REVIEW : tier,
 *   });
 * }
 * // tier 3 → además dejá el contenido en `pending_review`, no publicado.
 * ```
 *
 * IMÁGENES sin Google Vision configurado (isVisionConfigured === false):
 * NO llames a nada de visión — encolá directo con
 * `enqueueModeration(admin, { subjectKind: "photo", tier: TIER_HUMAN, … })`
 * y dejá el listing en `pending_review`. En dev,
 * `process.env.MODERATION_DEV_AUTO_APPROVE === "true"` permite publicar
 * (decisión del módulo que publica, no de este helper).
 *
 * Server-only: importa el admin client indirectamente (el caller lo pasa) y
 * lee OPENAI_API_KEY — jamás importar desde un client component.
 * =============================================================================
 */

/* ----------------------------- Tiers (§8) ------------------------------- */

/** Score 0-30 → publicación automática. */
export const TIER_AUTO = 1;
/** Score 31-70 → publica pero entra a monitoreo/revisión. */
export const TIER_REVIEW = 2;
/** Score 71-100 → cola humana: NO publicar hasta resolución. */
export const TIER_HUMAN = 3;

export type ModerationTier = typeof TIER_AUTO | typeof TIER_REVIEW | typeof TIER_HUMAN;

/** Umbrales del PLAN §8 (0-30 auto / 31-70 revisar / 71-100 humano). */
export const MODERATION_THRESHOLDS = {
  autoMax: 30,
  reviewMax: 70,
} as const;

/** Mapea un score 0-100 al tier de la cola (`moderation_queue.tier` 1-3). */
export function moderationTier(score: number): ModerationTier {
  if (!Number.isFinite(score)) return TIER_REVIEW; // dato raro → que lo mire alguien
  if (score <= MODERATION_THRESHOLDS.autoMax) return TIER_AUTO;
  if (score <= MODERATION_THRESHOLDS.reviewMax) return TIER_REVIEW;
  return TIER_HUMAN;
}

/* --------------------------- moderateText ------------------------------- */

export type ModerationResult = {
  /** true si OpenAI marcó al menos una categoría. */
  flagged: boolean;
  /** Categorías marcadas (ej. "harassment", "hate") — vacío si limpio. */
  categories: string[];
  /** 0-100: máximo category score, redondeado. 0 si skipped. */
  score: number;
  /** true si la moderación NO corrió (sin OPENAI_API_KEY o error de API). */
  skipped?: boolean;
};

// omni-moderation acepta textos largos, pero un aviso/post nuestro jamás
// necesita más que esto — y acota costo/latencia del peor caso.
const MAX_INPUT_CHARS = 8_000;

/**
 * Modera un texto con `omni-moderation-latest`.
 *
 * Degradación elegante (§5.6): si OpenAI no está configurado o la API falla,
 * devuelve `{ flagged: false, score: 0, skipped: true }` — NUNCA lanza.
 * El caller decide qué hacer con `skipped` (recomendado: encolar tier 2).
 * No loguea el contenido (anti-PII), solo el mensaje de error técnico.
 */
export async function moderateText(text: string): Promise<ModerationResult> {
  const input = text.trim().slice(0, MAX_INPUT_CHARS);

  if (!isOpenAIConfigured || input.length === 0) {
    return { flagged: false, categories: [], score: 0, skipped: true };
  }

  try {
    const openai = new OpenAI();
    const response = await openai.moderations.create({
      model: "omni-moderation-latest",
      input,
    });

    const result = response.results[0];
    if (!result) {
      return { flagged: false, categories: [], score: 0, skipped: true };
    }

    const categories = Object.entries(result.categories ?? {})
      .filter(([, value]) => value === true)
      .map(([key]) => key);

    const maxCategoryScore = Math.max(
      0,
      ...Object.values(result.category_scores ?? {}).filter(
        (value): value is number => typeof value === "number",
      ),
    );

    return {
      flagged: result.flagged,
      categories,
      score: Math.round(Math.min(1, maxCategoryScore) * 100),
    };
  } catch (error) {
    // Solo el error técnico — jamás el texto del usuario (anti-PII).
    console.error(
      "[moderation] moderateText falló, se degrada a skipped:",
      error instanceof Error ? error.message : "error desconocido",
    );
    return { flagged: false, categories: [], score: 0, skipped: true };
  }
}

/* -------------------------- enqueueModeration --------------------------- */

export type SubjectKind = "post" | "comment" | "listing" | "message" | "profile" | "photo";

export type EnqueueModerationInput = {
  tenantId: string;
  subjectKind: SubjectKind;
  subjectId: string;
  /** Tier 1-3. Si se omite, se deriva de aiScore (o TIER_REVIEW sin score). */
  tier?: ModerationTier;
  /** Score 0-100 de la IA; null si la moderación se saltó. */
  aiScore?: number | null;
  /** Motivos legibles (categorías de OpenAI, "moderation_skipped", etc.). */
  reasons?: string[];
};

export type EnqueueModerationOutcome =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Inserta un item en `moderation_queue`.
 *
 * ⚠️ La tabla tiene RLS con `insert: false` para usuarios — SOLO inserta el
 * service role. Pasá el admin client (`createAdminClient()`), y por eso este
 * helper solo puede usarse en server actions / webhooks / cron (server-only).
 * Nunca lanza: devuelve `{ ok: false, error }` para que el caller loguee y
 * decida (regla de oro: nunca un error técnico crudo al usuario).
 */
export async function enqueueModeration(
  admin: SupabaseClient<Database>,
  input: EnqueueModerationInput,
): Promise<EnqueueModerationOutcome> {
  const tier =
    input.tier ??
    (typeof input.aiScore === "number" ? moderationTier(input.aiScore) : TIER_REVIEW);

  const row: TablesInsert<"moderation_queue"> = {
    tenant_id: input.tenantId,
    subject_kind: input.subjectKind,
    subject_id: input.subjectId,
    tier,
    ai_score: input.aiScore ?? null,
    reasons: (input.reasons ?? []) as Json,
  };

  try {
    const { data, error } = await admin
      .from("moderation_queue")
      .insert(row)
      .select("id")
      .single();

    if (error) {
      console.error("[moderation] enqueueModeration falló:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "error desconocido";
    console.error("[moderation] enqueueModeration falló:", message);
    return { ok: false, error: message };
  }
}
