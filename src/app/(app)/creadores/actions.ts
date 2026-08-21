"use server";

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DAY_MS, HOUR_MS, limit } from "@/lib/rate-limit";
import { getCreatorCommission } from "@/lib/creators/commission";
import { WORK_MODES, normalizeWorkMode, requiresArea } from "@/lib/creators/work-mode";
import {
  DELIVERY_DAYS_MAX,
  DELIVERY_DAYS_MIN,
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  MAX_INCLUDES,
  MAX_PACKAGES,
  TITLE_MAX,
  TITLE_MIN,
  normalizeIncludes,
  parsePackagePrice,
  reindexOrder,
  type PriceError,
} from "@/lib/creators/service-packages";
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
import { blockContactInfoIn } from "@/lib/moderation/contact-block";
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

const gigDraftSchema = z
  .object({
    title: z.string().trim().min(8).max(120),
    description: z.string().trim().min(30).max(4000),
    category: z.enum(GIG_CATEGORIES).nullish(),
    budget: z.number().positive().max(1_000_000),
    deliverables: z.string().trim().max(500).nullish(),
    // "Urgente" ya no es un campo propio: se DERIVA de deadlineDays ≤ 7 al leer el
    // aviso (ver isUrgentDeadline en creators/helpers.ts). No lo persistimos.
    deadlineDays: z.number().int().min(1).max(365).nullish(),
    // Modalidad (0087). Nullish porque el aviso puede no declararla — la columna
    // es nullable a propósito y NULL significa "no se declaró".
    workMode: z.enum(WORK_MODES).nullish(),
    // Deja de ser obligatoria en el esquema base: para un trabajo a distancia no
    // hay zona que pedir. La exigencia condicional va en el refine de abajo.
    areaLabel: z.string().trim().max(80).nullish(),
  })
  // La MISMA regla que el formulario aplica en el cliente, acá también: el aviso
  // del form es cortesía, el servidor es la frontera. Un POST a mano que mande
  // work_mode='presencial' sin zona rebota igual.
  .refine(
    (value) =>
      !requiresArea(normalizeWorkMode(value.workMode)) ||
      (value.areaLabel?.trim().length ?? 0) >= 3,
    { path: ["areaLabel"] },
  );

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

  // `work_mode` llega con la 0087 y `database.types.ts` se regenera aparte, así
  // que todavía no figura en los tipos: el cast es por el TIPO generado, no por
  // el contrato — la columna existe en la base con su CHECK. Mismo patrón que
  // usa `lib/integrity/scan.ts` con las funciones recién migradas.
  const open = supabase as unknown as SupabaseClient;
  const { data: created, error } = await open
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
      // Trabajo a distancia = sin zona. Se guarda NULL y no el string vacío: la
      // ausencia del dato tiene que poder distinguirse de "escribió nada".
      area_label: input.areaLabel?.trim() || null,
      work_mode: normalizeWorkMode(input.workMode),
      status: "draft",
      created_by: user.id,
    })
    .select("id")
    .returns<{ id: string }[]>()
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

  // Finalize es re-invocable (reintentos legítimos de subida de fotos), pero
  // no gratis: sin cuota propia sería el motor de la re-publicación en loop.
  if (!limit(`gig-finalize:${user.id}`, 20, DAY_MS).ok) {
    return { ok: false, error: COPY.publish.errors.generic };
  }

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
  // `.in(status, draft|pending_review)`: un aviso dado de baja por moderación
  // ('removed') NO se re-publica llamando finalize de nuevo — eso lo decide
  // un humano en la cola, no este flujo.
  const { data: updated, error: updateError } = await supabase
    .from("listings")
    .update({ photos: photoPaths, status: "pending_review" })
    .eq("id", listingId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    .eq("kind", "creator_gig")
    .in("status", ["draft", "pending_review"])
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

/**
 * Copy propio de `applyToGig`. Vive acá y no en `creators/copy.ts` porque ese
 * archivo lo comparten varios flujos y lo está editando otro frente en paralelo
 * — mismo criterio que `PROMOTE_LABEL` en `feed/post-menu.tsx`.
 * TODO(integración): mudarlo a `creators/copy.ts` cuando ese archivo quede libre.
 */
const APPLY_COPY = {
  ownGig: "Este aviso lo publicaste vos. Vas a ver las propuestas que te lleguen.",
  unavailable: "Este trabajo ya no está disponible.",
} as const;

export type ApplyResult =
  /**
   * `alreadyApplied` NO es un alta. Significa que la propuesta que se acaba de
   * escribir NO se guardó porque ya había una de esta persona para este aviso
   * (revisión 2026-08-20). Quien llama TIENE que contarlo distinto: pintarlo
   * como envío exitoso es mentirle a alguien que se tomó el trabajo de escribir.
   */
  | { ok: true; alreadyApplied?: boolean }
  | { ok: false; error: string; needsAuth?: boolean; contactBlocked?: boolean };

export async function applyToGig(rawInput: z.input<typeof applySchema>): Promise<ApplyResult> {
  const parsed = applySchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: COPY.apply.errors.messageShort };
  }
  const { gigId, message, proposedAmount } = parsed.data;

  // BLOQUEO DE DATOS DE CONTACTO (§6). Va DESPUÉS de Zod (que ya acotó la
  // longitud) y ANTES de cualquier escritura: el dato no se guarda ni tachado.
  // El servidor es la frontera — el aviso del formulario es cortesía, no
  // control; quien manda un POST a mano se saltea la UI.
  const contact = blockContactInfoIn([message]);
  if (!contact.ok) {
    return { ok: false, contactBlocked: true, error: contact.message };
  }

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

  /**
   * NADIE SE POSTULA A SU PROPIO AVISO, Y SE DECIDE ACÁ (revisión 2026-08-20).
   *
   * Hasta hoy la única barrera era de PANTALLA: `GigCard` escondía el botón
   * cuando no le pasaban `applicationsCount`, o sea que deducía "sos el dueño"
   * de un campo de presentación. Esa inferencia nunca fue una identidad —en
   * `/creadores` ese conteo no viaja para nadie, así que el dueño veía el botón
   * igual— y esta action, que es una URL pública, jamás comparaba `created_by`
   * contra la sesión. Empleos ya lo cubría (`own-job` en
   * `apply-context-action.ts`); acá faltaba.
   *
   * El `user.id` sale del guard de sesión, nunca del input: es la única
   * identidad que quien llama no puede escribir. La lectura va con el cliente
   * del USUARIO y filtrada por tenant — la RLS sigue siendo la frontera; esto
   * agrega la regla que la RLS no puede expresar sola.
   */
  const { data: gig, error: gigError } = await supabase
    .from("listings")
    .select("id, created_by")
    .eq("id", gigId)
    .eq("tenant_id", tenant.id)
    .eq("kind", "creator_gig")
    .eq("status", "published")
    .maybeSingle();

  if (gigError) {
    console.warn("[creadores] no se pudo leer el aviso para postular", {
      gigId,
      code: gigError.code,
    });
    return { ok: false, error: GENERIC_ERROR };
  }
  if (!gig) {
    return { ok: false, error: APPLY_COPY.unavailable };
  }
  if (gig.created_by === user.id) {
    return { ok: false, error: APPLY_COPY.ownGig };
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
    // No se guardó NADA de lo que se acaba de escribir — el flag viaja para que
    // la hoja lo diga con esas palabras, no para que festeje un alta.
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
// Paquetes de servicio (0102) — el creador cierra precios en su perfil
// ===========================================================================
//
// CONFIANZA: cliente del USUARIO, nunca admin. La RLS de
// `creator_service_packages` ya resuelve quién escribe qué (dueño en su
// comunidad, con perfil de creador existente), así que no hay nada que gatear
// con service_role — a diferencia de gig_contracts, acá nadie mueve plata: se
// publica un precio. Igual, cada escritura viaja con `.eq(creator_id)` y
// `.eq(tenant_id)` explícitos: si mañana alguien afloja una policy, la query
// sigue acotada por su cuenta (defensa en profundidad, patrón del repo).
//
// EL PRECIO LLEGA COMO TEXTO Y SE PARSEA ACÁ. El cliente manda lo que la
// persona tipeó ("150,50"), no un número ya convertido: así el único lugar del
// repo que convierte texto a centavos sigue siendo `parseAmountToCents`
// (src/lib/pricing/money.ts), y un cliente hecho a mano no puede mandar
// `priceCents: -1` ni `19.999`. Zod valida la FORMA; el monto lo valida el
// parser, y el rango final lo vuelve a exigir la base.

const includesSchema = z.array(z.string().max(200)).max(MAX_INCLUDES * 2);

const packageSaveSchema = z.object({
  /** Presente = edición; ausente = alta. */
  id: z.uuid().nullish(),
  title: z.string().trim().min(TITLE_MIN).max(TITLE_MAX),
  description: z.string().trim().min(DESCRIPTION_MIN).max(DESCRIPTION_MAX),
  includes: includesSchema,
  /** Texto tal cual lo tipeó la persona — ver la cabecera. */
  price: z.string().min(1).max(24),
  deliveryDays: z.number().int().min(DELIVERY_DAYS_MIN).max(DELIVERY_DAYS_MAX),
  active: z.boolean(),
});

export type ServicePackageInput = z.input<typeof packageSaveSchema>;

export type SavePackageResult =
  | { ok: true; id: string }
  | { ok: false; error: string; needsAuth?: boolean; contactBlocked?: boolean };

const PRICE_ERROR_COPY: Record<PriceError, string> = {
  vacio: COPY.packages.errors.priceRequired,
  formato: COPY.packages.errors.priceFormat,
  cero: COPY.packages.errors.priceZero,
  demasiado_grande: COPY.packages.errors.priceTooBig,
};

export async function saveServicePackage(
  rawInput: ServicePackageInput,
): Promise<SavePackageResult> {
  const parsed = packageSaveSchema.safeParse(rawInput);
  if (!parsed.success) {
    // El primer campo que falló manda el mensaje: un "revisá el formulario" no
    // le dice a nadie qué revisar.
    const field = parsed.error.issues[0]?.path[0];
    if (field === "title") return { ok: false, error: COPY.packages.errors.titleShort };
    if (field === "description") return { ok: false, error: COPY.packages.errors.descriptionShort };
    if (field === "deliveryDays") return { ok: false, error: COPY.packages.errors.deliveryRequired };
    if (field === "price") return { ok: false, error: COPY.packages.errors.priceRequired };
    return { ok: false, error: COPY.packages.errors.generic };
  }
  const input = parsed.data;

  // El precio, por el único parser de plata del repo.
  const price = parsePackagePrice(input.price);
  if (!price.ok) {
    return { ok: false, error: PRICE_ERROR_COPY[price.reason] };
  }

  const includes = normalizeIncludes(input.includes);

  // BLOQUEO DE DATOS DE CONTACTO (§6). El paquete es texto PÚBLICO que lee
  // quien va a contratar: sirve igual de bien que un mensaje para mudar la
  // conversación afuera ("escribime al…"). La regla ya rige en la propuesta de
  // contrato y en la postulación; sería incoherente dejar abierta justamente la
  // vidriera. Va después de Zod (que ya acotó longitudes) y ANTES de escribir.
  const contact = blockContactInfoIn([input.title, input.description, ...includes]);
  if (!contact.ok) {
    return { ok: false, contactBlocked: true, error: contact.message };
  }

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: COPY.profile.needLoginCta };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`creator-package:${user.id}`, 60, HOUR_MS).ok) {
    return { ok: false, error: COPY.packages.errors.generic };
  }

  // `creator_service_packages` llega con la 0102 y `database.types.ts` se
  // regenera aparte: el cast es por el TIPO generado, no por el contrato — la
  // tabla existe con sus CHECK y sus 4 policies. Mismo patrón que usa
  // `createGigDraft` con `work_mode` (0087).
  const open = supabase as unknown as SupabaseClient;

  const payload = {
    title: input.title,
    description: input.description,
    includes,
    price_cents: price.cents,
    currency: tenant.currency.toLowerCase(),
    delivery_days: input.deliveryDays,
    active: input.active,
  };

  if (input.id) {
    // EDICIÓN. El `.eq(creator_id)` es lo que convierte "el id que mandó el
    // cliente" en "un paquete mío": sin él, la RLS seguiría cubriendo, pero la
    // action estaría confiando en un id ajeno para decidir qué escribir.
    const { data: updated, error } = await open
      .from("creator_service_packages")
      .update(payload)
      .eq("id", input.id)
      .eq("tenant_id", tenant.id)
      .eq("creator_id", user.id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.warn("[creadores] update de paquete falló", { code: error.code });
      return { ok: false, error: COPY.packages.errors.generic };
    }
    if (!updated) return { ok: false, error: COPY.packages.errors.notFound };
    return { ok: true, id: (updated as { id: string }).id };
  }

  // ALTA. El orden del nuevo va al final: se cuenta lo que ya hay y se usa ese
  // número como `sort_order`. El tope de 6 se chequea acá para poder decirlo con
  // palabras, pero el que MANDA es el trigger `creator_service_packages_cap`
  // (dos pestañas guardando a la vez se saltean cualquier count de la app).
  const { count } = await open
    .from("creator_service_packages")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id)
    .eq("creator_id", user.id);

  const existing = count ?? 0;
  if (existing >= MAX_PACKAGES) {
    return { ok: false, error: COPY.packages.errors.limit(MAX_PACKAGES) };
  }

  const { data: created, error } = await open
    .from("creator_service_packages")
    .insert({
      ...payload,
      tenant_id: tenant.id,
      creator_id: user.id,
      sort_order: Math.min(existing, MAX_PACKAGES - 1),
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // 23514 = el CHECK/trigger de la base. El único que puede saltar acá con
    // datos ya validados es el tope de 6 (carrera entre dos pestañas), así que
    // se traduce a su mensaje en vez de al genérico.
    if (error.code === "23514") {
      return { ok: false, error: COPY.packages.errors.limit(MAX_PACKAGES) };
    }
    // 42501 = la RLS rechazó el INSERT. Con tenant y dueño correctos, lo que
    // falta es el perfil de creador que exige el `exists` de la policy.
    if (error.code === "42501") {
      return { ok: false, error: COPY.packages.errors.needProfile };
    }
    console.warn("[creadores] insert de paquete falló", { code: error.code });
    return { ok: false, error: COPY.packages.errors.generic };
  }
  if (!created) return { ok: false, error: COPY.packages.errors.generic };

  return { ok: true, id: (created as { id: string }).id };
}

