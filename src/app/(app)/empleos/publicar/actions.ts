"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { DAY_MS, limit } from "@/lib/rate-limit";
import { isVisionConfigured } from "@/lib/config/services";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { requireIdentidadVerificada } from "@/lib/verificacion/gate";
import {
  TIER_AUTO,
  TIER_HUMAN,
  TIER_REVIEW,
  enqueueModeration,
  moderateText,
  moderationTier,
} from "@/lib/moderation";
import {
  EMPLOYMENT_TYPES,
  JOB_PAY_PERIODS,
  jobQuestionsSchema,
  parseJobAttrs,
  type JobQuestion,
} from "@/components/empleos/helpers";
import { COPY } from "@/components/empleos/copy";
import { WORK_MODES, requiresArea } from "@/lib/creators/work-mode";
import {
  APPLY_BY_ATTR,
  EXPERIENCE_ATTR,
  JOB_EXPERIENCE_LEVELS,
  LANGUAGES_ATTR,
  MAX_SALARY,
  MAX_SCHEDULE_LENGTH,
  SALARY_MAX_ATTR,
  SCHEDULE_ATTR,
  STARTS_ON_ATTR,
  WORK_DAYS_ATTR,
  isJobLanguage,
  isWorkDay,
  normalizeJobDate,
  normalizeLanguages,
  normalizeWorkDays,
  resolveSalaryRange,
} from "@/lib/empleos/detalles";

/**
 * Server actions de /empleos/publicar — publicar un EMPLEO comunitario
 * (listing kind='job'). Espejo fiel del publish de Creadores
 * (creadores/actions.ts) y del Marketplace: MISMO flujo de dos fases, dictado
 * por los contratos de DB/Storage, no por gusto:
 *
 *  1. createJobDraft → INSERT status='draft' (la RLS de listings, 0004, prohíbe
 *     que un aviso de usuario NAZCA published). Devuelve el listingId, que hace
 *     falta para subir fotos: la policy de storage exige el path
 *     {tenant_id}/{listing_id}/…
 *  2. El cliente sube hasta 4 fotos (OPCIONALES) al bucket listing-photos.
 *  3. finalizeJob → escribe las fotos, modera el texto y decide el status.
 *
 * DIFERENCIAS PROPIAS DE EMPLEOS (todo lo demás es el patrón del repo):
 *  - `kind: 'job'` se fija ACÁ, nunca llega del cliente.
 *  - SALARIO OBLIGATORIO (transparencia — feedback 24/7): a diferencia del
 *    wizard genérico, un empleo sin monto no se publica. Va a price_amount con
 *    price_period ∈ {hour, day, week, month} — la DB ya admite 'hour' (0004) y
 *    PERIOD_SUFFIX ya rinde "/hora".
 *  - attrs = { employment_type, questions }: las preguntas al postulante viven
 *    en el aviso (contrato de components/empleos/helpers.ts, jobQuestionsSchema)
 *    y se validan de nuevo acá — el cliente puede mandar cualquier cosa.
 *
 * QUÉ SE SUMÓ CON LOS CAMPOS DE LA SPEC, Y DÓNDE VA CADA COSA:
 *  - `attrs`: techo del rango salarial, días, horario, experiencia, idiomas,
 *    fecha de inicio y fecha límite. Contrato en @/lib/empleos/detalles.
 *  - COLUMNA `listings.work_mode` (0087, ya existía): presencial / a distancia /
 *    mixto. Se REUSA en vez de inventar `attrs.work_mode` — el mismo hecho en
 *    dos lugares se termina contradiciendo. Además gobierna si la zona es
 *    obligatoria, vía `requiresArea()`.
 *  - COLUMNA `listings.business_listing_id` (0107, nueva): el negocio al que
 *    pertenece el puesto. Necesita FK e índice, así que no podía ir a `attrs`;
 *    el porqué completo está en el docblock de esa migración.
 *  - EL PISO DEL SALARIO SIGUE EN `price_amount`. Sólo el techo va a `attrs`:
 *    `price_amount` es lo que ordena, filtra y formatea toda la app, y mover el
 *    salario a `attrs` para que "quepa" el rango sacaría a los empleos de todo eso.
 */

