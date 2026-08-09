/**
 * =============================================================================
 * ELEGIBILIDAD DE CREADOR — ESPEJO EN TS DE `app.creator_activation_eligible()`
 * =============================================================================
 *
 * El pliego pide que los umbrales se administren desde un panel. La migración
 * 0064 los sacó del código y los puso en `public.creator_eligibility_config`
 * (una fila por tenant); este módulo es la mitad de la app: traduce esa
 * configuración a algo que un admin pueda decidir y un aspirante pueda entender.
 *
 * -----------------------------------------------------------------------------
 * QUIÉN MANDA
 *
 * La AUTORIDAD sigue siendo la base: `request_creator_activation` (0032) llama a
 * `app.creator_activation_eligible()` y ahí se decide quién pasa. Este módulo
 * NUNCA autoriza nada. Existe para dos cosas que SQL no puede hacer:
 *
 *   1. Explicarle a la persona QUÉ le falta y CUÁNTO ("te faltan 40 seguidores"
 *      en vez de un array con la palabra `seguidores`).
 *   2. Simular. El panel necesita responder "¿a cuántos creadores actuales deja
 *      fuera esta configuración que todavía NO guardé?", y la función de la base
 *      solo sabe evaluar contra la configuración YA guardada.
 *
 * Por eso la función `evaluate()` reproduce el orden y la semántica del SQL al
 * pie de la letra, incluidas las guardas `if umbral > 0`. Si algún día la
 * migración cambia, este archivo y `eligibility.test.ts` son el lugar donde eso
 * se refleja — y el test de orden de códigos es la alarma.
 *
 * -----------------------------------------------------------------------------
 * "NO LO SÉ" NO ES "NO CUMPLE"
 *
 * En el panel hay datos que el admin NO puede leer, y está bien que así sea: la
 * fecha de nacimiento y el apellido viven en `profiles_private`, cuya RLS es
 * SOLO-DUEÑO (0003). Inventar un `false` ahí sería acusar de incumplir a gente
 * que quizá cumple. Esos datos entran como `null` y producen `status:"unknown"`,
 * que se muestra como "no lo podemos estimar" y se cuenta aparte — nunca como
 * un creador que "quedaría fuera". Es el mismo criterio de `unmeasured` que ya
 * usa `components/creators/requirements.ts`.
 *
 * En el camino del aspirante no hay `unknown`: cada quien puede leer todos sus
 * propios datos.
 * =============================================================================
 */

/* -------------------------------------------------------------------------- */
/* Códigos                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Los códigos que devuelve `app.creator_activation_eligible()` en `reasons`,
 * EN EL MISMO ORDEN en que la función los agrega. `perfil_inexistente` va
 * primero porque es el early-return del SQL.
 */
export const ELIGIBILITY_REASONS = [
  "perfil_inexistente",
  "edad_minima",
  "perfil_incompleto",
  "telefono",
  "correo",
  "identidad",
  "user_score",
  "cuenta_activa",
  "restriccion_marketplace",
  "stripe_connect",
  "portafolio",
  "seguidores",
  "videos",
  "vistas",
  "terminos_creador",
] as const;

export type EligibilityReason = (typeof ELIGIBILITY_REASONS)[number];

/* -------------------------------------------------------------------------- */
/* La configuración                                                           */
/* -------------------------------------------------------------------------- */

export interface EligibilityConfig {
  minAge: number;
  requireProfileComplete: boolean;
  requirePhoneVerified: boolean;
  requireEmailVerified: boolean;
  minUserScore: number;
  requireIdentityVerified: boolean;
  requireStripeConnect: boolean;
  minFollowers: number;
  minVideos: number;
  minViews: number;
  minPortfolioItems: number;
  requireNoActiveSuspension: boolean;
  requireCreatorTerms: boolean;
}

/**
 * Los mismos defaults que devuelve `app.creator_eligibility_config()` cuando el
 * tenant no tiene fila. Copiados a mano y verificados contra la migración: si se
 * separan, el panel le miente al admin sobre lo que está vigente hoy.
 *
 * Las tres banderas en `false` NO son un olvido —ver el docblock de
 * `THRESHOLD_FIELDS`—: son una decisión de producto que ahora se toma desde el
 * panel y no desde una migración.
 */
