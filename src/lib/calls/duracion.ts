/**
 * Duración de una llamada.
 *
 * Módulo PURO —sin Supabase, sin DOM, sin `Date.now()` adentro— para que el
 * cronómetro se pueda testear sin esperar un segundo real. El "ahora" entra
 * siempre por parámetro.
 *
 * La 0139 no guarda una columna de duración a propósito: es la resta entre
 * `started_at` y `ended_at`, y una columna se puede desincronizar de las puntas.
 * Este archivo es esa resta, escrita una sola vez.
 */

/**
 * Segundos de conversación. Nunca negativo: un reloj de cliente adelantado
 * respecto del servidor daría "-3" en pantalla el primer segundo de la llamada.
 *
 * - Sin `started_at` (nadie atendió todavía) → 0.
 * - Con `ended_at` → la llamada ya terminó y la duración queda congelada.
 * - Sin `ended_at` → corre contra `ahoraMs`.
 */
export function duracionEnSegundos(
  startedAt: string | null,
  endedAt: string | null,
  ahoraMs: number,
): number {
  if (!startedAt) return 0;
  const inicio = Date.parse(startedAt);
  if (Number.isNaN(inicio)) return 0;

  const finBruto = endedAt ? Date.parse(endedAt) : ahoraMs;
  const fin = Number.isNaN(finBruto) ? ahoraMs : finBruto;

  return Math.max(0, Math.floor((fin - inicio) / 1000));
}

/**
 * `0:07` · `12:05` · `1:03:07`.
 *
 * Los minutos sólo llevan cero a la izquierda cuando hay horas: "0:07" es cómo
 * lo dice un cronómetro y "00:07" es cómo lo diría una planilla.
 */
export function formatearDuracion(segundos: number): string {
  const total = Math.max(0, Math.floor(segundos));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

/**
 * Cómo se lee una duración en voz alta, para el `aria-label` del cronómetro.
 * Un lector de pantalla que anuncia "uno dos punto cero cinco" no dice nada.
 */
export function duracionHablada(segundos: number): string {
  const total = Math.max(0, Math.floor(segundos));
  const m = Math.floor(total / 60);
  const s = total % 60;
  const partes: string[] = [];
  if (m > 0) partes.push(m === 1 ? "1 minuto" : `${m} minutos`);
  partes.push(s === 1 ? "1 segundo" : `${s} segundos`);
  return partes.join(" y ");
}

/**
 * Resumen de una llamada terminada, para el historial: "Audio · 4:12".
 * Sin duración (perdida o rechazada) la pantalla usa su propio copy.
 */
export function resumenDeDuracion(
  startedAt: string | null,
  endedAt: string | null,
): string | null {
  if (!startedAt || !endedAt) return null;
  const segundos = duracionEnSegundos(startedAt, endedAt, Date.parse(endedAt));
  if (segundos <= 0) return null;
  return formatearDuracion(segundos);
}