const C = COPY.publish;

// ===========================================================================
// Borrador
// ===========================================================================

const jobDraftSchema = z
  .object({
    title: z.string().trim().min(8).max(120),
    description: z.string().trim().min(30).max(4000),
    /** Obligatorio: no hay empleo sin salario a la vista. Es el PISO del rango. */
    salaryAmount: z.number().positive().max(MAX_SALARY),
    /**
     * Techo del rango. OPCIONAL: el aviso de monto único sigue siendo el caso
     * más común y no se le agrega un paso a nadie. El piso va a la columna
     * `price_amount` (lo que ordena y formatea toda la app) y sólo el techo a
     * `attrs` — ver el docblock de @/lib/empleos/detalles.
     */
    salaryMax: z.number().positive().max(MAX_SALARY).nullish(),
    payPeriod: z.enum(JOB_PAY_PERIODS),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    /**
     * Modalidad → COLUMNA `listings.work_mode` (0087), no `attrs`. Ya existe con
     * su CHECK y su índice parcial; hoy sólo la usaba Creadores. Crear un
     * `attrs.work_mode` paralelo sería el mismo hecho escrito dos veces.
     */
    workMode: z.enum(WORK_MODES).nullish(),
    /**
     * Zona. Deja de ser obligatoria SIEMPRE: con `work_mode = 'remoto'` no hay
     * zona que declarar, y exigirla obligaba a escribir "Remoto" en un campo de
     * ubicación (que es exactamente el texto libre que la 0087 vino a
     * reemplazar). La regla vive en `requiresArea()`, una sola vez.
     */
    areaLabel: z.string().trim().max(80).nullish(),
    /** Contrato compartido: hasta 5, sí/no u opción múltiple con 2–6 opciones. */
    questions: jobQuestionsSchema,
    // ---- Ficha del puesto (contrato: @/lib/empleos/detalles) --------------
    // Todo opcional: son los datos que hoy se preguntan por chat, no requisitos
    // para poder publicar.
    days: z.array(z.string()).max(7).nullish(),
    schedule: z.string().trim().max(MAX_SCHEDULE_LENGTH).nullish(),
    experience: z.enum(JOB_EXPERIENCE_LEVELS.map((level) => level.value)).nullish(),
    languages: z.array(z.string()).max(10).nullish(),
    startsOn: z.string().trim().max(10).nullish(),
    applyBy: z.string().trim().max(10).nullish(),
    /**
     * Negocio vinculado → COLUMNA `listings.business_listing_id` (0107). Acá
     * sólo se valida la FORMA (uuid); la pertenencia —mismo tenant, kind
     * business, mismo dueño— la impone `app.check_business_listing_link()` en
     * la base, que es el único lugar donde no se puede saltear.
     */
    businessListingId: z.uuid().nullish(),
  })
  .superRefine((value, ctx) => {
    if (requiresArea(value.workMode ?? null) && (value.areaLabel ?? "").trim().length < 3) {
      ctx.addIssue({ code: "custom", path: ["areaLabel"], message: C.errors.areaShort });
    }
    // Techo menor que piso: contradicción, no dato incompleto. Elegir cuál gana
    // sería inventar qué quiso decir la persona.
    if (!resolveSalaryRange(value.salaryAmount, value.salaryMax ?? null).ok) {
      ctx.addIssue({ code: "custom", path: ["salaryMax"], message: C.errors.salaryRangeInvalid });
    }
    // Fecha límite anterior al inicio: un aviso al que hay que postularse
    // después de que el trabajo empezó no le sirve a nadie.
    const startsOn = normalizeJobDate(value.startsOn);
    const applyBy = normalizeJobDate(value.applyBy);
    if (startsOn && applyBy && applyBy > startsOn) {
      ctx.addIssue({ code: "custom", path: ["applyBy"], message: C.errors.applyByAfterStart });
    }
  });

