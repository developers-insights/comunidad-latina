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
  DEFAULT_PUBLISHABLE_OPERATION,
  PROPERTY_OPERATIONS,
  PROPERTY_OPERATION_ATTR,
  PROPERTY_TYPES,
  PROPERTY_TYPE_ATTR,
  PUBLISHABLE_PROPERTY_OPERATIONS,
  isPublishableOperation,
  resolvePricePeriod,
} from "@/lib/propiedades/tipos";
import {
  AVAILABLE_FROM_ATTR,
  DEPOSIT_ATTR,
  EXTRA_FEES_ATTR,
  FURNISHED_ATTR,
  FURNISHED_STATES,
  MAX_DEPOSIT,
  MAX_EXTRA_FEES_LENGTH,
  REQUIREMENTS_ATTR,
  UTILITIES_ATTR,
  isRentalRequirement,
  isRentalUtility,
  normalizeAvailableFrom,
  normalizeRequirements,
  normalizeUtilities,
} from "@/lib/propiedades/alquiler";
import { isEventAudience, isEventCategory } from "@/lib/eventos/categorias";
import {
  EVENT_AUDIENCE_ATTR,
  EVENT_CAPACITY_ATTR,
  EVENT_CATEGORY_ATTR,
  EVENT_ENDS_ATTR,
  EVENT_FREE_ATTR,
  EVENT_MODES,
  EVENT_MODE_ATTR,
  EVENT_ONLINE_URL_ATTR,
  EVENT_STARTS_ATTR,
  EVENT_TICKETS_URL_ATTR,
  EVENT_VENUE_AREA_ATTR,
  MAX_EVENT_CAPACITY,
  normalizeCapacity,
  normalizeEventUrl,
  requiresVenue,
  resolveEventDates,
} from "@/lib/eventos/detalles";

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
   * La venta dejó de aceptarse (spec: «No se incluirán propiedades en venta ni
   * Open Houses»). El mensaje explica la política en vez de decir "valor
   * inválido": quien manda `venta` no se equivocó de tipeo, está intentando
   * hacer algo que la comunidad decidió no ofrecer todavía, y merece saberlo.
   * El formulario ya no ofrece la opción, así que esto sólo aparece con un
   * payload armado a mano o con una pestaña abierta desde antes del cambio.
   */
  saleNotAccepted:
    "Por ahora en Comunidad Latina se publican solo alquileres. La venta de propiedades no está disponible.",
  /** Contradicción de fechas: un evento no puede terminar antes de empezar. */
  eventEndsBeforeStart:
    "La hora de cierre tiene que ser posterior a la de inicio. Revisá las dos fechas.",
  eventModeRequired: "Decinos si el evento es en un lugar o en línea.",
  eventOnlineUrlRequired:
    "Pegá el enlace por donde se entra al evento (tiene que empezar con https://).",
  eventTicketsUrlInvalid:
    "Ese enlace de entradas no se entiende. Copialo completo, con https:// adelante.",
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
  COPY.saleNotAccepted,
  COPY.eventEndsBeforeStart,
  COPY.eventModeRequired,
  COPY.eventOnlineUrlRequired,
  COPY.eventTicketsUrlInvalid,
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
    /**
     * NEGOCIO ORGANIZADOR de un evento → columna `listings.business_listing_id`
     * (0107, ampliada a eventos en 0117). Es lo que hace que el evento aparezca
     * en la ficha del comercio —«página del organizador», spec §6— y en la
     * pestaña Publicaciones de Negocios.
     *
     * Acá sólo se valida la FORMA. Que la ficha exista, sea de esta comunidad,
     * sea del mismo dueño y esté publicada lo decide
     * `app.check_business_listing_link()`, que es `security definer` y corre
     * dentro de la base: reimplementarlo acá sería tener la regla en dos lados.
     */
    businessListingId: z.uuid().nullish(),
    propertyType: z.enum(PROPERTY_TYPES).nullish(),
    /**
     * Se sigue ACEPTANDO el vocabulario completo (`alquiler` y `venta`) aunque
     * sólo uno sea publicable. Si el enum se recortara a `["alquiler"]`, un
     * payload con `venta` moriría con el issue genérico de zod ("valor
     * inválido") y la persona vería "Revisá los datos del aviso". Dejándolo
     * pasar el enum, el `superRefine` de abajo puede rechazarlo con el motivo
     * real: la venta no está disponible todavía. El dato nunca llega a la base
     * en ninguno de los dos caminos.
     */
    operation: z.enum(PROPERTY_OPERATIONS).nullish(),
    bedrooms: z.number().int().min(0).max(20).nullish(),
    bathrooms: z.number().int().min(0).max(20).nullish(),
    sqft: z.number().int().min(1).max(100_000).nullish(),
    // ---- Condiciones del alquiler (contrato: @/lib/propiedades/alquiler) ----
    // Todas OPCIONALES. Un aviso sin ellas es un aviso incompleto, no uno
    // inválido: obligarlas dejaría fuera al que sólo quiere publicar rápido, que
    // es la mitad del vertical. `deposit` admite 0 —"no pido depósito" es una
    // afirmación que merece poder hacerse— y por eso es `min(0)` y no `positive`.
    deposit: z.number().min(0).max(MAX_DEPOSIT).nullish(),
    extraFees: z.string().trim().max(MAX_EXTRA_FEES_LENGTH).nullish(),
    utilities: z.array(z.string()).max(20).nullish(),
    requirements: z.array(z.string()).max(20).nullish(),
    furnished: z.enum(FURNISHED_STATES).nullish(),
    availableFrom: z.string().trim().max(10).nullish(),
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
    // ---- Resto del evento (contrato: @/lib/eventos/*) ----------------------
    eventEndsAt: z.string().trim().max(40).nullish(),
    eventCategory: z.string().trim().max(40).nullish(),
    eventMode: z.enum(EVENT_MODES).nullish(),
    eventOnlineUrl: z.string().trim().max(500).nullish(),
    eventTicketsUrl: z.string().trim().max(500).nullish(),
    /**
     * Tres estados. `null` (no declaró) NO es lo mismo que `false` (declaró que
     * cobra): el formulario obliga a elegir, pero un cliente viejo que no manda
     * el campo tiene que poder seguir publicando sin que le inventemos que su
     * evento es pago.
     */
    eventFree: z.boolean().nullish(),
    eventCapacity: z.number().int().min(1).max(MAX_EVENT_CAPACITY).nullish(),
    eventAudience: z.string().trim().max(40).nullish(),
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
      // La operación sólo se EXIGE si de verdad hay algo que elegir. Con una
      // sola publicable, la ausencia no es un dato faltante: es la única
      // lectura posible de lo que ya se dijo, y asumirla no pone nada en boca
      // de nadie (mismo criterio que la regla 2 de `resolvePricePeriod`).
      // Pedirla igual le daría un error de "campo obligatorio" a un cliente
      // viejo por un campo que el formulario ni siquiera muestra.
      if (!value.operation && PUBLISHABLE_PROPERTY_OPERATIONS.length > 1) {
        ctx.addIssue({ code: "custom", path: ["operation"], message: COPY.operationRequired });
      }
      // -----------------------------------------------------------------
      // LA VENTA YA NO SE PUBLICA (spec). Se frena ACÁ, en el borde del
      // servidor, y no sólo en el formulario: el formulario ya no ofrece la
      // opción, pero una pestaña abierta desde antes del cambio —o cualquier
      // llamada directa a la action— sigue pudiendo mandarla.
      //
      // Nótese qué NO se hace: NO se reescribe `venta` a `alquiler`. Corregir
      // en silencio una operación convertiría la venta de $450.000 que alguien
      // quiso publicar en un alquiler de $450.000. Se rechaza y se explica.
      // -----------------------------------------------------------------
      if (value.operation && !isPublishableOperation(value.operation)) {
        ctx.addIssue({
          code: "custom",
          path: ["operation"],
          message: COPY.saleNotAccepted,
        });
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
    if (value.kind === "event") {
      if (!value.eventStartsAt) {
        ctx.addIssue({ code: "custom", path: ["eventStartsAt"], message: "fecha requerida" });
      } else {
        // Fin antes del inicio: contradicción, no dato incompleto. Descartar el
        // fin en silencio dejaría a la persona publicando convencida de haber
        // puesto una hora de cierre que nadie va a ver.
        const dates = resolveEventDates(value.eventStartsAt, value.eventEndsAt);
        if (!dates.ok && dates.reason === "fin_antes_del_inicio") {
          ctx.addIssue({
            code: "custom",
            path: ["eventEndsAt"],
            message: COPY.eventEndsBeforeStart,
          });
        }
      }
      // Dirección física O enlace virtual: la spec pide que la elección sea
      // EXPLÍCITA, así que la modalidad es obligatoria. Un evento en línea sin
      // enlace no es un evento en línea: es una promesa sin puerta.
      if (!value.eventMode) {
        ctx.addIssue({ code: "custom", path: ["eventMode"], message: COPY.eventModeRequired });
      } else if (!requiresVenue(value.eventMode) && !normalizeEventUrl(value.eventOnlineUrl)) {
        ctx.addIssue({
          code: "custom",
          path: ["eventOnlineUrl"],
          message: COPY.eventOnlineUrlRequired,
        });
      }
      // El enlace de entradas es opcional, pero si vino y no se entiende se
      // avisa en vez de tragárselo: un botón que no aparece sin explicación es
      // la clase de silencio que después se reporta como "no me guardó nada".
      if (value.eventTicketsUrl?.trim() && !normalizeEventUrl(value.eventTicketsUrl)) {
        ctx.addIssue({
          code: "custom",
          path: ["eventTicketsUrl"],
          message: COPY.eventTicketsUrlInvalid,
        });
      }
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

  const attrs: Record<string, string | number | boolean | string[]> = {};
  if (input.kind === "property") {
    // Sólo se escribe lo declarado: una clave ausente significa "no declarado",
    // y ésa es la lectura que hace readPropertyFacts. Escribir un valor vacío o
    // un default convertiría un silencio en una afirmación.
    if (input.propertyType) attrs[PROPERTY_TYPE_ATTR] = input.propertyType;
    // La operación se escribe SIEMPRE, aunque hoy sólo haya una publicable: el
    // aviso tiene que decir qué es por sí mismo. El filtro del listado y el chip
    // del detalle leen el dato guardado, no la política que regía el día que se
    // publicó — un alquiler sin `operation` sería invisible para el filtro.
    attrs[PROPERTY_OPERATION_ATTR] = input.operation ?? DEFAULT_PUBLISHABLE_OPERATION;
    if (input.bedrooms !== null && input.bedrooms !== undefined) attrs.bedrooms = input.bedrooms;
    if (input.bathrooms !== null && input.bathrooms !== undefined) attrs.bathrooms = input.bathrooms;
    if (input.sqft !== null && input.sqft !== undefined) attrs.sqft = input.sqft;

    // ---- Condiciones del alquiler --------------------------------------
    // Cada una entra sólo si se declaró. El depósito se compara contra
    // null/undefined y NO con un truthy: `0` es falsy y es justamente el valor
    // que más importa conservar ("no pido depósito").
    if (input.deposit !== null && input.deposit !== undefined) {
      attrs[DEPOSIT_ATTR] = input.deposit;
    }
    if (input.extraFees) attrs[EXTRA_FEES_ATTR] = input.extraFees;
    // Los catálogos se filtran del lado del servidor: el formulario manda
    // slugs de una lista cerrada, pero esta action es pública y puede recibir
    // cualquier arreglo de strings. Se guarda lo reconocible y se descarta el
    // resto (a diferencia de una contradicción, un slug inventado no cambia el
    // sentido de nada — sólo sobra).
    const utilities = normalizeUtilities((input.utilities ?? []).filter(isRentalUtility));
    if (utilities.length > 0) attrs[UTILITIES_ATTR] = utilities;
    const requirements = normalizeRequirements(
      (input.requirements ?? []).filter(isRentalRequirement),
    );
    if (requirements.length > 0) attrs[REQUIREMENTS_ATTR] = requirements;
    if (input.furnished) attrs[FURNISHED_ATTR] = input.furnished;
    const availableFrom = normalizeAvailableFrom(input.availableFrom);
    if (availableFrom) attrs[AVAILABLE_FROM_ATTR] = availableFrom;
  }
  if (input.kind === "professional") {
    if (input.category) attrs.category = input.category;
    if (input.credentials) attrs.credentials = input.credentials;
  }
  if (input.kind === "event") {
    // Fechas por el resolutor compartido: devuelve ISO canónico (el mismo
    // formato que el seed y que lee parseEventAttrs) y ya rechazó el fin
    // anterior al inicio en el esquema.
    const dates = resolveEventDates(input.eventStartsAt, input.eventEndsAt);
    if (dates.ok) {
      attrs[EVENT_STARTS_ATTR] = dates.startsAt;
      if (dates.endsAt) attrs[EVENT_ENDS_ATTR] = dates.endsAt;
    }
    if (isEventCategory(input.eventCategory)) attrs[EVENT_CATEGORY_ATTR] = input.eventCategory;
    if (input.eventMode) attrs[EVENT_MODE_ATTR] = input.eventMode;
    const onlineUrl = normalizeEventUrl(input.eventOnlineUrl);
    // El enlace virtual sólo se guarda si el evento ES virtual: dejarlo pegado
    // a uno presencial pondría un botón "entrar" en un evento al que hay que ir.
    if (onlineUrl && input.eventMode && !requiresVenue(input.eventMode)) {
      attrs[EVENT_ONLINE_URL_ATTR] = onlineUrl;
    }
    // Enlace BASE de entradas (gratis, para todos). El premium vive en la
    // columna cta_tickets_url, que la 0048 le prohíbe a un aviso free —y un
    // aviso NACE free—, así que no puede escribirse desde acá aunque quisiera.
    // La regla de precedencia entre los dos está en resolveEventTicketsUrl().
    const ticketsUrl = normalizeEventUrl(input.eventTicketsUrl);
    if (ticketsUrl) attrs[EVENT_TICKETS_URL_ATTR] = ticketsUrl;
    // Gratis o pago: se escribe el booleano tal cual vino. Hasta hoy esta clave
    // sólo la escribían los scripts de seed y `parseEventAttrs` la leía sin que
    // ningún formulario la produjera nunca — el chip "Gratis" existía y no
    // aparecía jamás en un evento real.
    if (typeof input.eventFree === "boolean") attrs[EVENT_FREE_ATTR] = input.eventFree;
    const capacity = normalizeCapacity(input.eventCapacity);
    if (capacity !== null) attrs[EVENT_CAPACITY_ATTR] = capacity;
    if (isEventAudience(input.eventAudience)) attrs[EVENT_AUDIENCE_ATTR] = input.eventAudience;
    attrs[EVENT_VENUE_AREA_ATTR] = input.areaLabel;
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
  // Un evento declarado GRATIS no lleva precio, punto. Se fuerza acá y no se
  // confía en que el formulario haya limpiado el campo: se puede escribir un
  // precio, volver atrás y marcar "gratis", y el estado del input sobrevive.
  // Publicar "Gratis · $25" sería mentirle a quien lee.
  const isFreeEvent = input.kind === "event" && input.eventFree === true;
  const priceAmount = isFreeEvent ? null : (input.priceAmount ?? null);

  let pricePeriod: "month" | "week" | "day" | "one_time" | null = priceAmount
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
      price_amount: priceAmount,
      price_currency: tenant.currency,
      price_period: pricePeriod,
      attrs,
      area_label: input.areaLabel,
      status: "draft",
      created_by: user.id,
      /**
       * Sólo en eventos, y `null` en todo lo demás: el trigger de la 0117
       * rechaza el vínculo desde cualquier otro vertical con VINCULO_INVALIDO,
       * y mandarlo "por las dudas" convertiría un descuido del formulario en un
       * alta que no se puede completar.
       */
      business_listing_id:
        input.kind === "event" ? (input.businessListingId ?? null) : null,
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
      // Admin no configurado — el aviso queda en revisión, nunca rompemos. Se
      // loguea igual que su hermano de la cola de moderación treinta líneas
      // abajo: sin la línea, "el aviso quedó en revisión" no distingue entre la
      // moderación haciendo su trabajo y el cliente admin sin configurar.
      console.warn("[vivienda] admin client no disponible para auto-aprobar");
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
