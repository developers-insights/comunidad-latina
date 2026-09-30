import { createAdminClient } from "@/lib/supabase/admin";
import {
  TIER_HUMAN,
  TIER_REVIEW,
  enqueueModeration,
  type ModerationTier,
} from "@/lib/moderation";

export interface SenalesDeRevision {
  status: string;
  /** Algo que tiene que mirar una persona: texto marcado, foto o video sin revisar, integridad. */
  exigeHumano: boolean;
  /** Publicable, pero para monitorear: tier 2 o moderación salteada. */
  monitorear: boolean;
}

export type DecisionDeCola = { encolar: false } | { encolar: true; tier: ModerationTier };

/**
 * /admin/moderacion lista la COLA, no `listings`: un aviso en `pending_review`
 * sin fila abierta en `moderation_queue` no lo ve nadie nunca. Por eso quedarse
 * en revisión encola SIEMPRE, con o sin otra señal.
 */
export function decidirEncolado(s: SenalesDeRevision): DecisionDeCola {
  const enRevision = s.status === "pending_review";
  if (!enRevision && !s.exigeHumano && !s.monitorear) return { encolar: false };
  return { encolar: true, tier: enRevision || s.exigeHumano ? TIER_HUMAN : TIER_REVIEW };
}

export type EncolarResultado = "sin_cola" | "encolado" | "fallo";

export async function encolarSiQuedaEnRevision(
  entrada: SenalesDeRevision & {
    tenantId: string;
    listingId: string;
    aiScore: number | null;
    reasons: string[];
    /** Por qué está en revisión si ninguna señal lo explica (`new_listing`, `edited_listing`…). */
    motivoEnRevision: string;
    /** Prefijo del log: quién encola. */
    origen: string;
  },
): Promise<EncolarResultado> {
  const decision = decidirEncolado(entrada);
  if (!decision.encolar) return "sin_cola";

  const reasons =
    entrada.status === "pending_review" && !entrada.reasons.includes(entrada.motivoEnRevision)
      ? [...entrada.reasons, entrada.motivoEnRevision]
      : entrada.reasons;

  try {
    const outcome = await enqueueModeration(createAdminClient(), {
      tenantId: entrada.tenantId,
      subjectKind: "listing",
      subjectId: entrada.listingId,
      aiScore: entrada.aiScore,
      reasons,
      tier: decision.tier,
    });
    if (outcome.ok) return "encolado";
    console.warn(`[${entrada.origen}] no se pudo encolar la revisión del aviso`, {
      listingId: entrada.listingId,
      error: outcome.error,
    });
  } catch (error) {
    console.warn(`[${entrada.origen}] admin client no disponible para encolar moderación`, {
      listingId: entrada.listingId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return "fallo";
}
