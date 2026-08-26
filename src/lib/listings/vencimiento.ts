/**
 * =============================================================================
 * VENCIMIENTO DE PUBLICACIONES — lógica pura (migración 0098)
 * =============================================================================
 *
 * Todo lo de acá es PURO: sin React, sin Supabase, sin `server-only`. Lo
 * importan por igual la pantalla de "Mis publicaciones" (servidor), el botón de
 * renovar (cliente) y los tests, que corren sin base.
 *
 * ESTE ARCHIVO ES UN ESPEJO, NO UNA FUENTE DE VERDAD. Las reglas viven en la
 * base — `app.listing_expiry_dates()`, `app.vencer_publicaciones()` y sobre todo
 * `public.renovar_publicacion()`, que es la que autoriza de verdad. Acá se
 * reimplementan con dos objetivos concretos:
 *
 *   1. Que la UI pueda decir "vence en 3 días" y mostrar u ocultar el botón sin
 *      un round-trip por publicación.
 *   2. Que los motivos de rechazo tengan los MISMOS nombres de los dos lados
 *      (`todavia_no`, `tope_alcanzado`, `no_vence`…), así la pantalla traduce un
 *      motivo y no adivina un error genérico.
 *
 * Si alguna regla cambia, cambia primero en la migración y después acá. Que la
 * app diga "ya podés renovar" y la base conteste `todavia_no` es un bug de
 * confianza: la persona aprieta un botón que existe y no pasa nada.
 */

/** Los 8 `kind` del CHECK `listings_kind_check` (0004 → 0024 → 0096). */
export const LISTING_KINDS = [
  "property",
  "business",
  "professional",
  "event",
  "job",
  "product",
  "creator_gig",
  "lost_found",
] as const;

export type ListingKind = (typeof LISTING_KINDS)[number];

/**
 * Los defaults de `app.listing_expiry_config()`, letra por letra.
 *
 * `business` y `professional` NO vencen: no son avisos, son presencia (tienen
 * horarios, reseñas y, muchas veces, una suscripción paga). El razonamiento
 * largo está en la cabecera de 0098.
 */
export const DEFAULT_EXPIRY_CONFIG: ExpiryConfig = {
  diasDeVigencia: 30,
  diasDeAviso: 3,
  renovacionesMaximas: null,
  kindsQueVencen: ["property", "event", "job", "product", "creator_gig", "lost_found"],
};

export type ExpiryConfig = {
  /** Cuántos días dura una publicación desde que se publica o se renueva. */
  diasDeVigencia: number;
  /** Con cuánta anticipación se avisa (y desde cuándo se puede renovar). */
  diasDeAviso: number;
  /** `null` = sin tope. */
  renovacionesMaximas: number | null;
  /** Qué categorías caducan en esta comunidad. */
  kindsQueVencen: readonly string[];
};

/** Forma cruda de `public.listing_expiry_config` tal como vuelve de PostgREST. */
export type ExpiryConfigRow = {
  dias_de_vigencia?: unknown;
  dias_de_aviso?: unknown;
  renovaciones_maximas?: unknown;
  kinds_que_vencen?: unknown;
};

