"use server";

import { z } from "zod";
import { DAY_MS, limit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { isVisionConfigured } from "@/lib/config/services";
import {
  TIER_AUTO,
  TIER_HUMAN,
  TIER_REVIEW,
  enqueueModeration,
  moderateText,
  moderationTier,
} from "@/lib/moderation";
import { isProductCategory } from "@/components/marketplace/helpers";

/**
 * Server actions de /marketplace/publicar.
 *
 * MISMO flujo de dos fases que /publicar (dictado por los contratos de
 * DB/Storage — NO es un flujo nuevo de storage, ver AGENTS.md del módulo):
 *  1. createProductDraft → INSERT status='draft', kind='product' (la RLS de
 *     listings prohíbe que un aviso de usuario NAZCA published). Devuelve el
 *     listingId para poder subir fotos: la RLS de storage exige path
 *     {tenant_id}/{listing_id}/… con listing propio.
 *  2. El cliente sube hasta 4 fotos al bucket listing-photos con su sesión.
 *  3. finalizeProduct → setea fotos, modera el texto (título+descripción,
 *     patrón feed/actions.ts) y pasa a 'pending_review'. A diferencia de
 *     publicar/actions.ts (que hoy NO encola), acá SÍ se llama
 *     enqueueModeration — igual que FEED — para que el producto sea
 *     revisable desde /admin/moderacion.
 *
 * DESVÍO DOCUMENTADO (gana el contrato de la DB, mismo que /publicar):
 * la policy listings_insert/update solo permite status draft/pending_review
 * para el JWT del usuario — "published" queda exclusivo de staff/admin client.
 */

const CONDITIONS = ["nuevo", "usado"] as const;

const draftSchema = z.object({
  storeListingId: z.uuid(),
  title: z.string().trim().min(8).max(120),
  description: z.string().trim().min(10).max(4000),
  priceAmount: z.number().positive().max(1_000_000),
  category: z.string().refine(isProductCategory, "categoría inválida"),
  condition: z.enum(CONDITIONS).nullish(),
});

export type DraftInput = z.input<typeof draftSchema>;

export type CreateDraftResult =
  | { ok: true; listingId: string }
  | { ok: false; error: string; needsAuth?: boolean };

const COPY = {
  invalid: "Revisá los datos del producto — hay algo incompleto.",
  needsAuth: "Para publicar necesitás entrar a tu cuenta.",
  storeInvalid: "Elegí una tienda válida — puede que ya no esté disponible.",
  tooManyToday:
    "Ya publicaste varios productos hoy. Para cuidar la calidad del marketplace, esperá hasta mañana para publicar otro.",
  genericError:
    "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo en un ratito.",
} as const;

const GENERIC_ERROR = COPY.genericError;

export async function createProductDraft(rawInput: DraftInput): Promise<CreateDraftResult> {
  const parsed = draftSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: COPY.invalid };
  }
  const input = parsed.data;

  // Guard ANTES del rate limit y de cualquier efecto (patrón obligatorio del
  // repo, src/lib/tenant/guard.ts): si el tenant del JWT no coincide con el
  // del header, la RLS va a rechazar el insert — no quemamos cuota ni tocamos
  // storage por una escritura que no podía prosperar.
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: COPY.needsAuth };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`marketplace-publicar:${user.id}`, 10, DAY_MS).ok) {
    return { ok: false, error: COPY.tooManyToday };
  }

  // attrs.store_listing_id es jsonb SIN foreign key: sin este chequeo,
  // cualquier uuid ajeno pasaría como "mi tienda". Tiene que ser un negocio
  // propio y publicado — mismo criterio que ofrece el <Select> del form.
  const { data: store, error: storeError } = await supabase
    .from("listings")
    .select("id")
    .eq("id", input.storeListingId)
    .eq("tenant_id", tenant.id)
    .eq("kind", "business")
    .eq("created_by", user.id)
    .eq("status", "published")
    .maybeSingle();

  if (storeError || !store) {
    return { ok: false, error: COPY.storeInvalid };
  }

  const attrs: Record<string, string> = {
    store_listing_id: store.id,
    category: input.category,
  };
  if (input.condition) attrs.condition = input.condition;

  const { data: created, error } = await supabase
    .from("listings")
    .insert({
      tenant_id: tenant.id,
      kind: "product",
      title: input.title,
      description: input.description,
      price_amount: input.priceAmount,
      price_currency: tenant.currency,
      price_period: null,
      attrs,
      status: "draft",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !created) {
    console.warn("[marketplace] insert de borrador falló", { code: error?.code });
    return { ok: false, error: GENERIC_ERROR };
  }

  return { ok: true, listingId: created.id };
}

