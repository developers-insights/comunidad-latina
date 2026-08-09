"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { safeExternalHref } from "@/lib/url/safe-href";
import { COPY } from "./copy";
import {
  CTA_COLUMN,
  CTA_VALUE_KIND,
  EXTERNAL_CTA_KINDS,
  canUseActionButtons,
  externalCtasFor,
  parseCtaKind,
  parseListingTier,
  type ExternalCtaKind,
} from "./tier";

/**
 * Server actions de MONETIZACIÓN.
 *
 * Las tres cosas que este archivo protege, y por qué cada una necesita al
 * servidor y no alcanza con el formulario:
 *
 *  1. GUARDAR BOTONES DE ACCIÓN. El tier se lee de la BASE, nunca del cliente:
 *     si viniera en el payload, cualquiera pondría `tier: "premium"` en un
 *     fetch y se llevaría los botones gratis. La base tiene el CHECK que lo
 *     impide igual (`listings_cta_premium_only`), pero un 500 de constraint no
 *     tiene copy — acá el rechazo sale como una frase amable.
 *  2. REGISTRAR UN CLIC. `record_cta_click` es el ÚNICO camino de escritura de
 *     `cta_clicks` (las policies directas están en `false`), así que la RPC va
 *     sí o sí por el servidor.
 *  3. CREAR / MANDAR A REVISIÓN UNA CAMPAÑA. La RLS deja al dueño insertar
 *     `draft` y mover `draft→pending_review`; activar, fechar y cobrar es de
 *     `service_role`. Esta action se queda EXACTAMENTE dentro de lo que el
 *     dueño puede, y no intenta nada que el trigger `campaigns_freeze` vaya a
 *     rebotar.
 *
 * `requireTenantMatch()` va PRIMERO en todas, antes de consumir rate limit o
 * tocar la DB (regla de la casa: nada de efectos huérfanos).
 */

const UUID = z.uuid();

// ---------------------------------------------------------------------------
// 1 · Botones de acción
// ---------------------------------------------------------------------------

/**
 * Formato de teléfono LAXO, calcado del CHECK de la 0048
 * (`^[+0-9 ().-]{5,25}$`). Es laxo a propósito y la migración explica por qué:
 * la comunidad escribe números de varios países y un E.164 estricto rechazaría
 * entradas válidas. Si el regex de acá fuera más duro que el de la base,
 * estaríamos inventando una regla que nadie escribió.
 */
const PHONE_RE = /^[+0-9 ().-]{5,25}$/;

const ctaValueSchema = z.string().trim().max(500);

const saveCtasSchema = z.object({
  listingId: UUID,
  /** Botón → valor. Vacío o ausente = ese botón no se muestra. */
  ctas: z.record(z.string(), ctaValueSchema.nullable()).default({}),
});

export type SaveCtasInput = z.input<typeof saveCtasSchema>;

export type SaveCtasResult =
  | { ok: true; saved: ExternalCtaKind[] }
  | { ok: false; error: string; needsAuth?: boolean; field?: ExternalCtaKind };

/**
 * Normaliza y valida UN botón. Devuelve `null` para "no guardes nada acá"
 * (que es distinto de un error) o un mensaje si el valor está mal.
 *
 * Los links pasan SIEMPRE por `safeExternalHref`, que clasifica por ORIGEN
 * RESUELTO y no por prefijo de string. No es paranoia decorativa: `zod.url()`
 * acepta `javascript:` (verificado en la 4.4.3), y un botón "Sitio web" con un
 * `javascript:` adentro, firmado con el nombre de un comercio de la comunidad,
 * es exactamente el ataque que ese módulo existe para frenar.
 */
