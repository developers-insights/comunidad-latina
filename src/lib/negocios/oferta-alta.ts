/**
 * =============================================================================
 * DAR DE ALTA UNA OFERTA — la parte pura, compartida por el composer y el server
 * =============================================================================
 *
 * `ofertas-modelo.ts` es la LECTURA (cómo se lee una oferta que ya existe).
 * Este módulo es la ESCRITURA: qué se le puede pedir a alguien que cargue, qué
 * cuenta como válido y cómo se convierte lo que se tipeó en las columnas que la
 * 0106 espera. Los dos son puros —sin `server-only`, sin Supabase— porque el
 * formulario corre en el navegador y la validación de verdad corre en el
 * servidor, y las dos tienen que estar de acuerdo carácter por carácter.
 *
 * ── UNA OFERTA NO ES UN TIPO DE PUBLICACIÓN ─────────────────────────────────
 * Es una publicación que ADEMÁS tiene condiciones comerciales (ver el
 * encabezado de la 0106). Por eso acá no hay ni cuerpo, ni fotos, ni nada que
 * ya viva en `posts`: este payload es EXACTAMENTE el satélite `post_offers` y
 * ni un campo más. Duplicar el título del post acá sería crear la segunda copia
 * que la tabla satélite existe para evitar.
 *
 * ── LOS LÍMITES SON LOS DEL DDL, COPIADOS A PROPÓSITO ───────────────────────
 * 120 caracteres de título, 3–40 de cupón, 2000 de términos, `expires_at >
 * starts_at`, y valor/tipo que viajan juntos o no viajan. Están escritos dos
 * veces —acá y en los CHECK de la 0106— porque un `<input maxlength>` que no
 * coincide con la base es un formulario que se completa entero y revienta al
 * final. Manda el SQL: si alguna vez se contradicen, el que está mal es este
 * archivo.
 */

import {
  OFERTA_TIPOS,
  OFERTA_VALOR_TIPOS,
  type OfertaTipo,
  type OfertaValorTipo,
} from "./ofertas-modelo";

export { OFERTA_TIPOS, OFERTA_VALOR_TIPOS };
export type { OfertaTipo, OfertaValorTipo };

/** `char_length(btrim(titulo)) between 1 and 120` (0106). */
export const MAX_TITULO_OFERTA = 120;
/** `char_length(btrim(codigo_cupon)) between 3 and 40` (0106). */
export const MIN_CUPON = 3;
export const MAX_CUPON = 40;
/** `char_length(terminos) <= 2000` (0106). */
export const MAX_TERMINOS_OFERTA = 2000;
/** `valor` es `numeric(12,2)`; el tope acota el porcentaje, no la moneda. */
export const MAX_PORCENTAJE = 100;
export const MAX_MONTO = 1_000_000;

/**
 * Hasta cuándo se puede estirar una oferta. No sale del DDL —la base sólo pide
 * que la ventana no esté al revés— sino del producto: una promo a tres años no
 * es una promo, es un precio, y la vidriera de Ofertas se llenaría de cosas que
 * nadie va a ir a buscar. Un año es el techo que nadie roza escribiendo de
 * verdad.
 */
export const MAX_DIAS_DE_OFERTA = 365;

export const OFERTA_TIPO_AYUDA: Record<OfertaTipo, string> = {
  descuento: "Un precio más bajo por un tiempo",
  cupon: "Se muestra un código para usar el descuento",
  promo: "Una promoción por tiempo limitado",
  menu: "Un menú o combo especial",
  paquete: "Varios servicios juntos a un precio",
};

// ---------------------------------------------------------------------------
// El payload, tal como viaja del composer al servidor
// ---------------------------------------------------------------------------

export interface OfertaBorrador {
  tipo: OfertaTipo;
  titulo: string;
  /** `null` = esta oferta no tiene número (un menú especial, por ejemplo). */
  valorTipo: OfertaValorTipo | null;
  /** Va SIEMPRE con `valorTipo`, o ninguno (CHECK `post_offers_valor_completo`). */
  valor: number | null;
  codigoCupon: string | null;
  /** `YYYY-MM-DD` — el último día en que vale, en la zona de la comunidad. */
  vence: string;
  terminos: string | null;
}

