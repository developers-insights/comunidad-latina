"use server";

import { revalidatePath } from "next/cache";
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
  COMUNIDAD_COPY,
  LOST_FOUND_AREA_MAX,
  LOST_FOUND_AREA_MIN,
  LOST_FOUND_CATEGORIES,
  LOST_FOUND_DESCRIPTION_MAX,
  LOST_FOUND_DESCRIPTION_MIN,
  LOST_FOUND_KIND,
  LOST_FOUND_MAX_PHOTOS,
  LOST_FOUND_TITLE_MAX,
  LOST_FOUND_TITLE_MIN,
  LOST_FOUND_TYPES,
  buildLostFoundAttrs,
  isAcceptableHappenedOn,
  supabaseSinTiparComunidad,
} from "@/lib/comunidad";

/**
 * =============================================================================
 * SERVER ACTIONS DE PERDIDO Y ENCONTRADO (Comunidad, migración 0096)
 * =============================================================================
 *
 * Un caso es un `listings` con `kind = 'lost_found'`, así que el flujo es el
 * MISMO de dos fases que Empleos, Marketplace y Creadores — y no por gusto: lo
 * dictan los contratos de la base y del storage.
 *
 *   1. `createLostFoundCaseDraft` → INSERT en `draft`. La RLS de listings (0004)
 *      prohíbe que un aviso de usuario NAZCA published. Devuelve el id, que hace
 *      falta para subir fotos: la policy del bucket exige el path
 *      {tenant_id}/{listing_id}/…
 *   2. El cliente sube hasta 4 fotos (opcionales) a `listing-photos`.
 *   3. `finalizeLostFoundCase` → escribe las fotos, modera el texto y decide el
 *      status. Publicar (el salto a `published`) es exclusivo del admin client:
 *      la RLS no se lo permite ni al dueño.
 *
 * LO PROPIO DE ESTE MÓDULO:
 *  · `kind` se fija ACÁ, nunca llega del cliente.
 *  · SIN PRECIO. `price_amount` queda null y no hay campo que lo escriba: acá no
 *    se compra ni se vende nada, y una recompensa publicada es el anzuelo
 *    clásico de la estafa del "yo lo encontré, mandame el envío".
 *  · `toggleLostFoundResolved` no hace un UPDATE: llama a la función
 *    `public.marcar_caso_resuelto` (0096). El motivo largo está en la migración
 *    — en corto, la RLS le prohíbe al dueño conservar `published` al editar, y
 *    un caso resuelto tiene que seguir visible para que nadie siga buscando.
 *
 * TENANT: siempre del guard (JWT + host), jamás de un campo del formulario.
 */

const C = COMUNIDAD_COPY.publicar;

// ===========================================================================
// 1. Borrador
// ===========================================================================

const draftSchema = z.object({
  type: z.enum(LOST_FOUND_TYPES),
  category: z.enum(LOST_FOUND_CATEGORIES),
  title: z.string().trim().min(LOST_FOUND_TITLE_MIN).max(LOST_FOUND_TITLE_MAX),
  description: z
    .string()
    .trim()
    .min(LOST_FOUND_DESCRIPTION_MIN)
    .max(LOST_FOUND_DESCRIPTION_MAX),
  areaLabel: z.string().trim().min(LOST_FOUND_AREA_MIN).max(LOST_FOUND_AREA_MAX),
  /**
   * Fecha aproximada. Opcional: mucha gente no se acuerda del día, y forzarla
   * sólo produciría fechas inventadas. Cuando viene, tiene que ser una fecha
   * real, ni futura ni de hace más de dos años (`isAcceptableHappenedOn`).
   */
  happenedOn: z
    .string()
    .trim()
    .refine((value) => isAcceptableHappenedOn(value), { message: "fecha fuera de rango" })
    .nullable()
    .optional(),
});

export type LostFoundDraftInput = z.input<typeof draftSchema>;

export type CreateLostFoundDraftResult =
  | { ok: true; caseId: string }
  | { ok: false; error: string; needsAuth?: boolean };