export type JobDraftInput = z.input<typeof jobDraftSchema>;

export type CreateJobDraftResult =
  | { ok: true; listingId: string }
  | { ok: false; error: string; needsAuth?: boolean; needsIdentity?: boolean };

/**
 * Los mensajes del esquema que SÍ se le muestran a la persona tal cual. El
 * resto de los issues de zod son internos ("string demasiado corto", "uuid
 * inválido"): nombran campos y formatos, no dicen qué hacer, y se resumen en el
 * genérico. Mismo criterio que USER_FACING_ISSUES de /publicar.
 */
const USER_FACING_ISSUES = new Set<string>([
  C.errors.areaShort,
  C.errors.salaryRangeInvalid,
  C.errors.applyByAfterStart,
]);

export async function createJobDraft(
  rawInput: JobDraftInput,
): Promise<CreateJobDraftResult> {
  // Zod PURO primero (sin I/O): un payload roto no consume guard ni cuota.
  const parsed = jobDraftSchema.safeParse(rawInput);
  if (!parsed.success) {
    const explicit = parsed.error.issues.find((issue) => USER_FACING_ISSUES.has(issue.message));
    return { ok: false, error: explicit?.message ?? C.errors.generic };
  }
  const input = parsed.data;

  // Guard ANTES de cualquier efecto colateral (regla del repo, lib/tenant/guard.ts):
  // si el tenant del JWT no coincide con el del request, la RLS va a rechazar el
  // insert — no quemamos rate limit ni tocamos storage por una escritura muerta.
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: C.needLoginCta };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  // Identidad verificada, ANTES del rate limit: quien no puede publicar no
  // consume su cuota del día por intentarlo. `job` está en
  // VERTICALES_QUE_EXIGEN_IDENTIDAD, así que acá el gate es incondicional — no
  // hay condición de precio como en /publicar, donde un evento gratis no gatea.
  //
  // Va también en la policy `listings_insert` (0126). Esta rama existe para que
  // el rechazo llegue con un texto que se entiende: sin ella, PostgREST
  // devuelve un 42501 crudo y la persona no se entera de que le falta
  // verificarse ni de que es gratis.
  const identidad = await requireIdentidadVerificada(supabase, { kind: "job" });
  if (!identidad.permitido) {
    return { ok: false, error: C.errors.identityRequired, needsIdentity: true };
  }

  if (!limit(`empleos-publicar:${user.id}`, 10, DAY_MS).ok) {
    return { ok: false, error: C.errors.generic };
  }

  // El rango ya se validó en el esquema; acá sólo se traduce a lo que se
  // guarda. `max: null` significa monto único, que es lo mismo que devuelve
  // cuando el techo es igual al piso — un "rango" de $18 a $18 no es un rango.
  const salary = resolveSalaryRange(input.salaryAmount, input.salaryMax ?? null);
  const salaryMax = salary.ok ? salary.max : null;

  // `attrs` sólo lleva lo DECLARADO. Una clave ausente se lee como "no lo dijo"
  // (readJobDetails), y escribir un arreglo vacío o un string en blanco
  // convertiría ese silencio en una afirmación.
  // El tipo se anota estrecho (y no `unknown`) porque `listings.attrs` es
  // `Json` en los tipos generados: un `Record<string, unknown>` no encaja ahí y
  // el error aparecería recién en el insert, lejos de donde se arma el objeto.
  const attrs: Record<string, string | number | string[] | JobQuestion[]> = {
    employment_type: input.employmentType,
    questions: input.questions,
  };
  if (salaryMax !== null) attrs[SALARY_MAX_ATTR] = salaryMax;
  // Los catálogos se re-filtran en el servidor: el formulario manda slugs de
  // una lista cerrada, pero esta action es pública.
  const days = normalizeWorkDays((input.days ?? []).filter(isWorkDay));
  if (days.length > 0) attrs[WORK_DAYS_ATTR] = days;
  if (input.schedule) attrs[SCHEDULE_ATTR] = input.schedule;
  if (input.experience) attrs[EXPERIENCE_ATTR] = input.experience;
  const languages = normalizeLanguages((input.languages ?? []).filter(isJobLanguage));
  if (languages.length > 0) attrs[LANGUAGES_ATTR] = languages;
  const startsOn = normalizeJobDate(input.startsOn);
  if (startsOn) attrs[STARTS_ON_ATTR] = startsOn;
  const applyBy = normalizeJobDate(input.applyBy);
  if (applyBy) attrs[APPLY_BY_ATTR] = applyBy;

  const workMode = input.workMode ?? null;
  // Con modalidad "a distancia" la zona no se pide y no se inventa. Se guarda
  // NULL y no un string vacío —mismo criterio que `createGigDraft`—: la
  // ausencia del dato tiene que poder distinguirse de "escribió nada". El texto
  // libre "Remoto" en un campo de ubicación es justo lo que la 0087 reemplazó.
  const areaLabel = requiresArea(workMode) ? (input.areaLabel ?? "").trim() || null : null;

  // `work_mode` (0087) y `business_listing_id` (0107) existen en la base con su
  // CHECK / su FK, pero `database.types.ts` se regenera aparte y todavía no las
  // lista. El cast es por el TIPO generado, no por el contrato — mismo patrón
  // que ya usa `createGigDraft` con `work_mode`.
  const open = supabase as unknown as SupabaseClient;
  const { data: created, error } = await open
    .from("listings")
    .insert({
      tenant_id: tenant.id,
      kind: "job",
      title: input.title,
      description: input.description,
      price_amount: input.salaryAmount,
      price_currency: tenant.currency,
      price_period: input.payPeriod,
      attrs,
      area_label: areaLabel,
      work_mode: workMode,
      business_listing_id: input.businessListingId ?? null,
      status: "draft",
      created_by: user.id,
    })
    .select("id")
    .returns<{ id: string }[]>()
    .single();

  if (error || !created) {
    console.warn("[empleos] insert de borrador falló", { code: error?.code });
    // El trigger app.check_business_listing_link() (0107) rechaza un vínculo
    // que no es del usuario con VINCULO_INVALIDO. Se distingue del error
    // genérico porque es accionable: la persona puede elegir otro negocio o
    // ninguno, y "probá de nuevo en un ratito" la dejaría reintentando algo que
    // nunca va a funcionar.
    const isLinkError = typeof error?.message === "string" && error.message.includes("VINCULO_INVALIDO");
    return { ok: false, error: isLinkError ? C.errors.businessLinkInvalid : C.errors.generic };
  }

  return { ok: true, listingId: created.id };
}

