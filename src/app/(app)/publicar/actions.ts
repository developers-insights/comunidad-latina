"use server";

import { z } from "zod";
import { limit, DAY_MS } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { isVisionConfigured } from "@/lib/config/services";
import { MONETIZATION_COPY, checkPhotoCount } from "@/lib/monetization";
import {
  TIER_AUTO,
  TIER_HUMAN,
  TIER_REVIEW,
  enqueueModeration,
  moderateText,
  moderationTier,
} from "@/lib/moderation";
import {
  declarationSchema,
  normalizeDeclaration,
  registerUploadedMedia,
  type DeclarationInput,
} from "@/lib/integrity";
import { currentSourceHost } from "@/lib/integrity/source-host";
import {
  PROPERTY_OPERATIONS,
  PROPERTY_OPERATION_ATTR,
  PROPERTY_TYPES,
  PROPERTY_TYPE_ATTR,
  resolvePricePeriod,
} from "@/lib/propiedades/tipos";

/**
 * Server actions de /publicar.
 *
 * Flujo (dictado por los contratos de DB/Storage):
 *  1. createListingDraft → INSERT con status 'draft' (la RLS de listings
 *     prohíbe que un aviso de usuario NAZCA published — publicar pasa por
 *     moderación). Devuelve el listingId para poder subir fotos: la RLS de
 *     storage exige path {tenant_id}/{listing_id}/… con listing propio.
 *  2. El cliente sube las fotos al bucket listing-photos con su propia sesión.
 *  3. finalizeListing → setea photos, modera el texto y pasa a 'pending_review',
 *     encolando el aviso en `moderation_queue` (mismo patrón que
 *     marketplace/publicar y feed).
 *     Degradación §5.6: imagen sin Vision configurado JAMÁS se publica sola.
 *     Solo en dev, MODERATION_DEV_AUTO_APPROVE==='true' aprueba al toque
 *     (promoción vía cliente admin = acto de moderación server-side).
 *
 * POR QUÉ EL ENCOLADO NO ES OPCIONAL (arreglo 2026-08-08):
 * dejar el aviso en `pending_review` es sólo la MITAD de la regla de oro
 * ("NUNCA publicar imagen sin moderar", §7). /admin/moderacion lee la COLA, no
 * la tabla `listings` — así que un aviso que no se encola no se publica pero
 * TAMPOCO se modera: se queda esperando a un humano que nunca lo va a ver.
 * El flujo de productos ya lo hacía bien; este no encolaba nada.
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

const COPY = {
  invalid: "Revisá los datos del aviso — hay algo incompleto.",
  propertyTypeRequired: "Elegí qué tipo de propiedad estás publicando.",
  operationRequired: "Decinos si la propiedad se alquila o se vende.",
  /**
   * Contradicción, no dato faltante: "en venta" y "por mes" no pueden ser
   * ciertos a la vez, y elegir cuál gana sería inventar lo que la persona quiso
   * decir. El formulario hace inalcanzable este estado (al elegir Venta se
   * oculta la frecuencia), así que sólo aparece con un payload armado a mano.
   */
  saleWithFrequency:
    "Una venta lleva un precio único. Si el precio es por mes, semana o día, la operación es alquiler.",
  needsAuth: "Para publicar necesitás entrar a tu cuenta.",
  tooManyToday:
    "Ya creaste varios avisos hoy. Para cuidar la calidad del directorio, esperá hasta mañana para publicar otro.",
  genericError:
    "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo en un ratito.",
} as const;

/**
 * Mensajes del esquema que SÍ se le muestran a la persona tal cual. El resto
 * de los issues de zod son internos ("precio requerido", "fecha inválida") y
 * se resumen en `COPY.invalid`: nombran campos y formatos, no dicen qué hacer.
 */
const USER_FACING_ISSUES = new Set<string>([
  COPY.propertyTypeRequired,
  COPY.operationRequired,
  COPY.saleWithFrequency,
]);

