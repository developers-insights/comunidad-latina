"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenant } from "@/lib/tenant/resolve";
import { isVisionConfigured } from "@/lib/config/services";

/**
 * Server actions de /publicar.
 *
 * Flujo (dictado por los contratos de DB/Storage):
 *  1. createListingDraft → INSERT con status 'draft' (la RLS de listings
 *     prohíbe que un aviso de usuario NAZCA published — publicar pasa por
 *     moderación). Devuelve el listingId para poder subir fotos: la RLS de
 *     storage exige path {tenant_id}/{listing_id}/… con listing propio.
 *  2. El cliente sube las fotos al bucket listing-photos con su propia sesión.
 *  3. finalizeListing → setea photos y pasa a 'pending_review'.
 *     Degradación §5.6: imagen sin Vision configurado JAMÁS se publica sola.
 *     Solo en dev, MODERATION_DEV_AUTO_APPROVE==='true' aprueba al toque
 *     (promoción vía cliente admin = acto de moderación server-side).
 *
 * DESVÍO DOCUMENTADO respecto del brief del módulo: "sin fotos → published"
 * no es posible con JWT de usuario — la policy listings_insert/update solo
 * permite draft/pending_review (anti bait-and-switch, gana el contrato de DB).
 * Sin fotos el aviso queda pending_review salvo auto-aprobación dev.
 */

const KINDS = ["property", "business", "professional", "event", "job"] as const;
const PERIODS = ["month", "week", "day", "one_time"] as const;
const PROFESSIONAL_CATEGORIES = [
  "abogado",
  "contador",
  "notario",
  "salud",
  "educacion",
  "otro",
] as const;

const draftSchema = z
  .object({
    kind: z.enum(KINDS),
    title: z.string().trim().min(8).max(120),
    description: z.string().trim().min(30).max(4000),
    priceAmount: z.number().positive().max(1_000_000).nullish(),
    pricePeriod: z.enum(PERIODS).nullish(),
    bedrooms: z.number().int().min(0).max(20).nullish(),
    bathrooms: z.number().int().min(0).max(20).nullish(),
    sqft: z.number().int().min(1).max(100_000).nullish(),
    areaLabel: z.string().trim().min(3).max(80),
    exactAddress: z.string().trim().max(200).nullish(),
    // Campos específicos de professional/event (módulo DIRECTORIOS)
    category: z.enum(PROFESSIONAL_CATEGORIES).nullish(),
    credentials: z.string().trim().max(200).nullish(),
    eventStartsAt: z
      .string()
      .trim()
      .max(40)
      .refine((value) => !Number.isNaN(new Date(value).getTime()), "fecha inválida")
      .nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "property" && (value.priceAmount === null || value.priceAmount === undefined)) {
      ctx.addIssue({ code: "custom", path: ["priceAmount"], message: "precio requerido" });
    }
    if (value.kind === "professional" && !value.category) {
      ctx.addIssue({ code: "custom", path: ["category"], message: "rubro requerido" });
    }
    if (value.kind === "event" && !value.eventStartsAt) {
      ctx.addIssue({ code: "custom", path: ["eventStartsAt"], message: "fecha requerida" });
    }
  });

export type DraftInput = z.input<typeof draftSchema>;

export type CreateDraftResult =
  | { ok: true; listingId: string }
  | { ok: false; error: string; needsAuth?: boolean };

const GENERIC_ERROR =
  "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo en un ratito.";