// ---------------------------------------------------------------------------

const finalizeSchema = z.object({
  listingId: z.uuid(),
  photoPaths: z.array(z.string().min(1).max(300)).max(4),
});

export type FinalizeResult =
  | { ok: true; status: "published" | "pending_review" }
  | { ok: false; error: string; needsAuth?: boolean };

function devAutoApprove(): boolean {
  const isProduction =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  return process.env.MODERATION_DEV_AUTO_APPROVE === "true" && !isProduction;
}

export async function finalizeProduct(rawInput: {
  listingId: string;
  photoPaths: string[];
}): Promise<FinalizeResult> {
  const parsed = finalizeSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: GENERIC_ERROR };
  }
  const { listingId, photoPaths } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: COPY.needsAuth };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  // Paths canónicos {tenant_id}/{listing_id}/{archivo} — nada fuera del folder del aviso.
  const pathPattern = new RegExp(
    `^${tenant.id}/${listingId}/[A-Za-z0-9._-]+\\.(webp|jpe?g|png)$`,
    "i",
  );
  if (!photoPaths.every((path) => pathPattern.test(path) && !path.includes(".."))) {
    return { ok: false, error: GENERIC_ERROR };
  }

  // Confirma ownership y trae título/descripción para moderar el texto — el
  // mismo round-trip que el UPDATE necesitaría de todos modos.
  const { data: current, error: readError } = await supabase
    .from("listings")
    .select("id, title, description")
    .eq("id", listingId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    .eq("kind", "product")
    .maybeSingle();

  if (readError || !current) {
    console.warn("[marketplace] finalize: producto no encontrado", { listingId });
    return { ok: false, error: GENERIC_ERROR };
  }

  // ---- Moderación de texto ANTES de decidir el status (§8) -----------------
  const moderation = await moderateText(`${current.title}\n${current.description ?? ""}`);
  const tier = moderation.flagged ? TIER_HUMAN : moderationTier(moderation.score);

  // ---- Fotos: sin Vision, una imagen JAMÁS se publica sola (§5.6) ----------
  const autoApprove = devAutoApprove();
  const photoNeedsReview = photoPaths.length > 0 && !isVisionConfigured && !autoApprove;

  const wantsPublish = autoApprove && !moderation.flagged && tier <= TIER_AUTO && !photoNeedsReview;

  // La RLS de UPDATE del dueño NUNCA permite status=published (anti
  // bait-and-switch post-verificación) — solo draft/pending_review/paused/
  // removed. Acá siempre pasa a pending_review con el cliente del usuario;
  // el branch "published" (solo dev) lo hace el admin client más abajo.
  const { error: updateError } = await supabase
    .from("listings")
    .update({ photos: photoPaths, status: "pending_review" })
    .eq("id", listingId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id);

  if (updateError) {
    console.warn("[marketplace] finalize falló", { listingId, code: updateError.code });
    return { ok: false, error: GENERIC_ERROR };
  }

  let finalStatus: "published" | "pending_review" = "pending_review";

  if (wantsPublish) {
    // Auto-aprobación DEV: acto de moderación server-side (uso permitido del
    // cliente admin) tras verificar ownership arriba. Estructuralmente
    // imposible en producción (devAutoApprove() ya lo descarta).
    try {
      const admin = createAdminClient();
      const { error: publishError } = await admin
        .from("listings")
        .update({ status: "published", published_at: new Date().toISOString() })
        .eq("id", listingId)
        .eq("tenant_id", tenant.id)
        .eq("created_by", user.id);
      if (!publishError) {
        finalStatus = "published";
      } else {
        console.warn("[marketplace] auto-aprobación dev falló", {
          listingId,
          code: publishError.code,
        });
      }
    } catch {
      // Admin no configurado — el producto queda en revisión, nunca rompemos.
    }
  }

  // ---- Cola de moderación (§8/§12) ------------------------------------------
  // A diferencia de /publicar (que hoy no encola), acá SÍ — mismo patrón que
  // feed/actions.ts — para que un producto pending_review sea resoluble desde
  // /admin/moderacion en vez de quedar huérfano.
  if (finalStatus === "pending_review") {
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
          subjectKind: "listing",
          subjectId: listingId,
          aiScore: moderation.skipped ? null : moderation.score,
          reasons,
          tier: moderation.flagged || photoNeedsReview ? TIER_HUMAN : TIER_REVIEW,
        });
        if (!outcome.ok) {
          console.warn("[marketplace] no se pudo encolar moderación del producto", {
            listingId,
          });
        }
      } catch {
        console.warn("[marketplace] admin client no disponible para encolar moderación");
      }
    }
  }

  return { ok: true, status: finalStatus };
}