export async function createLostFoundCaseDraft(
  rawInput: LostFoundDraftInput,
): Promise<CreateLostFoundDraftResult> {
  // Zod PURO primero (sin I/O): un payload roto no consume guard ni cuota.
  const parsed = draftSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: C.errors.generic };
  }
  const input = parsed.data;

  // Guard ANTES de cualquier efecto colateral (regla del repo, lib/tenant/guard):
  // si el tenant del JWT no coincide con el del request, la RLS va a rechazar el
  // insert igual — no se quema cuota ni se toca storage por una escritura muerta.
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: C.needLogin };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`comunidad-perdidos:${user.id}`, 10, DAY_MS).ok) {
    return { ok: false, error: C.errors.generic };
  }

  const { data: created, error } = await supabase
    .from("listings")
    .insert({
      tenant_id: tenant.id,
      kind: LOST_FOUND_KIND,
      title: input.title,
      description: input.description,
      area_label: input.areaLabel,
      attrs: buildLostFoundAttrs({
        type: input.type,
        category: input.category,
        happenedOn: input.happenedOn ?? null,
      }),
      status: "draft",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !created) {
    console.warn("[comunidad] insert de borrador falló", { code: error?.code });
    return { ok: false, error: C.errors.generic };
  }

  return { ok: true, caseId: created.id };
}

// ===========================================================================
// 2. Cierre (fotos + moderación + status)
// ===========================================================================

const finalizeSchema = z.object({
  caseId: z.uuid(),
  photoPaths: z.array(z.string().min(1).max(300)).max(LOST_FOUND_MAX_PHOTOS),
});

export type FinalizeLostFoundResult =
  | { ok: true; status: "published" | "pending_review" }
  | { ok: false; error: string; needsAuth?: boolean };

export async function finalizeLostFoundCase(rawInput: {
  caseId: string;
  photoPaths: string[];
}): Promise<FinalizeLostFoundResult> {
  const parsed = finalizeSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: C.errors.generic };
  }
  const { caseId, photoPaths } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: C.needLogin };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  // Finalize es re-invocable (reintentos legítimos de subida), pero no gratis:
  // sin cuota propia sería el motor de la re-publicación en loop.
  if (!limit(`comunidad-perdidos-finalize:${user.id}`, 20, DAY_MS).ok) {
    return { ok: false, error: C.errors.generic };
  }

  // Paths canónicos {tenant_id}/{listing_id}/archivo — bucket listing-photos.
  const pathPattern = new RegExp(
    `^${tenant.id}/${caseId}/[A-Za-z0-9._-]+\\.(webp|jpe?g|png)$`,
    "i",
  );
  if (!photoPaths.every((path) => pathPattern.test(path) && !path.includes(".."))) {
    return { ok: false, error: C.errors.generic };
  }

  // UPDATE con el cliente del USUARIO: el mismo round-trip RE-CONFIRMA la
  // propiedad (.eq de tenant/creador/kind) y trae el texto para moderar.
  // `.in(status, draft|pending_review)`: un caso bajado por moderación
  // ('removed') no se re-publica llamando finalize otra vez.
  const { data: updated, error: updateError } = await supabase
    .from("listings")
    .update({ photos: photoPaths, status: "pending_review" })
    .eq("id", caseId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    .eq("kind", LOST_FOUND_KIND)
    .in("status", ["draft", "pending_review"])
    .select("id, title, description")
    .maybeSingle();

  if (updateError || !updated) {
    console.warn("[comunidad] finalize del caso falló", { caseId, code: updateError?.code });
    return { ok: false, error: C.errors.generic };
  }

  // ---- Moderación de texto ANTES de decidir el status (§8). Acá el texto es
  // lo único que puede traer un teléfono, un "mandame $50 por Zelle y te lo
  // devuelvo" o datos personales de un tercero.
  const moderation = await moderateText(`${updated.title}\n${updated.description ?? ""}`);
  const tier = moderation.flagged ? TIER_HUMAN : moderationTier(moderation.score);

  // ---- Foto: publicación instantánea + revisión asíncrona, misma política que
  // el feed, Empleos y Creadores. Sin Vision la foto NO retiene el caso —si lo
  // hiciera, un caso con foto se "publicaría" y no aparecería nunca— pero entra
  // igual a la cola humana. El TEXTO sigue siendo lo único que gobierna
  // pending_review.
  const autoApprove = devAutoApprove();
  const photoNeedsAsyncReview = photoPaths.length > 0 && !isVisionConfigured && !autoApprove;

  let status: "published" | "pending_review" =
    moderation.flagged || tier === TIER_HUMAN ? "pending_review" : "published";

  if (status === "published") {
    try {
      const admin = createAdminClient();
      const { error: publishError } = await admin
        .from("listings")
        .update({ status: "published", published_at: new Date().toISOString() })
        .eq("id", caseId)
        .eq("tenant_id", tenant.id)
        .eq("created_by", user.id);
      if (publishError) {
        console.warn("[comunidad] no se pudo publicar el caso, queda en revisión", {
          caseId,
          code: publishError.code,
        });
        status = "pending_review";
      }
    } catch {
      // Admin client no configurado → el caso queda en revisión. Nunca se rompe
      // el flujo por esto: la persona ya escribió todo.
      status = "pending_review";
    }
  }

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
        // 'listing' y no un subject_kind nuevo: un caso ES un listing, así que
        // se resuelve desde /admin/moderacion con las herramientas que ya hay.
        subjectKind: "listing",
        subjectId: caseId,
        aiScore: moderation.skipped ? null : moderation.score,
        reasons,
        tier: enqueueTier,
      });
      if (!outcome.ok) {
        console.warn("[comunidad] no se pudo encolar moderación del caso", { caseId });
      }
    } catch {
      console.warn("[comunidad] admin client no disponible para encolar moderación");
    }
  }

  if (status === "published") {
    revalidatePath("/comunidad/perdidos");
  }
  return { ok: true, status };
}