function entero(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

/**
 * Fila → configuración. TOLERANTE A PROPÓSITO: si la comunidad no tiene fila
 * (que es el caso normal — la ausencia significa los defaults) o si una columna
 * viene rara, se cae a `DEFAULT_EXPIRY_CONFIG`.
 *
 * Nunca lanza. Una pantalla que no puede leer la configuración tiene que mostrar
 * "vence en 30 días" y seguir andando; romperse ahí dejaría a la persona sin ver
 * sus publicaciones por un problema que no es suyo.
 */
export function parseExpiryConfig(raw: ExpiryConfigRow | null | undefined): ExpiryConfig {
  if (!raw || typeof raw !== "object") return DEFAULT_EXPIRY_CONFIG;

  const kinds = Array.isArray(raw.kinds_que_vencen)
    ? raw.kinds_que_vencen.filter(
        (kind): kind is string =>
          typeof kind === "string" && (LISTING_KINDS as readonly string[]).includes(kind),
      )
    : null;

  const vigencia = entero(raw.dias_de_vigencia, DEFAULT_EXPIRY_CONFIG.diasDeVigencia);
  const aviso = entero(raw.dias_de_aviso, DEFAULT_EXPIRY_CONFIG.diasDeAviso);

  return {
    diasDeVigencia: vigencia,
    // El CHECK de la base exige aviso < vigencia. Si igual llegara algo
    // incoherente, se prefiere el default antes que una ventana de aviso que
    // empieza antes de publicar (y que haría "renovable" todo desde el día 1).
    diasDeAviso: aviso < vigencia ? aviso : DEFAULT_EXPIRY_CONFIG.diasDeAviso,
    renovacionesMaximas:
      typeof raw.renovaciones_maximas === "number" && raw.renovaciones_maximas >= 0
        ? Math.floor(raw.renovaciones_maximas)
        : null,
    kindsQueVencen: kinds ?? DEFAULT_EXPIRY_CONFIG.kindsQueVencen,
  };
}

/** ¿Esta categoría caduca en esta comunidad? */
export function kindVence(kind: string, config: ExpiryConfig): boolean {
  return config.kindsQueVencen.includes(kind);
}

const DIA_MS = 86_400_000;

/**
 * Las dos fechas del ciclo, espejo de `app.listing_expiry_dates()`.
 * Devuelve `null, null` cuando el kind no vence — igual que la función SQL.
 */
export function calcularVencimiento(
  desde: Date,
  kind: string,
  config: ExpiryConfig,
): { expiresAt: Date | null; warnAt: Date | null } {
  if (!kindVence(kind, config)) return { expiresAt: null, warnAt: null };

  const expiresAt = new Date(desde.getTime() + config.diasDeVigencia * DIA_MS);
  const warnAt = new Date(expiresAt.getTime() - config.diasDeAviso * DIA_MS);
  return { expiresAt, warnAt };
}

/**
 * Días que faltan, redondeando PARA ARRIBA y sin bajar de 0.
 *
 * Hacia arriba porque el redondeo tiene que favorecer a quien lee: faltando 30
 * horas, "vence en 2 días" es cierto y "vence en 1 día" apura de más. Y nunca
 * negativo: si ya pasó, la respuesta correcta es 0, no "-3".
 */
export function diasHasta(fecha: Date, ahora: Date): number {
  const ms = fecha.getTime() - ahora.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / DIA_MS);
}

/** Lo mínimo que hay que saber de una publicación para hablar de su vencimiento. */
export type PublicacionVencible = {
  status: string;
  kind: string;
  /** `listings.expires_at` en ISO, o null. */
  expiresAt: string | null;
  /** `listings.expiry_warn_at` en ISO, o null. */
  warnAt: string | null;
  /** `listings.renewal_count`. */
  renewalCount: number;
};

export type EstadoVencimiento =
  /** No caduca: la categoría está fuera de `kindsQueVencen`, o no está publicada. */
  | { estado: "no_vence" }
  /** Publicada y con tiempo de sobra. */
  | { estado: "vigente"; diasRestantes: number; expiresAt: Date }
  /** Publicada y dentro de la ventana de aviso: acá aparece el botón. */
  | { estado: "por_vencer"; diasRestantes: number; expiresAt: Date }
  /** Ya venció: dejó de mostrarse, pero NO se borró nada. */
  | { estado: "vencida" };

function fecha(iso: string | null): Date | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * En qué punto del ciclo está una publicación.
 *
 * `por_vencer` se decide por `warnAt` y no por "faltan menos de N días": la
 * fecha de aviso quedó CONGELADA en la fila al publicar (ver la Decisión 4 de
 * 0098), así que cambiar la configuración de la comunidad no puede mover hacia
 * atrás el momento en que alguien ya vio el botón.
 */
export function estadoDeVencimiento(
  publicacion: PublicacionVencible,
  config: ExpiryConfig,
  ahora: Date = new Date(),
): EstadoVencimiento {
  if (publicacion.status === "expired") return { estado: "vencida" };
  if (publicacion.status !== "published") return { estado: "no_vence" };

  const expiresAt = fecha(publicacion.expiresAt);
  if (!expiresAt || !kindVence(publicacion.kind, config)) return { estado: "no_vence" };

  const warnAt = fecha(publicacion.warnAt);
  const diasRestantes = diasHasta(expiresAt, ahora);

  // Sin `warnAt` (fila vieja, dato incompleto) se cae al cálculo por días: es
  // preferible mostrar el botón un poco antes que no mostrarlo nunca.
  const enVentana = warnAt
    ? warnAt.getTime() <= ahora.getTime()
    : diasRestantes <= config.diasDeAviso;

  return enVentana
    ? { estado: "por_vencer", diasRestantes, expiresAt }
    : { estado: "vigente", diasRestantes, expiresAt };
}

