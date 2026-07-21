"use server";

import { z } from "zod";
import { DAY_MS, HOUR_MS, limit } from "@/lib/rate-limit";
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
  findTransition,
  roleOf,
  type ContractAction,
  type ContractStatus,
} from "@/components/creators/contract-machine";
import { dollarsToCents } from "@/components/creators/money";
import { COPY } from "@/components/creators/copy";

/**
 * Server actions del Creator Marketplace (feedback cliente 2026-07-19).
 *
 * Reparto de confianza por tabla (RLS de 0024):
 *  - gig_applications, creator_profiles, gig_reviews → cliente del USUARIO
 *    (la RLS ya autoriza por rol/estado; el server solo valida y da copy cálido).
 *  - gig_contracts → INSERT/UPDATE en false para authenticated: TODA transición
 *    pasa por el cliente ADMIN (service_role) DESPUÉS de verificar en el server:
 *    (a) sesión + tenant (requireTenantMatch), (b) que auth.uid() es la parte
 *    correcta para ESA transición, (c) que la transición es legal (máquina pura).
 *    Espejo del patrón boosts (0016): nadie mueve su propia plata.
 *
 * Pagos SIEMPRE en modo demostración en esta fase (payment_mode='demo'): la
 * máquina de estados es real, los montos son reales, no hay Stripe. Estas
 * actions jamás tocan stripe_* ni las columnas generadas (fee/net).
 */

const GENERIC_ERROR = COPY.apply.errors.generic;

// ===========================================================================
// Aviso (gig) — publicar un trabajo (listing kind='creator_gig')
// ===========================================================================
//
// La RLS de listings (0004) NO deja que un usuario cree/actualice un aviso a
// 'published': nace 'draft' (createGigDraft) y finalizeGig decide el status
// ESPEJANDO EL FEED (feedback cliente 2026-07-19): con texto limpio el aviso
// NACE 'published' vía admin client (aparece al toque en Trabajos) y —sin
// Vision— la foto entra a la cola humana (/admin/moderacion) para revisión a
// posteriori; texto marcado / tier humano queda 'pending_review'. El seed
// publica por service_role.

const GIG_CATEGORIES = ["video", "foto", "campaña", "social", "diseño", "otro"] as const;

const gigDraftSchema = z.object({
  title: z.string().trim().min(8).max(120),
  description: z.string().trim().min(30).max(4000),
  category: z.enum(GIG_CATEGORIES).nullish(),
  budget: z.number().positive().max(1_000_000),
  deliverables: z.string().trim().max(500).nullish(),
  deadlineDays: z.number().int().min(1).max(365).nullish(),
  urgent: z.boolean().optional(),
  areaLabel: z.string().trim().min(3).max(80),
});

export type GigDraftInput = z.input<typeof gigDraftSchema>;

export type CreateGigDraftResult =
  | { ok: true; listingId: string }
  | { ok: false; error: string; needsAuth?: boolean };

export async function createGigDraft(rawInput: GigDraftInput): Promise<CreateGigDraftResult> {
  const parsed = gigDraftSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: COPY.publish.errors.generic };
  }
  const input = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: COPY.publish.needLoginCta };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`gig-publish:${user.id}`, 10, DAY_MS).ok) {
    return { ok: false, error: COPY.publish.errors.generic };
  }

  const attrs: Record<string, string | number | boolean> = {};
  if (input.category) attrs.category = input.category;
  if (input.deliverables) attrs.deliverables = input.deliverables;
  if (input.deadlineDays !== null && input.deadlineDays !== undefined) {
    attrs.deadline_days = input.deadlineDays;
  }
  if (input.urgent) attrs.urgent = true;

  const { data: created, error } = await supabase
    .from("listings")
    .insert({
      tenant_id: tenant.id,
      kind: "creator_gig",
      title: input.title,
      description: input.description,
      price_amount: input.budget,
      price_currency: tenant.currency,
      price_period: "one_time",
      attrs,
      area_label: input.areaLabel,
      status: "draft",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !created) {
    console.warn("[creadores] insert de gig falló", { code: error?.code });
    return { ok: false, error: COPY.publish.errors.generic };
  }

  return { ok: true, listingId: created.id };
}