const draftSchema = z
  .object({
    kind: z.enum(KINDS),
    title: z.string().trim().min(8).max(120),
    description: z.string().trim().min(30).max(4000),
    priceAmount: z.number().positive().max(1_000_000).nullish(),
    pricePeriod: z.enum(PERIODS).nullish(),
    // Vivienda: QUÉ es y QUÉ se ofrece. Van a `attrs` (JSONB libre) igual que
    // bedrooms/sqft — sin migración. El catálogo y las reglas de coherencia
    // viven en @/lib/propiedades/tipos, que también usan el form y el listado.
    propertyType: z.enum(PROPERTY_TYPES).nullish(),
    operation: z.enum(PROPERTY_OPERATIONS).nullish(),
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
    if (value.kind === "property") {
      if (!value.propertyType) {
        ctx.addIssue({
          code: "custom",
          path: ["propertyType"],
          message: COPY.propertyTypeRequired,
        });
      }
      if (!value.operation) {
        ctx.addIssue({ code: "custom", path: ["operation"], message: COPY.operationRequired });
      }
      // Coherencia operación ↔ período: la regla completa (y su porqué) está
      // en resolvePricePeriod. Se valida ACÁ, en el borde, para que la fila que
      // llega a la base ya no pueda decir "en venta, $2.000 por mes".
      const coherence = resolvePricePeriod(value.operation ?? null, value.pricePeriod ?? null);
      if (!coherence.ok) {
        ctx.addIssue({
          code: "custom",
          path: ["pricePeriod"],
          message: COPY.saleWithFrequency,
        });
      }
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

const GENERIC_ERROR = COPY.genericError;

export async function createListingDraft(rawInput: DraftInput): Promise<CreateDraftResult> {
  const parsed = draftSchema.safeParse(rawInput);
  if (!parsed.success) {
    // Si el esquema tiene algo concreto y accionable para decir, se dice: un
    // "revisá los datos" genérico frente a una contradicción precio/operación
    // deja a la persona buscando a ciegas qué corregir.
    const explicit = parsed.error.issues.find((issue) =>
      USER_FACING_ISSUES.has(issue.message),
    );
    return { ok: false, error: explicit?.message ?? COPY.invalid };
  }
  const input = parsed.data;

  // Guard ANTES del rate limit: si el tenant del JWT no coincide con el del
  // header, la RLS va a rechazar el insert — no le quemamos la cuota diaria
  // al usuario por una escritura que no podía prosperar.
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: COPY.needsAuth };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  // Rate limit: 10 publicaciones/día por usuario (anti-flood de avisos).
  if (!limit(`publicar:${user.id}`, 10, DAY_MS).ok) {
    return { ok: false, error: COPY.tooManyToday };
  }

  const attrs: Record<string, string | number> = {};
  if (input.kind === "property") {
    // Sólo se escribe lo declarado: una clave ausente significa "no declarado",
    // y ésa es la lectura que hace readPropertyFacts. Escribir un valor vacío o
    // un default convertiría un silencio en una afirmación.
    if (input.propertyType) attrs[PROPERTY_TYPE_ATTR] = input.propertyType;
    if (input.operation) attrs[PROPERTY_OPERATION_ATTR] = input.operation;
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

  // -------------------------------------------------------------------------
  // Período de precio: la operación manda sobre la frecuencia.
  //
  // El default histórico ("month" cuando hay precio y no se eligió período) se
  // conserva para todo lo que no es vivienda. En vivienda, `resolvePricePeriod`
  // lo corrige: una VENTA se guarda como `one_time` aunque el payload traiga
  // otra cosa, así el precio nunca se muestra con un "/mes" que nadie quiso.
  // El caso contradictorio ya lo frenó el esquema; acá sólo queda el defensivo.
  // -------------------------------------------------------------------------
  let pricePeriod: "month" | "week" | "day" | "one_time" | null = input.priceAmount
    ? (input.pricePeriod ?? "month")
    : null;
  if (input.kind === "property") {
    const coherence = resolvePricePeriod(input.operation ?? null, pricePeriod);
    if (!coherence.ok) {
      return { ok: false, error: COPY.saleWithFrequency };
    }
    pricePeriod = coherence.period;
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
      price_period: pricePeriod,
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

/**
 * El array llega SIN tope de zod a propósito (bueno: con uno absurdo que sólo
 * frena un payload malicioso). El tope real depende del TIER del aviso, que se
 * lee de la base más abajo — ponerlo acá lo congelaría en el número de gratis y
 * un aviso premium no podría subir sus 20 fotos.
 */
const finalizeSchema = z.object({
  listingId: z.uuid(),
  photoPaths: z.array(z.string().min(1).max(300)).max(100),
  /**
   * Declaración de originalidad y licencia del formulario (pliego / 0061). Es
   * opcional en el borde: un cliente viejo que no la mande NO puede romper una
   * publicación — se lee como "no declaró nada", que es la lectura conservadora
   * y la que hace que el escaneo levante su alerta de licencia.
   */
  declaration: declarationSchema.nullish(),
});

export type FinalizeResult =
  | {
      ok: true;
      status: "published" | "pending_review";
      /** El vertical del aviso: la pantalla de éxito arma con esto sus links. */
      kind: string;
    }
  | { ok: false; error: string; needsAuth?: boolean };

export async function finalizeListing(rawInput: {
  listingId: string;
  photoPaths: string[];
  declaration?: DeclarationInput | null;
}): Promise<FinalizeResult> {
  const parsed = finalizeSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: GENERIC_ERROR };
  }
  const { listingId, photoPaths } = parsed.data;
  const declaration = normalizeDeclaration(rawInput.declaration);

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

  // -------------------------------------------------------------------------
  // TOPE DE FOTOS — EN EL SERVIDOR (§3 del feedback consolidado).
  //
  // El tope de la publicación gratuita ES la diferencia que se cobra, así que
  // un tope que sólo vive en el formulario no es un tope: alcanza con llamar a
  // esta action con 20 paths para llevarse el beneficio premium gratis.
  //
  // El tier se lee de la FILA. Un aviso nace `free` (la policy listings_insert
  // lo exige) y sólo el flujo de pago lo mueve — así que preguntar acá es
  // preguntarle al único que sabe la verdad.
  // -------------------------------------------------------------------------
  // Además del tier se traen título y descripción: son el insumo de la
  // moderación de texto y viajan en el round-trip que esta lectura ya hacía.
  const { data: current } = await supabase
    .from("listings")
    .select("tier, title, description")
    .eq("id", listingId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    .maybeSingle();

  const photoCheck = checkPhotoCount(current?.tier, photoPaths.length);
  if (!photoCheck.ok) {
    return { ok: false, error: MONETIZATION_COPY.errors.tooManyPhotos(photoCheck.max) };
  }

  // ---- Moderación de texto ANTES de decidir el status (§8) -----------------
  const moderation = await moderateText(
    `${current?.title ?? ""}\n${current?.description ?? ""}`,
  );
  const textTier = moderation.flagged ? TIER_HUMAN : moderationTier(moderation.score);

  // ---- Content Integrity: huella de cada foto (§ pliego) -------------------
  // Las fotos las subió el navegador DIRECTO al bucket, así que el servidor las
  // lee de ahí para hashearlas. Corre ANTES de decidir el status: si el análisis
  // encontró un duplicado —o si no pudo correr— el aviso no se publica solo.
  const integrity = await registerUploadedMedia({
    tenantId: tenant.id,
    uploaderId: user.id,
    subjectKind: "listing",
    subjectId: listingId,
    sourceHost: await currentSourceHost(tenant.slug),
    declaration,
    items: photoPaths.map((path) => ({
      mediaKind: "imagen" as const,
      storageBucket: "listing-photos",
      storagePath: path,
    })),
  });

  // La RLS de UPDATE garantiza que solo el dueño puede tocar la fila.
  const { data: updated, error: updateError } = await supabase
    .from("listings")
    .update({ photos: photoPaths, status: "pending_review" })
    .eq("id", listingId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    .select("id, created_by, kind")
    .maybeSingle();

  if (updateError || !updated) {
    console.warn("[vivienda] finalize falló", { listingId, code: updateError?.code });
    return { ok: false, error: GENERIC_ERROR };
  }

  // Auto-aprobación SOLO fuera de producción: aunque la env var se filtre a
  // un deploy productivo, este branch es estructuralmente imposible ahí
  // (§5.6: imagen sin moderar NUNCA se publica en prod).
  const isProduction =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  const devAutoApprove =
    process.env.MODERATION_DEV_AUTO_APPROVE === "true" && !isProduction;

  const kind = updated.kind;

  // §5.6: una imagen sin Vision es una imagen sin moderar → la mira un humano.
  const photoNeedsReview = photoPaths.length > 0 && !isVisionConfigured && !devAutoApprove;

  // La auto-aprobación dev NO es un pase libre: sigue respetando el veredicto
  // de la IA sobre el texto (mismo criterio que finalizeProduct) y, desde
  // Content Integrity, también el de las huellas. Un duplicado exacto o un
  // archivo que no se pudo analizar NO se publica solo ni siquiera en dev: es
  // justo el caso que el pliego pide que mire una persona.
  const wantsPublish =
    devAutoApprove &&
    !moderation.flagged &&
    textTier <= TIER_AUTO &&
    !photoNeedsReview &&
    !integrity.needsHumanReview;

  let finalStatus: "published" | "pending_review" = "pending_review";

  if (wantsPublish) {
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
      } else {
        finalStatus = "published";
      }
    } catch {
      // Admin no configurado — el aviso queda en revisión, nunca rompemos.
    }
  }

  // ---- Cola de moderación (§8/§12) ------------------------------------------
  // Sin esto el aviso queda en `pending_review` y NADIE lo ve: /admin/moderacion
  // lista la cola, no los listings. Mismo patrón que marketplace/publicar.
  if (finalStatus === "pending_review") {
    const shouldEnqueue =
      moderation.flagged ||
      moderation.skipped ||
      textTier > TIER_AUTO ||
      photoNeedsReview ||
      integrity.needsHumanReview;
    if (shouldEnqueue) {
      try {
        const reasons = [
          ...(moderation.skipped ? ["moderation_skipped"] : moderation.categories),
          ...(photoNeedsReview ? ["photo_pending_review"] : []),
          ...integrity.reasons,
        ];
        const outcome = await enqueueModeration(createAdminClient(), {
          tenantId: tenant.id,
          subjectKind: "listing",
          subjectId: listingId,
          aiScore: moderation.skipped ? null : moderation.score,
          reasons,
          tier:
            moderation.flagged || photoNeedsReview || integrity.needsHumanReview
              ? TIER_HUMAN
              : TIER_REVIEW,
        });
        if (!outcome.ok) {
          console.warn("[vivienda] no se pudo encolar moderación del aviso", { listingId });
        }
      } catch {
        console.warn("[vivienda] admin client no disponible para encolar moderación");
      }
    }
  }

  return { ok: true, status: finalStatus, kind };
}