const packageIdSchema = z.object({ id: z.uuid() });

export type PackageMutationResult =
  | { ok: true }
  | { ok: false; error: string; needsAuth?: boolean };

/**
 * Prender/apagar un paquete. Existe aparte de `saveServicePackage` porque
 * apagar no debería obligar a reenviar (ni revalidar) todo el texto: es un
 * gesto de un toque y tiene que responder como tal.
 */
export async function setServicePackageActive(
  rawInput: { id: string; active: boolean },
): Promise<PackageMutationResult> {
  const parsed = packageIdSchema.extend({ active: z.boolean() }).safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: COPY.packages.errors.generic };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: COPY.profile.needLoginCta };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`creator-package:${user.id}`, 60, HOUR_MS).ok) {
    return { ok: false, error: COPY.packages.errors.generic };
  }

  const open = supabase as unknown as SupabaseClient;
  const { data: updated, error } = await open
    .from("creator_service_packages")
    .update({ active: parsed.data.active })
    .eq("id", parsed.data.id)
    .eq("tenant_id", tenant.id)
    .eq("creator_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.warn("[creadores] toggle de paquete falló", { code: error.code });
    return { ok: false, error: COPY.packages.errors.generic };
  }
  if (!updated) return { ok: false, error: COPY.packages.errors.notFound };
  return { ok: true };
}