/** Un borrador vacío: lo que ve alguien que recién abre el bloque. */
export function ofertaVacia(): OfertaBorrador {
  return {
    tipo: "descuento",
    titulo: "",
    valorTipo: null,
    valor: null,
    codigoCupon: null,
    vence: "",
    terminos: null,
  };
}

// ---------------------------------------------------------------------------
// Validación — un motivo por vez, en el orden en que se lee el formulario
// ---------------------------------------------------------------------------

export type MotivoOfertaInvalida =
  | "tipo"
  | "titulo"
  | "valor"
  | "cupon"
  | "vence"
  | "vence_pasada"
  | "vence_lejos"
  | "terminos";

export const OFERTA_ERROR: Record<MotivoOfertaInvalida, string> = {
  tipo: "Elegí qué tipo de oferta es.",
  titulo: `Ponele un título a la oferta (hasta ${MAX_TITULO_OFERTA} caracteres).`,
  valor: "El descuento tiene que ser un número mayor a cero.",
  cupon: `El código va entre ${MIN_CUPON} y ${MAX_CUPON} caracteres.`,
  vence: "Elegí hasta qué día vale la oferta.",
  vence_pasada: "Esa fecha ya pasó. Elegí una de hoy en adelante.",
  vence_lejos: "Una oferta puede durar hasta un año.",
  terminos: `Las condiciones son un poco largas (hasta ${MAX_TERMINOS_OFERTA} caracteres).`,
};

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export type ValidacionOferta =
  | { ok: true; oferta: OfertaBorrador }
  | { ok: false; motivo: MotivoOfertaInvalida };

/**
 * Valida y NORMALIZA en el mismo paso (recorta espacios, sube el cupón a
 * mayúsculas, redondea el valor a los dos decimales que la columna guarda).
 *
 * `hoy` entra por parámetro y no se lee de `new Date()` acá adentro: es lo que
 * permite testear "esa fecha ya pasó" sin depender del reloj de la máquina, y
 * es el mismo criterio de `estadoDeApertura` y de `vencimientoDeOferta`.
 */
export function validarOferta(entrada: OfertaBorrador, hoy: string): ValidacionOferta {
  if (!(OFERTA_TIPOS as readonly string[]).includes(entrada.tipo)) {
    return { ok: false, motivo: "tipo" };
  }

  const titulo = entrada.titulo.trim();
  if (titulo.length === 0 || titulo.length > MAX_TITULO_OFERTA) {
    return { ok: false, motivo: "titulo" };
  }

  // Valor y tipo, juntos o ninguno. Un `valor` sin `valorTipo` obligaría a la
  // tarjeta a adivinar si son 20% o 20 dólares — el CHECK de la 0106 lo
  // rechaza, así que rebotarlo acá es no gastar el viaje.
  let valorTipo: OfertaValorTipo | null = null;
  let valor: number | null = null;
  const hayAlgunValor = entrada.valorTipo !== null || entrada.valor !== null;
  if (hayAlgunValor) {
    if (
      entrada.valorTipo === null ||
      !(OFERTA_VALOR_TIPOS as readonly string[]).includes(entrada.valorTipo)
    ) {
      return { ok: false, motivo: "valor" };
    }
    const numero = Number(entrada.valor);
    if (!Number.isFinite(numero) || numero <= 0) return { ok: false, motivo: "valor" };
    const techo = entrada.valorTipo === "porcentaje" ? MAX_PORCENTAJE : MAX_MONTO;
    if (numero > techo) return { ok: false, motivo: "valor" };
    valorTipo = entrada.valorTipo;
    valor = Math.round(numero * 100) / 100;
  }

  // El cupón se guarda en MAYÚSCULAS: es un código que alguien va a tipear
  // mirando una pantalla, y "abc123" y "ABC123" son el mismo cupón para
  // cualquiera que no sea una base de datos.
  let codigoCupon: string | null = null;
  const cupon = (entrada.codigoCupon ?? "").trim().toUpperCase();
  if (cupon.length > 0) {
    if (cupon.length < MIN_CUPON || cupon.length > MAX_CUPON) {
      return { ok: false, motivo: "cupon" };
    }
    codigoCupon = cupon;
  }

  const vence = entrada.vence.trim();
  if (!FECHA.test(vence)) return { ok: false, motivo: "vence" };
  // Comparación de strings `YYYY-MM-DD`: es orden lexicográfico Y cronológico a
  // la vez, así que no hace falta construir dos `Date` para saber cuál es antes.
  if (vence < hoy) return { ok: false, motivo: "vence_pasada" };
  if (diasEntre(hoy, vence) > MAX_DIAS_DE_OFERTA) return { ok: false, motivo: "vence_lejos" };

  let terminos: string | null = null;
  const letraChica = (entrada.terminos ?? "").trim();
  if (letraChica.length > 0) {
    if (letraChica.length > MAX_TERMINOS_OFERTA) return { ok: false, motivo: "terminos" };
    terminos = letraChica;
  }

  return {
    ok: true,
    oferta: { tipo: entrada.tipo, titulo, valorTipo, valor, codigoCupon, vence, terminos },
  };
}