const finalizeGigSchema = z.object({
  listingId: z.uuid(),
  photoPaths: z.array(z.string().min(1).max(300)).max(6),
});

export type FinalizeGigResult =
  | { ok: true; status: "published" | "pending_review" }
  | { ok: false; error: string; needsAuth?: boolean };

// Auto-aprobación SOLO fuera de producción — helper idéntico al del FEED
// (feed/actions.ts) y del Marketplace (marketplace/publicar/actions.ts).
function devAutoApprove(): boolean {
  const isProduction =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  return process.env.MODERATION_DEV_AUTO_APPROVE === "true" && !isProduction;
}

export async function finalizeGig(rawInput: {
  listingId: string;
  photoPaths: string[];
}): Promise<FinalizeGigResult> {
  const parsed = finalizeGigSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: COPY.publish.errors.generic };
  }
  const { listingId, photoPaths } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: COPY.publish.needLoginCta };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  // Paths canónicos {tenant_id}/{listing_id}/archivo — bucket listing-photos.
  const pathPattern = new RegExp(
    `^${tenant.id}/${listingId}/[A-Za-z0-9._-]+\\.(webp|jpe?g|png)$`,
    "i",
  );
  if (!photoPaths.every((path) => pathPattern.test(path) && !path.includes(".."))) {
    return { ok: false, error: COPY.publish.errors.generic };
  }

  // UPDATE con el cliente del USUARIO: escribe las fotos y pasa a
  // 'pending_review'. La RLS de listings (0004) NUNCA deja que el dueño escriba
  // status='published' (anti bait-and-switch post-verificación) — el salto a
  // published lo hace el admin client más abajo, igual que el seed y que
  // finalizeProduct del Marketplace. El mismo round-trip confirma ownership
  // (.eq) y trae título/descripción para moderar el texto.
  const { data: updated, error: updateError } = await supabase
    .from("listings")
    .update({ photos: photoPaths, status: "pending_review" })
    .eq("id", listingId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    .eq("kind", "creator_gig")
    .select("id, title, description")
    .maybeSingle();

  if (updateError || !updated) {
    console.warn("[creadores] finalize de gig falló", { listingId, code: updateError?.code });
    return { ok: false, error: COPY.publish.errors.generic };
  }

  // ---- Moderación de texto ANTES de decidir el status (§8) — mismo patrón que
  // createPostAction (feed/actions.ts) y finalizeProduct (marketplace).
  const moderation = await moderateText(`${updated.title}\n${updated.description ?? ""}`);
  const tier = moderation.flagged ? TIER_HUMAN : moderationTier(moderation.score);

  // ---- Foto: publicación instantánea + revisión asíncrona (feedback cliente
  // 2026-07-19, espejo del FEED). Sin Vision la foto YA NO fuerza pending_review
  // (mataba Trabajos: el aviso se "publicaba" y nunca aparecía): el aviso NACE
  // published y la imagen entra a la cola humana para revisarse después. Con
  // Vision configurado se mantiene el screening síncrono actual (la foto no
  // encola acá). El TEXTO sigue gobernando pending_review.
  const autoApprove = devAutoApprove();
  const hasPhotos = photoPaths.length > 0;
  const photoNeedsAsyncReview = hasPhotos && !isVisionConfigured && !autoApprove;

  // Espejo EXACTO de createPostAction: la foto NO fuerza pending_review; solo el
  // texto marcado o de tier humano retiene el aviso sin publicar.
  let status: "published" | "pending_review" =
    moderation.flagged || tier === TIER_HUMAN ? "pending_review" : "published";

  // ---- Nacer published: exclusivo del admin client (la RLS del dueño prohíbe
  // 'published'). Ownership ya verificado en el UPDATE de arriba.
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
        console.warn("[creadores] no se pudo publicar el aviso, queda en revisión", {
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

  // ---- Cola de moderación (admin, uso permitido §6) — espejo de
  // createPostAction. El aviso ya está visible en Trabajos; igual entra a la
  // cola para que un humano vea la imagen (sin Vision) o el texto marcado. Se
  // resuelve desde /admin/moderacion, que ya soporta subject_kind='listing'.
  const shouldEnqueue =
    moderation.flagged || moderation.skipped || tier > TIER_AUTO || photoNeedsAsyncReview;
  if (shouldEnqueue) {
    try {
      const reasons = [
        ...(moderation.skipped ? ["moderation_skipped"] : moderation.categories),
        ...(photoNeedsAsyncReview ? ["photo_async_review"] : []),
      ];
      // pending_review → cola humana; publicado con foto sin Vision → cola
      // humana igual (la imagen necesita ojos), pero el aviso ya está visible.
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
        console.warn("[creadores] no se pudo encolar moderación del aviso", { listingId });
      }
    } catch {
      console.warn("[creadores] admin client no disponible para encolar moderación");
    }
  }

  return { ok: true, status };
}

// ===========================================================================
// Aplicaciones — el creador aplica; el dueño acepta/rechaza; el creador retira
// ===========================================================================

const applySchema = z.object({
  gigId: z.uuid(),
  message: z.string().trim().min(20).max(1000),
  proposedAmount: z.number().positive().max(1_000_000).nullish(),
});

export type ApplyResult =
  | { ok: true; alreadyApplied?: boolean }
  | { ok: false; error: string; needsAuth?: boolean };

export async function applyToGig(rawInput: z.input<typeof applySchema>): Promise<ApplyResult> {
  const parsed = applySchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: COPY.apply.errors.messageShort };
  }
  const { gigId, message, proposedAmount } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: COPY.apply.needLogin };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`gig-apply:${user.id}`, 30, HOUR_MS).ok) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const { error } = await supabase.from("gig_applications").insert({
    tenant_id: tenant.id,
    gig_id: gigId,
    creator_id: user.id,
    message,
    proposed_amount_cents:
      proposedAmount !== null && proposedAmount !== undefined ? dollarsToCents(proposedAmount) : null,
  });

  if (error) {
    // 23505: ya había una aplicación de esta persona a este aviso (unique).
    if (error.code === "23505") {
      return { ok: true, alreadyApplied: true };
    }
    console.warn("[creadores] apply falló", { gigId, code: error.code });
    return { ok: false, error: GENERIC_ERROR };
  }

  return { ok: true };
}