export const DEFAULT_ELIGIBILITY_CONFIG: EligibilityConfig = {
  minAge: 18,
  requireProfileComplete: false,
  requirePhoneVerified: true,
  requireEmailVerified: true,
  minUserScore: 50,
  requireIdentityVerified: true,
  requireStripeConnect: false,
  minFollowers: 0,
  minVideos: 0,
  minViews: 0,
  minPortfolioItems: 3,
  requireNoActiveSuspension: true,
  requireCreatorTerms: false,
};

/** Forma de la fila tal como la devuelve PostgREST (snake_case). */
export interface EligibilityConfigRow {
  min_age: number;
  require_profile_complete: boolean;
  require_phone_verified: boolean;
  require_email_verified: boolean;
  min_user_score: number;
  require_identity_verified: boolean;
  require_stripe_connect: boolean;
  min_followers: number;
  min_videos: number;
  min_views: number;
  min_portfolio_items: number;
  require_no_active_suspension: boolean;
  require_creator_terms: boolean;
}

/**
 * Fila → configuración. `null` (tenant sin fila) devuelve los defaults, que es
 * exactamente lo que evalúa la base: "no hay fila" y "hay fila" no pueden ser
 * dos caminos distintos, ni en SQL ni acá.
 */
export function configFromRow(row: Partial<EligibilityConfigRow> | null | undefined): EligibilityConfig {
  if (!row) return { ...DEFAULT_ELIGIBILITY_CONFIG };
  const d = DEFAULT_ELIGIBILITY_CONFIG;
  const num = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const bool = (value: unknown, fallback: boolean): boolean =>
    typeof value === "boolean" ? value : fallback;

  return {
    minAge: num(row.min_age, d.minAge),
    requireProfileComplete: bool(row.require_profile_complete, d.requireProfileComplete),
    requirePhoneVerified: bool(row.require_phone_verified, d.requirePhoneVerified),
    requireEmailVerified: bool(row.require_email_verified, d.requireEmailVerified),
    minUserScore: num(row.min_user_score, d.minUserScore),
    requireIdentityVerified: bool(row.require_identity_verified, d.requireIdentityVerified),
    requireStripeConnect: bool(row.require_stripe_connect, d.requireStripeConnect),
    minFollowers: num(row.min_followers, d.minFollowers),
    minVideos: num(row.min_videos, d.minVideos),
    minViews: num(row.min_views, d.minViews),
    minPortfolioItems: num(row.min_portfolio_items, d.minPortfolioItems),
    requireNoActiveSuspension: bool(row.require_no_active_suspension, d.requireNoActiveSuspension),
    requireCreatorTerms: bool(row.require_creator_terms, d.requireCreatorTerms),
  };
}

/** Configuración → fila, para el `upsert` del panel. */
export function configToRow(config: EligibilityConfig): EligibilityConfigRow {
  return {
    min_age: config.minAge,
    require_profile_complete: config.requireProfileComplete,
    require_phone_verified: config.requirePhoneVerified,
    require_email_verified: config.requireEmailVerified,
    min_user_score: config.minUserScore,
    require_identity_verified: config.requireIdentityVerified,
    require_stripe_connect: config.requireStripeConnect,
    min_followers: config.minFollowers,
    min_videos: config.minVideos,
    min_views: config.minViews,
    min_portfolio_items: config.minPortfolioItems,
    require_no_active_suspension: config.requireNoActiveSuspension,
    require_creator_terms: config.requireCreatorTerms,
  };
}

/* -------------------------------------------------------------------------- */
/* Metadatos de cada umbral (los que hacen que el panel se explique solo)      */
/* -------------------------------------------------------------------------- */

export type ThresholdGroup = "identidad" | "conducta" | "trabajo" | "contrato";