export async function deleteServicePackage(
  rawInput: { id: string },
): Promise<PackageMutationResult> {
  const parsed = packageIdSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: COPY.packages.errors.generic };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: COPY.profile.needLoginCta };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`creator-package:${user.id}`, 60, HOUR_MS).ok) {
    return { ok: false, error: COPY.packages.errors.generic };
  }

  const open = supabase as unknown as SupabaseClient;
  const { data: deleted, error } = await open
    .from("creator_service_packages")
    .delete()
    .eq("id", parsed.data.id)
    .eq("tenant_id", tenant.id)
    .eq("creator_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.warn("[creadores] delete de paquete falló", { code: error.code });
    return { ok: false, error: COPY.packages.errors.generic };
  }
  if (!deleted) return { ok: false, error: COPY.packages.errors.notFound };
  return { ok: true };
}

const reorderSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(MAX_PACKAGES),
});

/**
 * Reordenar. Renumera 0,1,2… (ver `reindexOrder`) y escribe una fila por vez.
 *
 * NO se hace con un `upsert` de varias filas a propósito: un upsert manda las
 * filas completas, así que un cliente hecho a mano podría colar un precio nuevo
 * dentro de lo que dice ser "un reordenamiento". Acá cada UPDATE toca UNA
 * columna —`sort_order`— y va acotado por dueño y comunidad. Son seis filas
 * como mucho: el ahorro de un round-trip no paga abrir esa puerta.
 */