const applicationActionSchema = z.object({
  applicationId: z.uuid(),
  action: z.enum(["accept", "decline", "withdraw"]),
});

const APPLICATION_STATUS: Record<"accept" | "decline" | "withdraw", string> = {
  accept: "accepted",
  decline: "declined",
  withdraw: "withdrawn",
};

export type ApplicationActionResult =
  | { ok: true; status: string }
  | { ok: false; error: string; needsAuth?: boolean };

export async function updateApplication(
  rawInput: z.input<typeof applicationActionSchema>,
): Promise<ApplicationActionResult> {
  const parsed = applicationActionSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: GENERIC_ERROR };
  }
  const { applicationId, action } = parsed.data;
  const nextStatus = APPLICATION_STATUS[action];

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: COPY.apply.needLogin };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase } = guard;

  // La RLS de gig_applications autoriza el rol (creador→withdrawn, dueño→
  // accepted/declined). El `.eq('status','submitted')` evita reprocesar una ya
  // resuelta. Si nadie matchea (no autorizado / ya resuelta), no hay fila.
  const { data: updated, error } = await supabase
    .from("gig_applications")
    .update({ status: nextStatus })
    .eq("id", applicationId)
    .eq("tenant_id", tenant.id)
    .eq("status", "submitted")
    .select("id, status")
    .maybeSingle();

  if (error) {
    console.warn("[creadores] update de aplicación falló", { applicationId, code: error.code });
    return { ok: false, error: COPY.applications.errors.generic };
  }
  if (!updated) {
    return { ok: false, error: COPY.applications.errors.generic };
  }

  return { ok: true, status: updated.status };
}

