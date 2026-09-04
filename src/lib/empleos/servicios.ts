import { formatListingPrice } from "@/components/listings/helpers";
import {
  WORK_DAYS,
  readJobDetails,
  workDayLabel,
  type WorkDay,
} from "./detalles";

/**
 * =============================================================================
 * SERVICIOS — lo que la gente OFRECE, dentro de /empleos
 * =============================================================================
 *
 * Feedback del cliente 2026-09-03 (48:42–57:00): un EMPLEO lo publica quien
 * busca gente ("restaurante busca cocinero"); un SERVICIO lo publica quien
 * ofrece lo que sabe hacer ("soy jardinero, disponible sábados y domingos",
 * "arreglo computadoras"). Es el otro lado del mostrador, no otra categoría de
 * empleo — por eso no se postula nadie: se le escribe por Mensajes.
 *
 * DÓNDE VIVE UN SERVICIO: `listings` con `kind = 'service'` (migración 0129).
 * No hay tabla propia, y eso NO es pereza: así hereda de una sola vez la RLS por
 * tenant, la moderación, los reportes, la auto-pausa por reportes (0118), los
 * guardados, el vencimiento (0098), el feed y la búsqueda global. Un módulo
 * paralelo habría tenido que re-ganarse las diez cosas.
 *
 * QUÉ COLUMNA GUARDA QUÉ, Y POR QUÉ NINGUNA ES NUEVA:
 *
 *   · qué hace        → `title` + `description`
 *   · zona            → `area_label` (+ `work_mode`, 0087: "arreglo
 *                       computadoras" puede ser a distancia)
 *   · disponibilidad  → `attrs.work_days` + `attrs.schedule`, EXACTAMENTE las
 *                       mismas claves que ya escribe un empleo
 *                       (`lib/empleos/detalles.ts`). "Sábados y domingos" es
 *                       el mismo hecho que "qué días se trabaja": inventarle
 *                       `attrs.availability` sería el mismo dato con dos
 *                       nombres, y el primer informe que los cruce va a fallar.
 *   · precio de refe. → `price_amount` (el PISO, "desde") + `price_period`.
 *                       NULL = "a convenir", que es un caso legítimo y no un
 *                       dato faltante — la mitad de los servicios informales
 *                       cotizan mirando el trabajo.
 *
 * QUÉ **NO** LLEVA UN SERVICIO, a propósito:
 *   · `attrs.employment_type` — no hay jornada que declarar. Queda ausente, y
 *     `parseJobAttrs` ya lee la ausencia como `null` sin romperse.
 *   · `attrs.questions` — las preguntas son del embudo de postulación, y acá no
 *     hay postulación.
 *   · fotos — el wizard del servicio son 3 pasos y ninguno las pide (decisión
 *     de producto: el aviso tiene que poder cargarse en un minuto desde el
 *     teléfono). La tarjeta está diseñada para no necesitarlas.
 *
 * Módulo PURO: sin I/O y sin `server-only`. Lo comparten la tarjeta (cliente),
 * la lectura del listado (servidor) y los tests.
 */

// ---------------------------------------------------------------------------
// Lectura desde attrs
// ---------------------------------------------------------------------------

export interface ServiceDetails {
  /** Días declarados, ya en orden de semana. Vacío = no lo dijo. */
  days: WorkDay[];
  /** Texto libre corto ("de 9 a 17"), ya recortado. `null` si no lo dijo. */
  schedule: string | null;
}

/**
 * Lectura defensiva de `listings.attrs` para `kind='service'`. NUNCA lanza.
 *
 * Se apoya en `readJobDetails` en vez de re-parsear el jsonb: las dos claves
 * que le importan a un servicio son las mismas que las del empleo, con la misma
 * normalización (catálogo cerrado de días, horario recortado). Un segundo
 * parser sería la manera de que dentro de tres meses un empleo y un servicio
 * lean "sábado" de dos formas distintas.
 */
export function readServiceDetails(attrs: unknown): ServiceDetails {
  const { days, schedule } = readJobDetails(attrs);
  return { days, schedule };
}