export async function createListingDraft(rawInput: DraftInput): Promise<CreateDraftResult> {
  const parsed = draftSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: "Revisá los datos del aviso — hay algo incompleto." };
  }
  const input = parsed.data;

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, needsAuth: true, error: "Para publicar necesitás entrar a tu cuenta." };
  }

  const attrs: Record<string, string | number> = {};
  if (input.kind === "property") {
    if (input.bedrooms !== null && input.bedrooms !== undefined) attrs.bedrooms = input.bedrooms;
    if (input.bathrooms !== null && input.bathrooms !== undefined) attrs.bathrooms = input.bathrooms;
    if (input.sqft !== null && input.sqft !== undefined) attrs.sqft = input.sqft;
  }
  if (input.kind === "professional") {
    if (input.category) attrs.category = input.category;
    if (input.credentials) attrs.credentials = input.credentials;
  }
  if (input.kind === "event") {
    if (input.eventStartsAt) {
      // Canónico ISO (mismo formato que el seed: attrs.starts_at)
      attrs.starts_at = new Date(input.eventStartsAt).toISOString();
    }
    attrs.venue_area = input.areaLabel;
  }

  const { data: created, error } = await supabase
    .from("listings")
    .insert({
      tenant_id: tenant.id,
      kind: input.kind,
      title: input.title,
      description: input.description,
      price_amount: input.priceAmount ?? null,
      price_currency: tenant.currency,
      price_period: input.priceAmount ? (input.pricePeriod ?? "month") : null,
      attrs,
      area_label: input.areaLabel,
      status: "draft",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !created) {
    console.warn("[vivienda] insert de borrador falló", { code: error?.code });
    return { ok: false, error: GENERIC_ERROR };
  }

  // Dirección exacta OPCIONAL → tabla privada solo-dueño; jamás se publica.
  if (input.exactAddress) {
    const { error: privateError } = await supabase.from("listing_private_details").insert({
      listing_id: created.id,
      tenant_id: tenant.id,
      exact_address: input.exactAddress,
    });
    if (privateError) {
      // No logueamos la dirección (PII) — solo que falló.
      console.warn("[vivienda] detalle privado no se pudo guardar", {
        listingId: created.id,
        code: privateError.code,
      });
    }
  }

  return { ok: true, listingId: created.id };
}

// ---------------------------------------------------------------------------

const finalizeSchema = z.object({
  listingId: z.uuid(),
  photoPaths: z.array(z.string().min(1).max(300)).max(6),
});

export type FinalizeResult =
  | { ok: true; status: "published" | "pending_review" }
  | { ok: false; error: string; needsAuth?: boolean };

export async function finalizeListing(rawInput: {
  listingId: string;
  photoPaths: string[];
}): Promise<FinalizeResult> {
  const parsed = finalizeSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: GENERIC_ERROR };
  }
  const { listingId, photoPaths } = parsed.data;

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, needsAuth: true, error: "Para publicar necesitás entrar a tu cuenta." };
  }

  // Paths canónicos {tenant_id}/{listing_id}/{archivo} — nada fuera del folder del aviso.
  const pathPattern = new RegExp(
    `^${tenant.id}/${listingId}/[A-Za-z0-9._-]+\\.(webp|jpe?g|png)$`,
    "i",
  );
  if (!photoPaths.every((path) => pathPattern.test(path) && !path.includes(".."))) {
    return { ok: false, error: GENERIC_ERROR };
  }

  // La RLS de UPDATE garantiza que solo el dueño puede tocar la fila.
  const { data: updated, error: updateError } = await supabase
    .from("listings")
    .update({ photos: photoPaths, status: "pending_review" })
    .eq("id", listingId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    .select("id, created_by")
    .maybeSingle();

  if (updateError || !updated) {
    console.warn("[vivienda] finalize falló", { listingId, code: updateError?.code });
    return { ok: false, error: GENERIC_ERROR };
  }

  const hasPhotos = photoPaths.length > 0;
  // Auto-aprobación SOLO fuera de producción: aunque la env var se filtre a
  // un deploy productivo, este branch es estructuralmente imposible ahí
  // (§5.6: imagen sin moderar NUNCA se publica en prod).
  const isProduction =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  const devAutoApprove =
    process.env.MODERATION_DEV_AUTO_APPROVE === "true" && !isProduction;

  if (hasPhotos && !isVisionConfigured && !devAutoApprove) {
    // §5.6: imagen sin moderar NUNCA se publica. Queda en revisión.
    return { ok: true, status: "pending_review" };
  }

  if (!devAutoApprove) {
    // Sin auto-aprobación dev, todo pasa por moderación (contrato de RLS).
    return { ok: true, status: "pending_review" };
  }

  // Auto-aprobación DEV: acto de moderación server-side (uso permitido del
  // cliente admin, ARQUITECTURA §6) tras verificar ownership arriba.
  try {
    const admin = createAdminClient();
    const { error: publishError } = await admin
      .from("listings")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", listingId)
      .eq("tenant_id", tenant.id)
      .eq("created_by", user.id);
    if (publishError) {
      console.warn("[vivienda] auto-aprobación dev falló", {
        listingId,
        code: publishError.code,
      });
      return { ok: true, status: "pending_review" };
    }
  } catch {
    // Admin no configurado — el aviso queda en revisión, nunca rompemos.
    return { ok: true, status: "pending_review" };
  }

  return { ok: true, status: "published" };
}