export async function reorderServicePackages(
  rawInput: { ids: string[] },
): Promise<PackageMutationResult> {
  const parsed = reorderSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: COPY.packages.errors.generic };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: COPY.profile.needLoginCta };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`creator-package:${user.id}`, 60, HOUR_MS).ok) {
    return { ok: false, error: COPY.packages.errors.generic };
  }

  const open = supabase as unknown as SupabaseClient;
  for (const { id, sortOrder } of reindexOrder(parsed.data.ids)) {
    const { error } = await open
      .from("creator_service_packages")
      .update({ sort_order: sortOrder })
      .eq("id", id)
      .eq("tenant_id", tenant.id)
      .eq("creator_id", user.id);
    if (error) {
      console.warn("[creadores] reorden de paquetes falló", { code: error.code });
      return { ok: false, error: COPY.packages.errors.generic };
    }
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
  | { ok: false; error: string; needsAuth?: boolean; contactBlocked?: boolean };

export async function proposeContract(
  rawInput: z.input<typeof proposeSchema>,
): Promise<ProposeContractResult> {
  const parsed = proposeSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: COPY.contract.errors.scopeShort };
  }
  const input = parsed.data;

  // BLOQUEO DE DATOS DE CONTACTO (§6), también del lado del negocio: el título
  // y el alcance del contrato son texto libre que lee la otra parte, así que
  // sirven igual de bien para mudar la conversación afuera. La regla es
  // simétrica — si sólo se controlara al creador, el "coordinamos por WhatsApp"
  // entraría por el campo del cliente.
  const contact = blockContactInfoIn([input.title, input.scope]);
  if (!contact.ok) {
    return { ok: false, contactBlocked: true, error: contact.message };
  }

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

  // La comisión de ESTA comunidad (0087), leída con el cliente DEL USUARIO: la
  // función de la base deriva el tenant de `app.current_tenant_id()` (el JWT), y
  // el cliente admin no lleva JWT — con él siempre daría el default. Nunca falla:
  // sin configuración devuelve 20, que es lo que la app cobraba hardcodeado.
  //
  // Se copia al contrato y ahí queda CONGELADA: si mañana la comunidad cambia la
  // comisión, este contrato se sigue liberando con la que las dos partes vieron
  // (lo enforcea el trigger gig_contracts_fee_pct_congelado).
  const feePct = await getCreatorCommission(supabase);

  // INSERT gateado con ADMIN (gig_contracts INSERT=false para authenticated).
  // status='proposed', payment_mode='demo', code y currency por DEFAULT. Jamás
  // tocamos stripe_* ni las columnas generadas (fee/net), que las calcula la
  // base a partir de amount_cents y fee_pct.
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
      fee_pct: feePct,
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