// ---------------------------------------------------------------------------
// Disponibilidad en una línea
// ---------------------------------------------------------------------------

const DAY_ORDER = WORK_DAYS.map((day) => day.value);

/** "Sábado" → "Sábados"; los que ya terminan en -s no cambian (lunes, martes…). */
function enPlural(label: string): string {
  return label.endsWith("s") ? label : `${label}s`;
}

function enMinuscula(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/**
 * Los días declarados, dichos como los diría una persona.
 *
 * "sat,sun" no puede llegar a pantalla como "Sábado · Domingo": el aviso lo
 * escribe alguien que ofrece su tiempo y lo lee alguien que necesita saber
 * cuándo puede contar con él. Tres formas, en este orden:
 *
 *   · los 7 días            → "Todos los días"
 *   · una racha de 3 o más  → "Lunes a viernes" (una racha corta como
 *                             sábado+domingo se lee mejor enumerada)
 *   · cualquier otra cosa   → "Sábados y domingos" / "Lunes, miércoles y viernes"
 *
 * `null` cuando no declaró ningún día: la ausencia se dibuja como ausencia, no
 * como un "consultar" inventado.
 */
export function etiquetaDeDias(days: readonly WorkDay[]): string | null {
  const ordenados = DAY_ORDER.filter((day) => days.includes(day));
  if (ordenados.length === 0) return null;
  if (ordenados.length === 7) return "Todos los días";

  // ¿Son consecutivos en la semana? (`indexOf` sobre 7 elementos, no hay nada
  // que optimizar acá.)
  const indices = ordenados.map((day) => DAY_ORDER.indexOf(day));
  const esRacha = indices.every((valor, i) => i === 0 || valor === indices[i - 1] + 1);
  if (esRacha && ordenados.length >= 3) {
    const desde = workDayLabel(ordenados[0]);
    const hasta = workDayLabel(ordenados[ordenados.length - 1]);
    if (desde && hasta) return `${desde} a ${enMinuscula(hasta)}`;
  }

  const etiquetas = ordenados
    .map((day) => workDayLabel(day))
    .filter((label): label is string => Boolean(label))
    .map(enPlural);
  if (etiquetas.length === 0) return null;

  const primera = etiquetas[0];
  const resto = etiquetas.slice(1).map(enMinuscula);
  if (resto.length === 0) return primera;
  // "Sábados y domingos" · "Lunes, miércoles y viernes" — la "y" antes del
  // último, como se habla.
  const ultimo = resto.pop() as string;
  return resto.length === 0
    ? `${primera} y ${ultimo}`
    : `${[primera, ...resto].join(", ")} y ${ultimo}`;
}

/**
 * Disponibilidad completa para la tarjeta y el detalle: días y horario en una
 * sola línea, separados por el punto medio que ya usa el resto del módulo.
 * `null` si no declaró ninguno de los dos.
 */
export function etiquetaDeDisponibilidad(details: ServiceDetails): string | null {
  const dias = etiquetaDeDias(details.days);
  const partes = [dias, details.schedule].filter((parte): parte is string => Boolean(parte));
  return partes.length > 0 ? partes.join(" · ") : null;
}

// ---------------------------------------------------------------------------
// Precio de referencia
// ---------------------------------------------------------------------------

/**
 * "Desde US$ 25/hora", o `null` cuando el aviso no puso monto.
 *
 * El "Desde" no es adorno: en un servicio el número es una REFERENCIA, no una
 * tarifa cerrada — el jardinero cobra distinto un patio chico que uno grande.
 * Decir "US$ 25/hora" a secas prometería un precio que después no se sostiene,
 * y esa es exactamente la discusión que arruina el primer contacto.
 *
 * Sin monto NO devuelve un texto: "a convenir" es copy de pantalla y vive en
 * `copy.ts`, no acá — este módulo no sabe en qué idioma se está mostrando.
 */
export function etiquetaDePrecioDesde(
  amount: number | null,
  currency: string,
  period: string | null,
  locale?: string,
): string | null {
  const base = formatListingPrice(amount, currency, period, locale);
  return base ? `Desde ${base}` : null;
}
