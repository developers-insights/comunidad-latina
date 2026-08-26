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
  /**
   * `listings.availability_confirmed_at` en ISO (0116). Sólo lo usan las
   * PROPIEDADES; opcional porque las demás pantallas que arman este objeto
   * (empleos, marketplace) no tienen por qué leer una columna que no las toca.
   */
  availabilityConfirmedAt?: string | null;
  /** `listings.published_at` — respaldo de la fecha de confirmación. */
  publishedAt?: string | null;
  /** `listings.created_at` — último respaldo, igual que el coalesce del SQL. */
  createdAt?: string | null;
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
 */
export const MOTIVOS_NO_RENOVABLE = [
  "no_encontrada",
  "estado_invalido",
  "no_vence",
  "tope_alcanzado",
  "todavia_no",
  /**
   * 0116 · spec §4: «deben confirmar nuevamente su disponibilidad después de 60
   * días». Es el ÚNICO motivo de esta lista que se arregla en un toque y sin
   * publicar nada de nuevo, así que la pantalla no le ofrece "Renovar" sino
   * "Sigue disponible" — y renovar queda habilitado inmediatamente después.
   */
  "confirma_disponibilidad",
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
  // 0116 — MISMO ORDEN QUE LA FUNCIÓN DE LA BASE: después del tope (quien llegó
  // al tope no tiene nada que confirmar) y antes de "todavía no" (a quien
  // todavía no le toca renovar tampoco se le pide confirmar hoy).
  if (necesitaConfirmarDisponibilidad(publicacion, ahora)) {
    return { ok: false, motivo: "confirma_disponibilidad" };
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


// ---------------------------------------------------------------------------
// Confirmación de disponibilidad (0116) — spec §4
// ---------------------------------------------------------------------------

/**
 * Cada cuánto hay que volver a decir «sigue disponible». Espeja el
 * `interval '60 days'` de `public.renovar_publicacion()`. Está escrito dos veces
 * —acá y en el SQL— por el mismo motivo que el resto de los espejos de este
 * módulo: la pantalla tiene que poder anticipar el rechazo de la base sin
 * preguntarle. Manda el SQL.
 */
export const DIAS_PARA_RECONFIRMAR = 60;

/**
 * ¿Esta propiedad debe una confirmación?
 *
 * Sólo aplica a `property`: un empleo o un producto no tienen «disponibilidad»
 * que confirmar, y pedírsela sería inventarle un trámite a quien publicó otra
 * cosa.
 *
 * `null` en `availabilityConfirmedAt` NO significa «hace infinito»: significa
 * un aviso anterior a la 0116 (la migración los sembró con su `published_at`,
 * pero una fila leída de un caché viejo puede llegar sin el dato). Se cae a
 * `publishedAt` y, sin eso, a `createdAt` — exactamente el mismo `coalesce` que
 * hace la función de la base.
 */
export function necesitaConfirmarDisponibilidad(
  publicacion: PublicacionVencible,
  ahora: Date = new Date(),
): boolean {
  if (publicacion.kind !== "property") return false;
  const referencia =
    publicacion.availabilityConfirmedAt ??
    publicacion.publishedAt ??
    publicacion.createdAt ??
    null;
  if (!referencia) return false;
  const desde = Date.parse(referencia);
  if (!Number.isFinite(desde)) return false;
  return ahora.getTime() - desde > DIAS_PARA_RECONFIRMAR * 86_400_000;
}

/**
 * Cuántos días faltan para deber la confirmación. Negativo = ya la debe.
 * `null` = no aplica (no es una propiedad, o no hay fecha de referencia).
 */
export function diasHastaReconfirmar(
  publicacion: PublicacionVencible,
  ahora: Date = new Date(),
): number | null {
  if (publicacion.kind !== "property") return null;
  const referencia =
    publicacion.availabilityConfirmedAt ??
    publicacion.publishedAt ??
    publicacion.createdAt ??
    null;
  if (!referencia) return null;
  const desde = Date.parse(referencia);
  if (!Number.isFinite(desde)) return null;
  const vence = desde + DIAS_PARA_RECONFIRMAR * 86_400_000;
  return Math.ceil((vence - ahora.getTime()) / 86_400_000);
}