function normalizeCtaValue(
  kind: ExternalCtaKind,
  raw: string | null | undefined,
): { value: string | null } | { error: string } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { value: null };

  switch (CTA_VALUE_KIND[kind]) {
    case "phone":
      return PHONE_RE.test(trimmed)
        ? { value: trimmed }
        : { error: COPY.errors.invalidPhone };

    case "url": {
      const safe = safeExternalHref(trimmed);
      // Sólo destinos EXTERNOS http(s): un botón "Sitio web" que apunta a una
      // ruta interna no es un sitio web, y la base exige `^https?://`.
      if (!safe || !safe.external) return { error: COPY.errors.invalidUrl };
      if (safe.href.length > 500) return { error: COPY.errors.invalidUrl };
      return { value: safe.href };
    }

    case "text":
      // Espeja el CHECK de `cta_address` (entre 5 y 300 caracteres).
      return trimmed.length >= 5 && trimmed.length <= 300
        ? { value: trimmed }
        : { error: COPY.errors.invalidAddress };
  }
}

/**
 * Guarda los botones de acción de un aviso PROPIO.
 *
 * Escribe SIEMPRE las 7 columnas (las no enviadas van a NULL) para que el
 * formulario sea idempotente: borrar un botón es dejar el campo vacío, no
 * llamar a otra action.
 */
export async function saveListingCtasAction(
  rawInput: SaveCtasInput,
): Promise<SaveCtasResult> {
  const parsed = saveCtasSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: COPY.errors.generic };
  const { listingId, ctas } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: COPY.errors.needsAuth };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`cta-save:${user.id}`, 30, HOUR_MS).ok) {
    return { ok: false, error: COPY.errors.tooManyTries };
  }

  // El TIER SALE DE LA BASE. Este select es el gate entero de la feature.
  const { data: listing } = await supabase
    .from("listings")
    .select("id, tenant_id, kind, tier, status, created_by")
    .eq("id", listingId)
    .maybeSingle();

  if (!listing || listing.tenant_id !== tenant.id || listing.created_by !== user.id) {
    return { ok: false, error: COPY.errors.notYours };
  }

  const tier = parseListingTier(listing.tier);
  if (!canUseActionButtons(tier)) {
    // La base rechazaría el UPDATE igual (listings_cta_premium_only); acá el
    // rechazo llega con copy en vez de con un código de Postgres.
    return { ok: false, error: COPY.errors.premiumOnly };
  }

  // Sólo los botones que ESTE módulo ofrece. Un evento no guarda "Comprar"
  // aunque alguien lo mande en el payload — la lista de la spec manda.
  const allowed = new Set<ExternalCtaKind>(externalCtasFor(listing.kind));

  const patch: Record<string, string | null> = {};
  const saved: ExternalCtaKind[] = [];

  for (const kind of EXTERNAL_CTA_KINDS) {
    const column = CTA_COLUMN[kind];
    if (!allowed.has(kind)) {
      patch[column] = null;
      continue;
    }
    const result = normalizeCtaValue(kind, ctas[kind] ?? null);
    if ("error" in result) return { ok: false, error: result.error, field: kind };
    patch[column] = result.value;
    if (result.value) saved.push(kind);
  }

  // Va por RPC y no por UPDATE directo: `listings_update` (0004) excluye
  // status='published' a propósito —para que un aviso no se reescriba después
  // de pasar moderación— y eso rebotaba TAMBIÉN este parche, que sólo toca las
  // 7 columnas cta_* y ni mira el status. El comercio premium cargaba su
  // teléfono, tocaba Guardar y recibía un error genérico, siempre.
  // `save_listing_ctas` (0053) revalida tenant + dueño + source adentro, y el
  // CHECK listings_cta_premium_only sigue rigiendo: en tier free rebota igual.
  // `?? undefined` y no `?? null`: los 7 parámetros de save_listing_ctas tienen
  // DEFAULT NULL en SQL, así que los tipos generados los declaran opcionales
  // (`string | undefined`). Omitir el argumento y pasarlo en null terminan en
  // exactamente el mismo NULL del lado de Postgres, así que el borrado de un
  // CTA no permitido —que es lo que hace `patch[column] = null` más arriba—
  // sigue funcionando igual.
  const { error } = await supabase.rpc("save_listing_ctas", {
    p_listing_id: listing.id,
    p_phone: patch.cta_phone ?? undefined,
    p_whatsapp: patch.cta_whatsapp ?? undefined,
    p_website: patch.cta_website ?? undefined,
    p_purchase_url: patch.cta_purchase_url ?? undefined,
    p_tickets_url: patch.cta_tickets_url ?? undefined,
    p_booking_url: patch.cta_booking_url ?? undefined,
    p_address: patch.cta_address ?? undefined,
  });

  if (error) {
    console.warn("[monetizacion] no se pudieron guardar los CTAs", {
      listingId: listing.id,
      code: error.code,
    });
    return { ok: false, error: COPY.errors.generic };
  }

  revalidatePath(`/propiedades/${listing.id}`);
  return { ok: true, saved };
}

