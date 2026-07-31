/**
 * NOTIFICACIONES — agrupación por tiempo de la bandeja.
 *
 * Extiende el `groupByRecency` que vivía dentro de la página (Hoy / Esta semana
 * / Anteriores) a los cinco tramos que pide la spec, y lo saca a lib para que se
 * pueda testear sin montar un Server Component.
 *
 * "NUEVAS" NO ES UN TRAMO DE TIEMPO, y es a propósito: son las **no leídas**,
 * vengan de hace diez minutos o de hace dos semanas. Una notificación sin leer
 * es trabajo pendiente; enterrarla en "Anteriores" porque pasaron seis días es
 * exactamente cómo se pierde una postulación. Cada fila igual muestra SU tiempo,
 * así que no se pierde el cuándo. Las leídas sí caen por fecha.
 *
 * Pura: recibe `now` y no llama a Date.now() por dentro — los tests fijan el
 * reloj sin mocks y la página pasa un único `now` para todos los tramos.
 */

export type RecencyBucket = "nuevas" | "hoy" | "ayer" | "semana" | "anteriores";

export const RECENCY_ORDER: readonly RecencyBucket[] = [
  "nuevas",
  "hoy",
  "ayer",
  "semana",
  "anteriores",
] as const;

export type RecencyInput = {
  createdAt: Date | string;
  read: boolean;
};

export type RecencyGroup<T> = {
  bucket: RecencyBucket;
  items: T[];
};

/** Medianoche local del día de `reference`. */
function startOfDay(reference: Date): Date {
  const day = new Date(reference);
  day.setHours(0, 0, 0, 0);
  return day;
}

export function bucketFor(item: RecencyInput, now: Date): RecencyBucket {
  if (!item.read) return "nuevas";

  const created =
    item.createdAt instanceof Date ? item.createdAt : new Date(item.createdAt);
  // Fecha ilegible: al fondo, nunca arriba. Una fila rota no se gana el podio.
  if (Number.isNaN(created.getTime())) return "anteriores";

  const today = startOfDay(now);
  if (created >= today) return "hoy";

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (created >= yesterday) return "ayer";

  // "Esta semana" = los 7 días corridos hacia atrás desde hoy (no la semana
  // calendario): un lunes a la mañana, "esta semana" con corte de domingo
  // estaría casi vacía y todo lo del viernes se leería como viejo.
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 6);
  if (created >= weekAgo) return "semana";

  return "anteriores";
}

/**
 * Agrupa preservando el orden de entrada dentro de cada tramo (la query ya
 * viene `created_at desc`) y devuelve SOLO los tramos con contenido — un
 * encabezado "Ayer" sobre la nada es ruido.
 */
export function groupByRecency<T extends RecencyInput>(
  items: readonly T[],
  now: Date,
): RecencyGroup<T>[] {
  const buckets = new Map<RecencyBucket, T[]>();
  for (const bucket of RECENCY_ORDER) buckets.set(bucket, []);

  for (const item of items) {
    buckets.get(bucketFor(item, now))!.push(item);
  }

  return RECENCY_ORDER.map((bucket) => ({
    bucket,
    items: buckets.get(bucket)!,
  })).filter((group) => group.items.length > 0);
}
