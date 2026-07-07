import "server-only";

/**
 * Rate limiter in-memory con sliding window (§9 seguridad app-layer).
 *
 * Diseño:
 * - Map<key, timestamps[]> — cada entrada guarda los instantes de los últimos
 *   intentos dentro de la ventana. Sliding window real (no fixed buckets):
 *   5/hora significa "5 en los últimos 60 minutos", sin resets bruscos.
 * - Las keys pueden contener IP (registro anónimo): viven SOLO en esta
 *   estructura en memoria del proceso y expiran con la ventana. NUNCA se
 *   persisten ni se loguean — anti-honeypot (§11 del plan).
 * - Barrido perezoso: en cada llamada se limpian las entradas vencidas de esa
 *   key; cada SWEEP_EVERY llamadas se barre el Map completo para acotar memoria.
 *
 * ⚠️ LIMITACIÓN CONOCIDA (aceptada para el lanzamiento): en Vercel con
 * múltiples instancias/regiones cada instancia tiene su propio Map, así que el
 * límite efectivo es `max × instancias`. Para el tráfico del wedge alcanza como
 * fricción anti-abuso; cuando haya escala real, migrar a Upstash Redis
 * (@upstash/ratelimit — la env UPSTASH_REDIS_REST_URL ya está prevista en la
 * planilla de envs) manteniendo esta misma interfaz `limit()`.
 */

type LimitResult = {
  /** true = el intento está permitido (y ya quedó contado). */
  ok: boolean;
  /** Intentos que quedan dentro de la ventana después de este. */
  remaining: number;
  /** Si ok=false: cuánto falta (ms) para que se libere el cupo más viejo. */
  retryAfterMs: number;
};

const buckets = new Map<string, number[]>();

/** Barrido global cada N llamadas para que el Map no crezca sin límite. */
const SWEEP_EVERY = 500;
let callsSinceSweep = 0;

/** Cota dura de keys vivas — ante un flood de IPs, sacrificamos precisión antes que memoria. */
const MAX_KEYS = 50_000;

function sweep(now: number): void {
  for (const [key, timestamps] of buckets) {
    // Ventana más larga en uso hoy: 24 h. Todo lo más viejo ya no cuenta para nadie.
    const alive = timestamps.filter((t) => now - t < 24 * 60 * 60 * 1000);
    if (alive.length === 0) {
      buckets.delete(key);
    } else {
      buckets.set(key, alive);
    }
  }
}

/**
 * Registra un intento bajo `key` y dice si está dentro del límite.
 *
 * @param key      Identificador del actor + acción, p. ej. `registro:1.2.3.4`
 *                 o `reporte:<user_id>`. Namespacear SIEMPRE por acción.
 * @param max      Máximo de intentos permitidos dentro de la ventana.
 * @param windowMs Tamaño de la ventana deslizante en milisegundos.
 */
export function limit(key: string, max: number, windowMs: number): LimitResult {
  const now = Date.now();

  callsSinceSweep += 1;
  if (callsSinceSweep >= SWEEP_EVERY || buckets.size > MAX_KEYS) {
    callsSinceSweep = 0;
    sweep(now);
  }

  const previous = buckets.get(key) ?? [];
  const alive = previous.filter((t) => now - t < windowMs);

  if (alive.length >= max) {
    buckets.set(key, alive);
    return {
      ok: false,
      remaining: 0,
      retryAfterMs: Math.max(0, alive[0] + windowMs - now),
    };
  }

  alive.push(now);
  buckets.set(key, alive);
  return { ok: true, remaining: max - alive.length, retryAfterMs: 0 };
}

/** Ventanas nombradas para que los call-sites no repitan aritmética. */
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/**
 * IP del cliente para usar como key de rate limit.
 *
 * Fuente: `x-real-ip` (Vercel la setea con la IP real) con fallback al PRIMER
 * hop de `x-forwarded-for`. ⚠️ SUPUESTO VERCEL: la plataforma setea/normaliza
 * ambos headers, así que el cliente no puede spoofearlos; un deploy FUERA de
 * Vercel (self-hosted / otro proxy delante) debe revisar su cadena de proxies
 * antes de confiar en esto. La IP se usa SOLO como key en memoria del limiter
 * (expira con la ventana) — JAMÁS se persiste ni se loguea (anti-honeypot §11).
 */
export function clientIpFromHeaders(headers: Headers): string {
  return (
    headers.get("x-real-ip")?.trim() ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}