// ===========================================================================
// Perfil de creador — upsert (solo columnas editables; reputación la protege
// un trigger de la DB, jamás la escribimos acá)
// ===========================================================================

const profileSchema = z.object({
  headline: z.string().trim().min(6).max(120),
  bio: z.string().trim().max(2000).nullish(),
  skills: z.array(z.string().trim().min(1).max(40)).max(12),
  rateHint: z.string().trim().max(120).nullish(),
  available: z.boolean(),
  portfolioPaths: z.array(z.string().min(1).max(300)).max(6),
});

export type CreatorProfileInput = z.input<typeof profileSchema>;

export type SaveProfileResult =
  | { ok: true }
  | { ok: false; error: string; needsAuth?: boolean };

export async function upsertCreatorProfile(
  rawInput: CreatorProfileInput,
): Promise<SaveProfileResult> {
  const parsed = profileSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: COPY.profile.errors.headlineShort };
  }
  const input = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: COPY.profile.needLoginCta };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  // Portfolio en post-media, path canónico {tenant_id}/{user_id}/archivo.
  const pathPattern = new RegExp(
    `^${tenant.id}/${user.id}/[A-Za-z0-9._/-]+\\.(webp|jpe?g|png)$`,
    "i",
  );
  if (!input.portfolioPaths.every((path) => pathPattern.test(path) && !path.includes(".."))) {
    return { ok: false, error: COPY.profile.errors.generic };
  }

  const skills = [
    ...new Set(input.skills.map((skill) => skill.trim()).filter((skill) => skill.length > 0)),
  ].slice(0, 12);

  // upsert: en INSERT los counters usan los DEFAULT (0/null/0) y satisfacen la
  // policy; en UPDATE no se tocan (el trigger de reputación deja pasar). Nunca
  // enviamos completed_jobs/rating_avg/rating_count.
  const { error } = await supabase
    .from("creator_profiles")
    .upsert(
      {
        profile_id: user.id,
        tenant_id: tenant.id,
        headline: input.headline,
        bio: input.bio?.trim() || null,
        skills,
        rate_hint: input.rateHint?.trim() || null,
        available: input.available,
        portfolio_photos: input.portfolioPaths,
      },
      { onConflict: "profile_id" },
    );

  if (error) {
    console.warn("[creadores] upsert de perfil falló", { code: error.code });
    return { ok: false, error: COPY.profile.errors.generic };
  }

  return { ok: true };
}

// ===========================================================================
// Contrato — proponer (cliente/dueño) — INSERT vía ADMIN tras verificar
// ===========================================================================

const proposeSchema = z.object({
  creatorId: z.uuid(),
  /** Si viene, el contrato nace de una aplicación aceptada (deriva gig_id). */
  applicationId: z.uuid().nullish(),
  title: z.string().trim().min(6).max(120),
  scope: z.string().trim().min(10).max(2000),
  deliveryDays: z.number().int().min(1).max(365),
  amountCents: z.number().int().positive().max(100_000_000),
});

export type ProposeContractResult =
  | { ok: true; contractId: string; code: string }
  | { ok: false; error: string; needsAuth?: boolean };