export interface ThresholdField {
  key: keyof EligibilityConfig;
  /** Columna en `creator_eligibility_config` — también el `name` del form. */
  column: keyof EligibilityConfigRow;
  /** Qué código de `reasons` produce este umbral cuando no se cumple. */
  reason: EligibilityReason;
  group: ThresholdGroup;
  kind: "number" | "toggle";
  /** Etiqueta del panel. */
  label: string;
  /**
   * QUÉ EFECTO TIENE, dicho en consecuencias y no en nombres de campo. Es la
   * diferencia entre un admin que sabe qué está moviendo y uno que adivina.
   */
  effect: string;
  /** Nota extra cuando hay una razón operativa para no tocarlo hoy. */
  warning?: string;
  min?: number;
  max?: number;
  /** Sufijo para el input numérico ("años", "puntos", …). */
  unit?: string;
}

export const THRESHOLD_GROUPS: ReadonlyArray<{ key: ThresholdGroup; title: string; intro: string }> = [
  {
    key: "identidad",
    title: "Quién es la persona",
    intro: "Lo que hay que saber de alguien antes de dejarlo cobrar en tu comunidad.",
  },
  {
    key: "conducta",
    title: "Cómo se comportó hasta ahora",
    intro: "Reputación y sanciones vigentes.",
  },
  {
    key: "trabajo",
    title: "Qué trabajo puede mostrar",
    intro: "Los números que prueban que hay un creador atrás y no una cuenta vacía.",
  },
  {
    key: "contrato",
    title: "Cobros y términos",
    intro: "Lo que hace falta para que un contrato se pueda firmar y pagar.",
  },
];

/**
 * TRES BANDERAS APAGADAS A PROPÓSITO (`require_profile_complete`,
 * `require_stripe_connect`, `require_creator_terms`). No son un bug ni una
 * omisión: prenderlas hoy dejaría inelegibles de golpe a los creadores que ya
 * están aprobados. Cada una lleva su `warning` para que quien las prenda sepa
 * exactamente qué está aceptando — y el panel además le muestra a cuántos deja
 * fuera antes de guardar.
 */