// ===========================================================================
// Cierre (fotos + moderación + status)
// ===========================================================================

const finalizeJobSchema = z.object({
  listingId: z.uuid(),
  photoPaths: z.array(z.string().min(1).max(300)).max(4),
});

export type FinalizeJobResult =
  | { ok: true; status: "published" | "pending_review" }
  | { ok: false; error: string; needsAuth?: boolean };

// Auto-aprobación SOLO fuera de producción — helper idéntico al del FEED
// (feed/actions.ts), Creadores y Marketplace. Duplicado a propósito: cada
// módulo es dueño de su política de publicación.
function devAutoApprove(): boolean {
  const isProduction =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  return process.env.MODERATION_DEV_AUTO_APPROVE === "true" && !isProduction;
}

export async function finalizeJob(rawInput: {
  listingId: string;
  photoPaths: string[];
}): Promise<FinalizeJobResult> {
  const parsed = finalizeJobSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: C.errors.generic };
  }
  const { listingId, photoPaths } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: C.needLoginCta };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  // Finalize es re-invocable (reintentos legítimos de subida de fotos), pero
  // no gratis: sin cuota propia sería el motor de la re-publicación en loop.
  if (!limit(`empleos-finalize:${user.id}`, 20, DAY_MS).ok) {
    return { ok: false, error: C.errors.generic };
  }

  // Paths canónicos {tenant_id}/{listing_id}/archivo — bucket listing-photos.
  const pathPattern = new RegExp(
    `^${tenant.id}/${listingId}/[A-Za-z0-9._-]+\\.(webp|jpe?g|png)$`,
    "i",
  );
  if (!photoPaths.every((path) => pathPattern.test(path) && !path.includes(".."))) {
    return { ok: false, error: C.errors.generic };
  }

  // UPDATE con el cliente del USUARIO: escribe las fotos y pasa a
  // 'pending_review'. La RLS de listings (0004) NUNCA deja que el dueño escriba
  // status='published' (anti bait-and-switch post-verificación) — ese salto lo
  // hace el admin client más abajo. El mismo round-trip RE-CONFIRMA ownership
  // (.eq de tenant/creador/kind) y trae el texto para moderar.
  // `.in(status, draft|pending_review)`: un aviso dado de baja por moderación
  // ('removed') NO se re-publica llamando finalize de nuevo — eso lo decide
  // un humano en la cola, no este flujo.
  const { data: updated, error: updateError } = await supabase
    .from("listings")
    .update({ photos: photoPaths, status: "pending_review" })
    .eq("id", listingId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    .eq("kind", "job")
    .in("status", ["draft", "pending_review"])
    .select("id, title, description, attrs")
    .maybeSingle();

  if (updateError || !updated) {
    console.warn("[empleos] finalize del aviso falló", {
      listingId,
      code: updateError?.code,
    });
    return { ok: false, error: C.errors.generic };
  }

  // ---- Moderación de texto ANTES de decidir el status (§8). Las PREGUNTAS y
  // sus opciones son texto público del anunciante (se renderizan en el detalle
  // y en la hoja de postulación): entran a la moderación junto con el título —
  // el "mandá $75 por Zelle para reservar la entrevista" clásico vive ahí, no
  // en la descripción.
  const questionsText = parseJobAttrs(updated.attrs)
    .questions.flatMap((question) => [question.label, ...(question.options ?? [])])
    .join("\n");
  const moderation = await moderateText(
    `${updated.title}\n${updated.description ?? ""}\n${questionsText}`,
  );
  const tier = moderation.flagged ? TIER_HUMAN : moderationTier(moderation.score);

  // ---- Foto: publicación instantánea + revisión asíncrona (feedback cliente
  // 2026-07-19, misma política que el FEED y que Creadores). Sin Vision la foto
  // NO retiene el aviso —si lo hiciera, un empleo con foto se "publicaría" y no
  // aparecería nunca— pero entra a la cola humana para revisarse después.
  // El TEXTO sigue siendo lo único que gobierna pending_review.
  const autoApprove = devAutoApprove();
  const photoNeedsAsyncReview = photoPaths.length > 0 && !isVisionConfigured && !autoApprove;

  let status: "published" | "pending_review" =
    moderation.flagged || tier === TIER_HUMAN ? "pending_review" : "published";

  // ---- Nacer published: exclusivo del admin client (la RLS del dueño lo
  // prohíbe). Ownership ya verificado en el UPDATE de arriba.
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
        console.warn("[empleos] no se pudo publicar el aviso, queda en revisión", {
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

  // ---- Cola de moderación (admin, uso permitido §6) — para que el aviso sea
  // resoluble desde /admin/moderacion en vez de quedar huérfano.
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
        subjectKind: "listing",
        subjectId: listingId,
        aiScore: moderation.skipped ? null : moderation.score,
        reasons,
        tier: enqueueTier,
      });
      if (!outcome.ok) {
        console.warn("[empleos] no se pudo encolar moderación del aviso", { listingId });
      }
    } catch {
      console.warn("[empleos] admin client no disponible para encolar moderación");
    }
  }

  return { ok: true, status };
}