export async function proposeContract(
  rawInput: z.input<typeof proposeSchema>,
): Promise<ProposeContractResult> {
  const parsed = proposeSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: COPY.contract.errors.scopeShort };
  }
  const input = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: COPY.apply.needLogin };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  // El contrato lo crea el CLIENTE; las dos partes deben ser distintas (además
  // lo exige un CHECK de la DB — acá damos copy cálido antes de rebotar).
  if (input.creatorId === user.id) {
    return { ok: false, error: COPY.contract.errors.generic };
  }

  if (!limit(`gig-contract:${user.id}`, 20, HOUR_MS).ok) {
    return { ok: false, error: COPY.contract.errors.generic };
  }

  let gigId: string | null = null;
  let applicationId: string | null = null;

  if (input.applicationId) {
    // Camino A: desde una aplicación ACEPTADA. Verificamos con el cliente del
    // usuario (la RLS solo deja ver la aplicación al dueño del aviso o al creador).
    const { data: application } = await supabase
      .from("gig_applications")
      .select("id, tenant_id, gig_id, creator_id, status")
      .eq("id", input.applicationId)
      .maybeSingle();

    if (
      !application ||
      application.tenant_id !== tenant.id ||
      application.status !== "accepted" ||
      application.creator_id !== input.creatorId
    ) {
      return { ok: false, error: COPY.contract.errors.notAllowed };
    }

    // Y que el aviso sea de este usuario (dueño = cliente del contrato).
    const { data: gig } = await supabase
      .from("listings")
      .select("id, tenant_id, kind, created_by")
      .eq("id", application.gig_id)
      .maybeSingle();

    if (!gig || gig.tenant_id !== tenant.id || gig.kind !== "creator_gig" || gig.created_by !== user.id) {
      return { ok: false, error: COPY.contract.errors.notAllowed };
    }

    gigId = application.gig_id;
    applicationId = application.id;
  } else {
    // Camino B: propuesta directa desde el perfil del creador (sin aviso).
    // Basta con que el creador tenga perfil en este tenant (SELECT público).
    const { data: creatorProfile } = await supabase
      .from("creator_profiles")
      .select("profile_id, tenant_id")
      .eq("profile_id", input.creatorId)
      .maybeSingle();

    if (!creatorProfile || creatorProfile.tenant_id !== tenant.id) {
      return { ok: false, error: COPY.contract.errors.notAllowed };
    }
  }

  // INSERT gateado con ADMIN (gig_contracts INSERT=false para authenticated).
  // status='proposed', payment_mode='demo', fee_pct=20, code y currency por
  // DEFAULT. Jamás tocamos stripe_* ni las columnas generadas (fee/net).
  const admin = createAdminClient();
  const { data: created, error } = await admin
    .from("gig_contracts")
    .insert({
      tenant_id: tenant.id,
      gig_id: gigId,
      application_id: applicationId,
      client_id: user.id,
      creator_id: input.creatorId,
      title: input.title,
      scope: input.scope,
      delivery_days: input.deliveryDays,
      amount_cents: input.amountCents,
    })
    .select("id, code")
    .single();

  if (error || !created) {
    console.error("[creadores] no se pudo crear el contrato", { code: error?.code });
    return { ok: false, error: COPY.contract.errors.generic };
  }

  return { ok: true, contractId: created.id, code: created.code };
}

// ===========================================================================
// Contrato — transiciones de estado (garantía / escrow) vía ADMIN
// ===========================================================================

const transitionSchema = z.object({
  contractId: z.uuid(),
  action: z.enum(["accept", "reject", "fund", "deliver", "release", "cancel", "dispute"]),
});

export type TransitionResult =
  | { ok: true; status: string }
  | { ok: false; error: string; needsAuth?: boolean; stale?: boolean };