export const THRESHOLD_FIELDS: readonly ThresholdField[] = [
  {
    key: "minAge",
    column: "min_age",
    reason: "edad_minima",
    group: "identidad",
    kind: "number",
    label: "Edad mínima",
    effect:
      "Nadie por debajo de esta edad puede activarse como creador. Se mide contra la fecha de nacimiento cargada; quien confirmó ser mayor sin cargarla, pasa igual.",
    min: 13,
    max: 99,
    unit: "años",
  },
  {
    key: "requirePhoneVerified",
    column: "require_phone_verified",
    reason: "telefono",
    group: "identidad",
    kind: "toggle",
    label: "Teléfono verificado",
    effect: "Si lo exigís, quien no confirmó su teléfono con el código SMS no puede activarse.",
  },
  {
    key: "requireEmailVerified",
    column: "require_email_verified",
    reason: "correo",
    group: "identidad",
    kind: "toggle",
    label: "Correo verificado",
    effect: "Si lo exigís, quien nunca abrió el correo de confirmación no puede activarse.",
  },
  {
    key: "requireIdentityVerified",
    column: "require_identity_verified",
    reason: "identidad",
    group: "identidad",
    kind: "toggle",
    label: "Identidad verificada",
    effect:
      "Si lo exigís, hay que haber pasado por la verificación de identidad. Es el requisito más caro de cumplir y el que más frena a gente nueva.",
  },
  {
    key: "requireProfileComplete",
    column: "require_profile_complete",
    reason: "perfil_incompleto",
    group: "identidad",
    kind: "toggle",
    label: "Perfil completo",
    effect:
      "Exige nombre, apellido, usuario, foto, bio y país de origen. Sirve para que el negocio que contrata vea una persona y no un casillero vacío.",
    warning:
      "Apellido y usuario existen desde hace poco: al prenderlo, todo el que se registró antes y no los completó queda fuera hasta que vuelva a su perfil.",
  },
  {
    key: "minUserScore",
    column: "min_user_score",
    reason: "user_score",
    group: "conducta",
    kind: "number",
    label: "User Score mínimo",
    effect:
      "Puntaje de confianza de 0 a 100. Subirlo deja afuera a las cuentas nuevas, que arrancan bajo por no tener historial todavía. En 0 el requisito no se evalúa.",
    min: 0,
    max: 100,
    unit: "puntos",
  },
  {
    key: "requireNoActiveSuspension",
    column: "require_no_active_suspension",
    reason: "cuenta_activa",
    group: "conducta",
    kind: "toggle",
    label: "Sin suspensiones vigentes",
    effect:
      "Si lo exigís, no puede activarse quien tenga la cuenta suspendida o una restricción de marketplace sin levantar.",
    warning: "Apagarlo deja que una cuenta sancionada vuelva a cobrar. Casi nunca es lo que querés.",
  },
  {
    key: "minPortfolioItems",
    column: "min_portfolio_items",
    reason: "portafolio",
    group: "trabajo",
    kind: "number",
    label: "Ejemplos en el portafolio",
    effect:
      "Cuántas piezas tiene que haber cargado antes de poder recibir trabajos. En 0 el requisito no se evalúa.",
    min: 0,
    max: 100,
    unit: "ejemplos",
  },
  {
    key: "minFollowers",
    column: "min_followers",
    reason: "seguidores",
    group: "trabajo",
    kind: "number",
    label: "Seguidores mínimos",
    effect:
      "Seguidores DENTRO de tu comunidad, no en redes externas. Subirlo de 100 a 500 no filtra por calidad: filtra por antigüedad, porque nadie junta 500 seguidores en su primera semana. En 0 el requisito no se evalúa.",
    min: 0,
    max: 1_000_000,
    unit: "seguidores",
  },
  {
    key: "minVideos",
    column: "min_videos",
    reason: "videos",
    group: "trabajo",
    kind: "number",
    label: "Videos publicados",
    effect:
      "Videos propios publicados y visibles. No cuentan los borradores ni los que moderación bajó. En 0 el requisito no se evalúa.",
    min: 0,
    max: 10_000,
    unit: "videos",
  },
  {
    key: "minViews",
    column: "min_views",
    reason: "vistas",
    group: "trabajo",
    kind: "number",
    label: "Vistas acumuladas",
    effect:
      "Suma de vistas de todo lo que publicó. Es el umbral que más rápido se vuelve inalcanzable: en una comunidad chica, pedir 50.000 vistas puede significar que no califique nadie. En 0 el requisito no se evalúa.",
    min: 0,
    max: 100_000_000,
    unit: "vistas",
  },
  {
    key: "requireStripeConnect",
    column: "require_stripe_connect",
    reason: "stripe_connect",
    group: "contrato",
    kind: "toggle",
    label: "Cuenta de cobros activa",
    effect: "Exige tener Stripe Connect habilitado para cobrar y recibir pagos.",
    warning:
      "Los pagos todavía están en modo demostración en esta instalación. Mientras sigan así, prender esto deja a TODO el mundo fuera.",
  },
  {
    key: "requireCreatorTerms",
    column: "require_creator_terms",
    reason: "terminos_creador",
    group: "contrato",
    kind: "toggle",
    label: "Términos de creador aceptados",
    effect:
      "Exige haber leído y aceptado los términos específicos de creador, que son distintos de los términos generales de la plataforma.",
    warning:
      "Los creadores ya aprobados no los aceptaron nunca: al prenderlo, cada uno tiene que pasar una vez por la pantalla de términos.",
  },
];

/* -------------------------------------------------------------------------- */
/* Los hechos de una persona                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Lo que sabemos de alguien. `null` significa SIEMPRE "no lo pudimos leer"
 * (dato privado, o la consulta falló) — nunca "vale cero". Ver la cabecera.
 */
export interface EligibilitySubject {
  /** false ⇒ el perfil no existe: early-return igual que el SQL. */
  exists: boolean;
  /** `profiles.age_confirmed_at is not null`: alcanza para cualquier edad mínima. */
  ageConfirmed: boolean;
  /** Edad en años cumplidos, o null si la fecha de nacimiento no es legible. */
  ageYears: number | null;
  /** Los 5 campos públicos del perfil completo (nombre, usuario, foto, bio, país). */
  profileCompletePublic: boolean | null;
  /** `profiles_private.last_name` — null desde el panel: RLS solo-dueño. */
  hasLastName: boolean | null;
  phoneVerified: boolean | null;
  emailVerified: boolean | null;
  identityVerified: boolean | null;
  userScore: number | null;
  accountActive: boolean | null;
  marketplaceRestricted: boolean | null;
  stripeConnectReady: boolean | null;
  portfolioItems: number | null;
  followers: number | null;
  videos: number | null;
  views: number | null;
  /** ¿Aceptó los términos de creador alguna vez? null = no se pudo leer. */
  creatorTermsAccepted: boolean | null;
}