/** Días calendario entre dos `YYYY-MM-DD`. Negativo si `hasta` es anterior. */
export function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00Z`);
  const b = Date.parse(`${hasta}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

// ---------------------------------------------------------------------------
// De "el 12 de septiembre" a un instante real
// ---------------------------------------------------------------------------

/**
 * Cuántos minutos adelanta o atrasa `timeZone` respecto de UTC en ese instante.
 * Se calcula formateando el instante EN la zona y volviéndolo a leer como si
 * fuera UTC: la diferencia entre los dos números ES el offset, con el horario
 * de verano ya aplicado. Es el mismo truco que usa `momentoEnZona`, con las
 * partes completas en vez de sólo día y hora.
 */
function offsetEnMinutos(instante: Date, timeZone: string): number | null {
  try {
    const partes = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instante);

    const leer = (tipo: string): number | null => {
      const parte = partes.find((p) => p.type === tipo);
      if (!parte) return null;
      const numero = Number(parte.value);
      return Number.isInteger(numero) ? numero : null;
    };

    const anio = leer("year");
    const mes = leer("month");
    const dia = leer("day");
    const hora = leer("hour");
    const minuto = leer("minute");
    const segundo = leer("second");
    if (
      anio === null ||
      mes === null ||
      dia === null ||
      hora === null ||
      minuto === null ||
      segundo === null
    ) {
      return null;
    }

    const comoUTC = Date.UTC(anio, mes - 1, dia, hora % 24, minuto, segundo);
    return Math.round((comoUTC - instante.getTime()) / 60_000);
  } catch {
    return null;
  }
}

/**
 * `"2026-09-12"` en `America/New_York` → el instante en que termina ESE día ahí.
 *
 * Vence al FINAL del día elegido y no al principio: quien escribe "vale hasta
 * el 12" quiere que valga el 12, y una oferta que se apaga a las 00:00 del día
 * que promete es una oferta que miente en la tarjeta.
 *
 * Dos pasadas por el offset porque el offset depende del instante y el instante
 * depende del offset: la primera lo estima con el mediodía UTC de ese día (que
 * nunca cae del otro lado de un cambio de horario), la segunda lo corrige sobre
 * el instante ya calculado. Devuelve `null` si la zona no existe — quien llama
 * decide con qué reemplazarla, acá no se inventa una.
 */
export function finDelDiaEnZona(fecha: string, timeZone: string): Date | null {
  if (!FECHA.test(fecha)) return null;
  const [anio, mes, dia] = fecha.split("-").map(Number);
  if (!anio || !mes || !dia) return null;

  const finComoUTC = Date.UTC(anio, mes - 1, dia, 23, 59, 59, 999);
  const referencia = new Date(Date.UTC(anio, mes - 1, dia, 12, 0, 0));

  const primerOffset = offsetEnMinutos(referencia, timeZone);
  if (primerOffset === null) return null;

  const estimado = new Date(finComoUTC - primerOffset * 60_000);
  const segundoOffset = offsetEnMinutos(estimado, timeZone);
  if (segundoOffset === null) return null;

  return new Date(finComoUTC - segundoOffset * 60_000);
}

/** Hoy, en `YYYY-MM-DD`, tal como se ve en esa zona. */
export function hoyEnZona(ahora: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(ahora);
  } catch {
    return ahora.toISOString().slice(0, 10);
  }
}