// ---------------------------------------------------------------------------
// 2 · Clic en un botón
// ---------------------------------------------------------------------------

const clickSchema = z.object({
  listingId: UUID,
  kind: z.string(),
});

/**
 * Suma 1 al contador diario de un botón.
 *
 * Devuelve `void` y NUNCA lanza: el clic es un efecto secundario del contacto
 * real, no el contacto. Si la métrica falla, la persona igual tiene que poder
 * llamar — un `tel:` que no abre porque el analytics se cayó sería el peor
 * intercambio posible.
 */
export async function recordCtaClickAction(rawInput: unknown): Promise<void> {
  const parsed = clickSchema.safeParse(rawInput);
  if (!parsed.success) return;
  const kind = parseCtaKind(parsed.data.kind);
  if (!kind) return;

  try {
    const guard = await requireTenantMatch();
    // Sin sesión no hay métrica: la RPC exige auth.uid() y devolvería
    // AUTH_REQUIRED. Se sale en silencio, no se molesta a nadie con un toast.
    if (!guard.ok) return;

    const { error } = await guard.supabase.rpc("record_cta_click", {
      p_listing_id: parsed.data.listingId,
      p_cta_kind: kind,
    });
    if (error) {
      console.warn("[monetizacion] record_cta_click falló", { code: error.code });
    }
  } catch {
    // Silencio deliberado: ver el comentario de arriba.
  }
}

// ---------------------------------------------------------------------------
// 3 · Campañas
// ---------------------------------------------------------------------------

const OBJECTIVES = ["reach", "traffic", "messages", "leads", "sales"] as const;

/**
 * Lista de etiquetas separadas por coma → array acotado.
 *
 * Los topes espejan `app.short_text_array_ok(...)` de la 0048. Se recorta acá
 * en vez de dejar que el CHECK reviente: 31 intereses no son un ataque, son
 * alguien entusiasmado, y merecen un guardado que funcione.
 */
function parseTagList(raw: unknown, maxItems: number, maxLen: number): string[] {
  if (typeof raw !== "string") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(",")) {
    const value = piece.trim().slice(0, maxLen);
    if (!value) continue;
    const key = value.toLocaleLowerCase("es");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= maxItems) break;
  }
  return out;
}

const campaignSchema = z.object({
  listingId: UUID,
  objective: z.enum(OBJECTIVES),
  /** Dólares enteros, tal como se escriben en el formulario. */
  budgetUsd: z.number().int().min(1).max(100_000),
  durationDays: z.number().int().min(1).max(90),
  countries: z.string().max(2_000).optional(),
  cities: z.string().max(4_000).optional(),
  languages: z.string().max(500).optional(),
  interests: z.string().max(3_000).optional(),
  ageMin: z.number().int().min(13).max(99).nullable().optional(),
  ageMax: z.number().int().min(13).max(99).nullable().optional(),
  /** `true` = mandar a revisión en el mismo paso; `false` = queda borrador. */
  submitForReview: z.boolean().default(false),
});

export type CampaignInput = z.input<typeof campaignSchema>;

export type CampaignResult =
  | { ok: true; campaignId: string; status: "draft" | "pending_review" }
  | { ok: false; error: string; needsAuth?: boolean };