export type CheckStatus = "met" | "missing" | "unknown";

export interface EligibilityCheck {
  reason: EligibilityReason;
  key: keyof EligibilityConfig;
  status: CheckStatus;
  /** Valor actual de la persona, cuando el umbral es numérico y se pudo medir. */
  current: number | null;
  /** El corte configurado, cuando es numérico. */
  target: number | null;
  /** Cuánto falta para llegar. 0 si ya está o si no aplica. */
  remaining: number;
}

export interface EligibilityResult {
  /** SOLO los requisitos vigentes con esta configuración. Los apagados no están. */
  checks: EligibilityCheck[];
  /** Los códigos incumplidos, en el mismo orden que devuelve el SQL. */
  reasons: EligibilityReason[];
  /** Los que no se pudieron medir. Nunca cuentan como incumplidos. */
  unknown: EligibilityReason[];
  /** Cumple TODO lo vigente y no quedó nada sin medir. */
  eligible: boolean;
}

function check(
  reason: EligibilityReason,
  key: keyof EligibilityConfig,
  status: CheckStatus,
  current: number | null = null,
  target: number | null = null,
): EligibilityCheck {
  const remaining =
    status === "missing" && current !== null && target !== null ? Math.max(0, target - current) : 0;
  return { reason, key, status, current, target, remaining };
}

/** `null` (no medido) → "unknown"; si no, cumple o no. */
function fromFlag(
  reason: EligibilityReason,
  key: keyof EligibilityConfig,
  value: boolean | null,
): EligibilityCheck {
  if (value === null) return check(reason, key, "unknown");
  return check(reason, key, value ? "met" : "missing");
}

/** Umbral numérico: `null` (no medido) → "unknown". */
function fromCount(
  reason: EligibilityReason,
  key: keyof EligibilityConfig,
  current: number | null,
  target: number,
): EligibilityCheck {
  if (current === null) return check(reason, key, "unknown", null, target);
  return check(reason, key, current >= target ? "met" : "missing", current, target);
}

/**
 * Evalúa a una persona contra una configuración.
 *
 * Reproduce `app.creator_activation_eligible()` paso a paso, INCLUIDO el orden
 * en que la función agrega los códigos y las guardas `if umbral > 0` (un umbral
 * en 0 no es "cumple": es un requisito que ni siquiera se evalúa, y por eso no
 * aparece en `checks`).
 */