export async function transitionContract(
  rawInput: z.input<typeof transitionSchema>,
): Promise<TransitionResult> {
  const parsed = transitionSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: COPY.contract.errors.notAllowed };
  }
  const { contractId, action } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: COPY.apply.needLogin };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  // Leemos el contrato con el cliente del usuario: la RLS solo lo muestra a las
  // partes (+staff). De ahí salen el estado actual y quién es cada quién.
  const { data: contract } = await supabase
    .from("gig_contracts")
    .select("id, tenant_id, client_id, creator_id, status")
    .eq("id", contractId)
    .maybeSingle();

  if (!contract || contract.tenant_id !== tenant.id) {
    return { ok: false, error: COPY.contract.errors.notAllowed };
  }

  // AUTORIZACIÓN: rol de la parte + legalidad de la transición (máquina pura).
  const role = roleOf(user.id, contract);
  const rule = findTransition(role, contract.status as ContractStatus, action as ContractAction);
  if (!rule) {
    return { ok: false, error: COPY.contract.errors.notAllowed };
  }

  // Escritura EXCLUSIVA service_role, gateada por el estado ACTUAL (optimista):
  // si otra parte ya movió el contrato, el `.eq('status', from)` no matchea y no
  // se aplica dos veces. En demo no tocamos stripe_* ni fee/net (generadas).
  const admin = createAdminClient();
  const update: {
    status: string;
    accepted_at?: string;
    rejected_at?: string;
    funded_at?: string;
    delivered_at?: string;
    released_at?: string;
    canceled_at?: string;
  } = { status: rule.to };
  if (rule.stamp) update[rule.stamp] = new Date().toISOString();

  const { data: updated, error } = await admin
    .from("gig_contracts")
    .update(update)
    .eq("id", contractId)
    .eq("tenant_id", tenant.id)
    .eq("status", rule.from)
    .select("id, status")
    .maybeSingle();

  if (error) {
    console.error("[creadores] transición de contrato falló", { contractId, action, code: error.code });
    return { ok: false, error: COPY.contract.errors.generic };
  }
  if (!updated) {
    // Carrera: el estado cambió entre la lectura y la escritura.
    return { ok: false, stale: true, error: COPY.contract.errors.notAllowed };
  }

  return { ok: true, status: updated.status };
}

// ===========================================================================
// Reseñas — mutuas, solo entre las partes de un contrato liberado
// ===========================================================================

const reviewSchema = z.object({
  contractId: z.uuid(),
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().max(1000).nullish(),
});

export type SubmitReviewResult =
  | { ok: true; alreadyLeft?: boolean }
  | { ok: false; error: string; needsAuth?: boolean };

export async function submitReview(
  rawInput: z.input<typeof reviewSchema>,
): Promise<SubmitReviewResult> {
  const parsed = reviewSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: COPY.reviews.errors.ratingRequired };
  }
  const { contractId, rating, body } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: COPY.apply.needLogin };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  // Necesitamos las partes y el estado; la RLS solo muestra el contrato a ellas.
  const { data: contract } = await supabase
    .from("gig_contracts")
    .select("id, tenant_id, client_id, creator_id, status")
    .eq("id", contractId)
    .maybeSingle();

  if (!contract || contract.tenant_id !== tenant.id || contract.status !== "released") {
    return { ok: false, error: COPY.reviews.errors.generic };
  }

  const role = roleOf(user.id, contract);
  if (role === "other") {
    return { ok: false, error: COPY.reviews.errors.generic };
  }
  const rateeId = role === "client" ? contract.creator_id : contract.client_id;

  // INSERT directo con el cliente del usuario: la RLS exige contrato released,
  // reviewer parte y ratee la contraparte exacta. unique(contract, reviewer).
  const { error } = await supabase.from("gig_reviews").insert({
    tenant_id: tenant.id,
    contract_id: contractId,
    reviewer_id: user.id,
    ratee_id: rateeId,
    rating,
    body: body?.trim() || null,
  });

  if (error) {
    if (error.code === "23505") {
      return { ok: true, alreadyLeft: true };
    }
    console.warn("[creadores] insert de reseña falló", { contractId, code: error.code });
    return { ok: false, error: COPY.reviews.errors.generic };
  }

  return { ok: true };
}