/**
 * Crea (o reemplaza) el BORRADOR de campaña de un aviso propio y publicado.
 *
 * Lo que esta action deliberadamente NO hace: activar, fechar, cobrar ni tocar
 * `review_note`. Todo eso es `service_role` por diseño de la 0048 — intentarlo
 * desde acá no fallaría "a veces", fallaría siempre, y con un mensaje de
 * trigger que no es para el usuario.
 */
export async function saveCampaignAction(rawInput: CampaignInput): Promise<CampaignResult> {
  const parsed = campaignSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: COPY.errors.generic };
  const input = parsed.data;

  if (
    input.ageMin != null &&
    input.ageMax != null &&
    input.ageMin > input.ageMax
  ) {
    return { ok: false, error: COPY.campaign.ageError };
  }

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: COPY.errors.needsAuth };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`campaign:${user.id}`, 20, HOUR_MS).ok) {
    return { ok: false, error: COPY.errors.tooManyTries };
  }

  const { data: listing } = await supabase
    .from("listings")
    .select("id, tenant_id, status, created_by")
    .eq("id", input.listingId)
    .maybeSingle();

  if (!listing || listing.tenant_id !== tenant.id || listing.created_by !== user.id) {
    return { ok: false, error: COPY.errors.notYours };
  }
  if (listing.status !== "published") {
    return { ok: false, error: COPY.errors.notPublished };
  }

  const payload = {
    objective: input.objective,
    budget_cents: input.budgetUsd * 100,
    currency: "usd",
    duration_days: input.durationDays,
    countries: parseTagList(input.countries, 20, 60),
    cities: parseTagList(input.cities, 50, 120),
    languages: parseTagList(input.languages, 10, 20),
    interests: parseTagList(input.interests, 30, 60),
    age_min: input.ageMin ?? null,
    age_max: input.ageMax ?? null,
  };

  // ¿Ya hay un borrador para este aviso? Se edita, no se acumulan borradores
  // gemelos: la pantalla muestra UNA campaña, así que crear una segunda dejaría
  // una fila invisible que igual cuenta como configuración guardada.
  const { data: existing } = await supabase
    .from("campaigns")
    .select("id, status")
    .eq("listing_id", listing.id)
    .eq("created_by", user.id)
    .in("status", ["draft", "rejected"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let campaignId = existing?.id ?? null;

  if (campaignId) {
    // Un `rejected` vuelve primero a `draft` (transición que el dueño SÍ puede)
    // y recién ahí acepta cambios de presupuesto: `campaigns_freeze` congela la
    // plata en cuanto la campaña deja de ser borrador.
    const { error } = await supabase
      .from("campaigns")
      .update({ ...payload, status: "draft" })
      .eq("id", campaignId);
    if (error) {
      console.warn("[monetizacion] update de campaña falló", { code: error.code });
      return { ok: false, error: COPY.errors.generic };
    }
  } else {
    const { data: created, error } = await supabase
      .from("campaigns")
      .insert({
        tenant_id: tenant.id,
        created_by: user.id,
        listing_id: listing.id,
        status: "draft",
        ...payload,
      })
      .select("id")
      .single();
    if (error || !created) {
      console.warn("[monetizacion] insert de campaña falló", { code: error?.code });
      return { ok: false, error: COPY.errors.generic };
    }
    campaignId = created.id;
  }

  if (!input.submitForReview) {
    revalidatePath(`/impulsar/${listing.id}`);
    return { ok: true, campaignId, status: "draft" };
  }

  // draft → pending_review: la única transición "hacia adelante" que la 0048 le
  // permite al dueño. A partir de acá presupuesto, moneda y duración quedan
  // congelados, y el copy del formulario ya lo avisó.
  const { error: reviewError } = await supabase
    .from("campaigns")
    .update({ status: "pending_review" })
    .eq("id", campaignId);

  if (reviewError) {
    console.warn("[monetizacion] envío a revisión falló", { code: reviewError.code });
    // El borrador quedó guardado: se informa lo que SÍ pasó, no un error total.
    return { ok: true, campaignId, status: "draft" };
  }

  revalidatePath(`/impulsar/${listing.id}`);
  return { ok: true, campaignId, status: "pending_review" };
}