export function evaluateEligibility(
  config: EligibilityConfig,
  subject: EligibilitySubject,
): EligibilityResult {
  if (!subject.exists) {
    return {
      checks: [check("perfil_inexistente", "minAge", "missing")],
      reasons: ["perfil_inexistente"],
      unknown: [],
      eligible: false,
    };
  }

  const checks: EligibilityCheck[] = [];

  // --- Edad. `age_confirmed_at` alcanza para cualquier mínimo (así lo hace el
  //     SQL: la confirmación es una rama OR, no una comparación).
  if (subject.ageConfirmed) {
    checks.push(check("edad_minima", "minAge", "met", null, config.minAge));
  } else {
    checks.push(fromCount("edad_minima", "minAge", subject.ageYears, config.minAge));
  }

  // --- Perfil completo: los 5 campos públicos Y el apellido (privado).
  if (config.requireProfileComplete) {
    const publicPart = subject.profileCompletePublic;
    const lastName = subject.hasLastName;
    if (publicPart === false || lastName === false) {
      // Con que falte UNO ya está incompleto: no hace falta poder ver el resto.
      checks.push(check("perfil_incompleto", "requireProfileComplete", "missing"));
    } else if (publicPart === null || lastName === null) {
      checks.push(check("perfil_incompleto", "requireProfileComplete", "unknown"));
    } else {
      checks.push(check("perfil_incompleto", "requireProfileComplete", "met"));
    }
  }

  if (config.requirePhoneVerified) {
    checks.push(fromFlag("telefono", "requirePhoneVerified", subject.phoneVerified));
  }
  if (config.requireEmailVerified) {
    checks.push(fromFlag("correo", "requireEmailVerified", subject.emailVerified));
  }
  if (config.requireIdentityVerified) {
    checks.push(fromFlag("identidad", "requireIdentityVerified", subject.identityVerified));
  }

  if (config.minUserScore > 0) {
    checks.push(fromCount("user_score", "minUserScore", subject.userScore, config.minUserScore));
  }

  // --- Suspensiones. El SQL es un if/elsif: si la cuenta no está activa NO
  //     evalúa restricciones, así que nunca salen los dos códigos juntos.
  if (config.requireNoActiveSuspension) {
    if (subject.accountActive === null) {
      checks.push(check("cuenta_activa", "requireNoActiveSuspension", "unknown"));
    } else if (!subject.accountActive) {
      checks.push(check("cuenta_activa", "requireNoActiveSuspension", "missing"));
    } else {
      checks.push(
        fromFlag(
          "restriccion_marketplace",
          "requireNoActiveSuspension",
          subject.marketplaceRestricted === null ? null : !subject.marketplaceRestricted,
        ),
      );
    }
  }

  if (config.requireStripeConnect) {
    checks.push(fromFlag("stripe_connect", "requireStripeConnect", subject.stripeConnectReady));
  }

  if (config.minPortfolioItems > 0) {
    checks.push(
      fromCount("portafolio", "minPortfolioItems", subject.portfolioItems, config.minPortfolioItems),
    );
  }
  if (config.minFollowers > 0) {
    checks.push(fromCount("seguidores", "minFollowers", subject.followers, config.minFollowers));
  }
  if (config.minVideos > 0) {
    checks.push(fromCount("videos", "minVideos", subject.videos, config.minVideos));
  }
  if (config.minViews > 0) {
    checks.push(fromCount("vistas", "minViews", subject.views, config.minViews));
  }

  if (config.requireCreatorTerms) {
    checks.push(
      fromFlag("terminos_creador", "requireCreatorTerms", subject.creatorTermsAccepted),
    );
  }

  const reasons = checks.filter((c) => c.status === "missing").map((c) => c.reason);
  const unknown = checks.filter((c) => c.status === "unknown").map((c) => c.reason);

  return { checks, reasons, unknown, eligible: reasons.length === 0 && unknown.length === 0 };
}

/* -------------------------------------------------------------------------- */
/* Impacto de un cambio de umbrales                                           */
/* -------------------------------------------------------------------------- */

export interface EligibilityImpact {
  total: number;
  /** Cumplen todo lo vigente. */
  eligible: number;
  /** Quedarían fuera: les falta al menos un requisito medible. */
  excluded: number;
  /** No se puede afirmar nada: falta al menos un dato que el panel no puede leer. */
  undetermined: number;
  /** Cuántos quedan fuera POR CADA código — así se ve qué umbral es el que corta. */
  byReason: Partial<Record<EligibilityReason, number>>;
}

/**
 * Cuenta cuánta gente quedaría de cada lado con una configuración dada.
 *
 * Así se calcula el "impacto" del panel: se evalúa a CADA creador actual contra
 * la configuración que está a punto de guardarse y se cuentan los resultados.
 * No es una estimación estadística ni una muestra — es la misma cuenta que hará
 * la base, sobre las mismas personas.
 */
export function computeEligibilityImpact(
  config: EligibilityConfig,
  subjects: readonly EligibilitySubject[],
): EligibilityImpact {
  const byReason: Partial<Record<EligibilityReason, number>> = {};
  let eligible = 0;
  let excluded = 0;
  let undetermined = 0;

  for (const subject of subjects) {
    const result = evaluateEligibility(config, subject);
    for (const reason of result.reasons) {
      byReason[reason] = (byReason[reason] ?? 0) + 1;
    }
    if (result.reasons.length > 0) excluded += 1;
    else if (result.unknown.length > 0) undetermined += 1;
    else eligible += 1;
  }

  return { total: subjects.length, eligible, excluded, undetermined, byReason };
}