// ===========================================================================
// 3. "Ya apareció"
// ===========================================================================

const resolveSchema = z.object({
  caseId: z.uuid(),
  resolved: z.boolean(),
});

export type ToggleResolvedResult =
  | { ok: true; resolved: boolean }
  | { ok: false; error: string; needsAuth?: boolean };

/**
 * Marca (o desmarca) un caso propio como resuelto.
 *
 * No hay UPDATE acá: la autorización entera vive en
 * `public.marcar_caso_resuelto` (0096), que verifica dueño + tenant + kind
 * adentro de la base. Si alguien puentea la app y llama a la función desde
 * PostgREST con su propio token, se topa exactamente con las mismas reglas.
 */
export async function toggleLostFoundResolved(rawInput: {
  caseId: string;
  resolved: boolean;
}): Promise<ToggleResolvedResult> {
  const parsed = resolveSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: COMUNIDAD_COPY.perdidos.resolve.failed };
  }
  const { caseId, resolved } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: C.needLogin };
    }
    return { ok: false, error: guard.message };
  }
  const { supabase, user } = guard;

  if (!limit(`comunidad-perdidos-resolver:${user.id}`, 60, DAY_MS).ok) {
    return { ok: false, error: COMUNIDAD_COPY.perdidos.resolve.failed };
  }

  const { data, error } = await supabaseSinTiparComunidad(supabase).rpc(
    "marcar_caso_resuelto",
    { p_listing: caseId, p_resuelto: resolved },
  );

  // `false` sin error = la función no encontró una fila propia (otro dueño,
  // otro tenant, otro kind). Se responde igual que ante un error: no se le
  // confirma a nadie la existencia de un caso ajeno.
  if (error || data !== true) {
    console.warn("[comunidad] no se pudo marcar el caso", { caseId, code: error?.code });
    return { ok: false, error: COMUNIDAD_COPY.perdidos.resolve.failed };
  }

  revalidatePath("/comunidad/perdidos");
  revalidatePath(`/comunidad/perdidos/${caseId}`);
  return { ok: true, resolved };
}

// ===========================================================================
// Helper local (no exportado: este módulo es "use server")
// ===========================================================================

/**
 * Auto-aprobación SOLO fuera de producción — helper idéntico al del feed, de
 * Empleos y de Creadores. Duplicado a propósito: cada módulo es dueño de su
 * política de publicación, y no se exporta porque un módulo "use server" sólo
 * puede exportar funciones async (ver src/test/use-server-exports.test.ts).
 */
function devAutoApprove(): boolean {
  const isProduction =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  return process.env.MODERATION_DEV_AUTO_APPROVE === "true" && !isProduction;
}