/**
 * Motivos por los que no se puede renovar. Los mismos literales que devuelve
 * `public.renovar_publicacion()` en su jsonb — es lo que permite traducir el
 * rechazo del servidor con el mismo diccionario que el cálculo local.
 *
 * Los cinco primeros viven en la 0098. El sexto —`necesita_confirmar_disponibilidad`—
 * lo agregó la 0117 (reconfirmación de disponibilidad pasados 60 días) y vive
 * en ESA migración, no en 0098: `vencimiento.test.ts` busca cada motivo en su
 * archivo correcto y no en "alguna de las dos".
 */
export const MOTIVOS_NO_RENOVABLE = [
  "no_encontrada",
  "estado_invalido",
  "no_vence",
  "tope_alcanzado",
  "todavia_no",
  "necesita_confirmar_disponibilidad",
] as const;

export type MotivoNoRenovable = (typeof MOTIVOS_NO_RENOVABLE)[number];

export function isMotivoNoRenovable(value: unknown): value is MotivoNoRenovable {
  return (
    typeof value === "string" &&
    (MOTIVOS_NO_RENOVABLE as readonly string[]).includes(value)
  );
}

export type ResultadoRenovable =
  | { ok: true }
  | { ok: false; motivo: MotivoNoRenovable };

/**
 * ¿Se puede renovar ahora? Espejo exacto de las guardas de
 * `public.renovar_publicacion()`, EN EL MISMO ORDEN.
 *
 * El orden importa: si una publicación vencida además llegó al tope, el motivo
 * que la persona tiene que leer es el tope, no "está vencida". Invertirlos haría
 * que la pantalla explique una cosa y la base rechace por otra.
 *
 * OJO: esto NO es autorización. La propiedad y el tenant los verifica la función
 * de la base, que es `security definer` y no confía en el cliente. Acá sólo se
 * decide si dibujar el botón.
 */
export function puedeRenovar(
  publicacion: PublicacionVencible,
  config: ExpiryConfig,
  ahora: Date = new Date(),
): ResultadoRenovable {
  if (publicacion.status !== "published" && publicacion.status !== "expired") {
    return { ok: false, motivo: "estado_invalido" };
  }
  if (!kindVence(publicacion.kind, config)) {
    return { ok: false, motivo: "no_vence" };
  }
  if (
    config.renovacionesMaximas !== null &&
    publicacion.renewalCount >= config.renovacionesMaximas
  ) {
    return { ok: false, motivo: "tope_alcanzado" };
  }
  // Vencida: siempre se puede recuperar. Es la promesa central del modelo —
  // vencer no borra nada y siempre hay vuelta atrás.
  if (publicacion.status === "expired") return { ok: true };

  const estado = estadoDeVencimiento(publicacion, config, ahora);
  if (estado.estado !== "por_vencer") {
    return { ok: false, motivo: "todavia_no" };
  }
  return { ok: true };
}

/**
 * =============================================================================
 * CIERRE — "ya no está disponible" (migración 0117)
 * =============================================================================
 *
 * `puedeRenovar()` NO calcula `necesita_confirmar_disponibilidad` a propósito:
 * esa guarda depende de `published_at` + si ya pasaron 60 días, y la pantalla
 * de "Mis publicaciones" sigue mostrando el botón "Renovar" igual — es la base
 * la que, al apretarlo, puede pedir la confirmación. Acortar el botón de
 * entrada sería esconder la única guarda que la persona puede levantar sin
 * salir de la pantalla (ver la cabecera de la 0117).
 */

/**
 * Motivo de cierre. Un aviso `closed` declara siempre por qué en
 * `attrs.closed_reason` — no hay CHECK en la base para esta clave (jsonb
 * libre, doctrina 0107), así que este array es el contrato que la app respeta.
 */
export const CLOSED_REASONS = ["rented", "filled", "sold", "done"] as const;

export type ClosedReason = (typeof CLOSED_REASONS)[number];

export function isClosedReason(value: unknown): value is ClosedReason {
  return typeof value === "string" && (CLOSED_REASONS as readonly string[]).includes(value);
}

/**
 * Qué motivo corresponde por default a cada `kind` al cerrar desde la UI. La
 * migración deja los cuatro motivos abiertos a propósito y es la app la que
 * decide cuál usar; `done` es el genérico — mismo criterio que 0117: cuatro
 * motivos que la gente entiende, en vez de una taxonomía por vertical que
 * nadie mantiene.
 */
export function closedReasonForKind(kind: string): ClosedReason {
  if (kind === "property") return "rented";
  if (kind === "job") return "filled";
  if (kind === "product") return "sold";
  return "done";
}
