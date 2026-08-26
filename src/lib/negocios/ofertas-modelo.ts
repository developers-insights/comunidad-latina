/**
 * =============================================================================
 * OFERTAS — el contrato con la 0106 y la lógica pura que la pinta
 * =============================================================================
 *
 * `post_offers` (migración 0106) es una tabla SATÉLITE 1:1 de `posts`: la PK ES
 * la FK. Esa forma es el requisito del cliente hecho esquema — «una oferta puede
 * mostrarse en Publicaciones y en Ofertas, pero debe continuar siendo UNA SOLA
 * publicación dentro de la base». La pestaña Ofertas no es otra lista de cosas:
 * es el MISMO post, leído por su lado comercial.
 *
 * ⚠️ ESCAPE DE TIPOS. `src/lib/types/database.types.ts` está generado antes de
 * la 0106, así que `post_offers` no existe ahí. Mientras tanto se toca con el
 * cast acotado de `lib/resenas` (`supabaseSinTipar`) y con las interfaces de
 * fila de este archivo, que son transcripción literal del DDL. Mismo escape,
 * misma fecha de vencimiento y mismo motivo que la 0093 y la 0101: cuando se
 * regeneren los tipos, esto se reemplaza por `Tables<"post_offers">`.
 *
 * Módulo PURO: sin I/O, sin `server-only`. Las consultas viven en `./ofertas.ts`.
 */

import { DEFAULT_TIME_ZONE, formatDate, formatMoney } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Los cinco formatos del pedido (CHECK de la 0106)
// ---------------------------------------------------------------------------

export const OFERTA_TIPOS = ["descuento", "cupon", "promo", "menu", "paquete"] as const;
export type OfertaTipo = (typeof OFERTA_TIPOS)[number];

/**
 * La etiqueta del chip. Corta porque vive arriba de una tarjeta angosta, y
 * distinta entre sí porque la diferencia entre un cupón y un menú especial es
 * lo primero que alguien necesita saber para decidir si le sirve.
 */
export const OFERTA_TIPO_LABEL: Record<OfertaTipo, string> = {
  descuento: "Descuento",
  cupon: "Cupón",
  promo: "Promo",
  menu: "Menú especial",
  paquete: "Paquete",
};

export function esOfertaTipo(valor: unknown): valor is OfertaTipo {
  return typeof valor === "string" && (OFERTA_TIPOS as readonly string[]).includes(valor);
}

export const OFERTA_VALOR_TIPOS = ["porcentaje", "monto"] as const;
export type OfertaValorTipo = (typeof OFERTA_VALOR_TIPOS)[number];

// ---------------------------------------------------------------------------
// El descuento, en palabras
// ---------------------------------------------------------------------------

/**
 * `numeric(12,2)` viaja como string desde PostgREST. Esto lo normaliza sin
 * confundir "no hay valor" con "el valor es cero" — que la base ni siquiera
 * permite (`valor > 0`).
 */
export function leerValor(valor: number | string | null | undefined): number | null {
  if (valor === null || valor === undefined) return null;
  const numero = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(numero) || numero <= 0) return null;
  return numero;
}

/**
 * "20% de descuento" · "US$ 5 de descuento" · `null`.
 *
 * `null` NO es un caso raro: un menú especial o un paquete puede no tener
 * porcentaje ni monto, y la 0106 lo permite a propósito. La tarjeta muestra
 * entonces el título de la oferta y nada más — jamás un "0% de descuento",
 * que es exactamente lo que el DDL evita al dejar `valor` nullable.
 *
 * El porcentaje se escribe sin decimales cuando es redondo: la base guarda
 * `20.00` y "20,00% de descuento" se lee como un error de formato.
 */
export function etiquetaDeValor(
  valorTipo: string | null | undefined,
  valorCrudo: number | string | null | undefined,
  moneda: string,
): string | null {
  const valor = leerValor(valorCrudo);
  if (valor === null) return null;

  if (valorTipo === "porcentaje") {
    const numero = Number.isInteger(valor) ? String(valor) : valor.toFixed(1).replace(".", ",");
    return `${numero}% de descuento`;
  }
  if (valorTipo === "monto") {
    return `${formatMoney(valor, { currency: moneda })} de descuento`;
  }
  // `post_offers_valor_completo` impide que llegue acá, pero un dato viejo o una
  // fila escrita por fuera de la app no puede tumbar la tarjeta.
  return null;
}

// ---------------------------------------------------------------------------
// El vencimiento — lo que separa una oferta de un precio
// ---------------------------------------------------------------------------

export type EstadoVigencia = "vigente" | "por_vencer" | "vencida";

export interface Vencimiento {
  estado: EstadoVigencia;
  /** Lo que se lee en la tarjeta: "Vence hoy", "Vence en 3 días", "Vence el 12 de septiembre". */
  etiqueta: string;
}

const MS_POR_DIA = 86_400_000;

/** El día calendario de un instante, en la zona de la comunidad, como número. */
function diaCalendario(instante: Date, timeZone: string): number | null {
  try {
    const partes = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instante);
    const ms = Date.parse(`${partes}T00:00:00Z`);
    return Number.isNaN(ms) ? null : Math.round(ms / MS_POR_DIA);
  } catch {
    return null;
  }
}

/**
 * Cuánto le queda a la oferta, dicho como lo diría una persona.
 *
 * ── POR QUÉ SE CUENTA EN DÍAS DE CALENDARIO Y NO EN HORAS ───────────────────
 * "Vence en 1 día" a las 23:50 de un martes es engañoso: la oferta vence el
 * miércoles, y quien lo lee entiende "tengo 24 horas". Se compara el DÍA de la
 * comunidad —el mismo huso con el que la app muestra todas sus fechas— así que
 * "Vence hoy" y "Vence mañana" significan hoy y mañana en el calendario de
 * quien está en la comunidad, no una resta de milisegundos.
 *
 * ── "POR VENCER" NO ES UNA URGENCIA INVENTADA ───────────────────────────────
 * El estado `por_vencer` (≤ 2 días) existe para que la tarjeta lo marque
 * visualmente. Es un hecho de la fila, no una técnica de venta: la fecha la
 * puso el negocio y la app sólo la lee. Si mañana alguien quiere convertirlo en
 * una cuenta regresiva parpadeante, ese es otro debate — el dato es este.
 */
export function vencimientoDeOferta(
  expiresAt: string | Date,
  ahora: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): Vencimiento {
  const vence = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(vence.getTime())) {
    // Fecha ilegible: no se afirma nada sobre la vigencia.
    return { estado: "vigente", etiqueta: "Sin fecha de vencimiento legible" };
  }

  if (vence.getTime() <= ahora.getTime()) {
    return { estado: "vencida", etiqueta: "Esta oferta ya venció" };
  }

  const diaVence = diaCalendario(vence, timeZone);
  const diaHoy = diaCalendario(ahora, timeZone);
  if (diaVence === null || diaHoy === null) {
    return { estado: "vigente", etiqueta: `Vence el ${formatDate(vence, { style: "long" })}` };
  }

  const dias = diaVence - diaHoy;
  if (dias <= 0) return { estado: "por_vencer", etiqueta: "Vence hoy" };
  if (dias === 1) return { estado: "por_vencer", etiqueta: "Vence mañana" };
  if (dias <= 2) return { estado: "por_vencer", etiqueta: `Vence en ${dias} días` };
  if (dias <= 7) return { estado: "vigente", etiqueta: `Vence en ${dias} días` };
  return { estado: "vigente", etiqueta: `Vence el ${formatDate(vence, { style: "long" })}` };
}

// ---------------------------------------------------------------------------
// La oferta, ya lista para pintar
// ---------------------------------------------------------------------------

/**
 * El negocio dueño de la oferta, con lo justo para la tarjeta y sus botones.
 *
 * Vive en el módulo PURO —y no al lado de la consulta— para que la tarjeta y su
 * panel puedan tiparse sin arrastrar `server-only` a su árbol de imports.
 */
export interface NegocioDeOferta {
  id: string;
  nombre: string;
  fotoUrl: string | null;
  /** `null` = ficha de fuente externa (seed/API): no hay a quién escribirle. */
  duenoId: string | null;
}

export interface OfertaVista {
  /** Es el id del POST: la oferta no tiene id propio, y eso es exactamente el punto. */
  postId: string;
  tipo: OfertaTipo;
  titulo: string;
  /** "20% de descuento" · "US$ 5 de descuento" · `null` (menú o paquete sin número). */
  valorEtiqueta: string | null;
  codigoCupon: string | null;
  vencimiento: Vencimiento;
  terminos: string | null;
  /** El cuerpo de la publicación, que sigue viviendo en `posts`. */
  cuerpo: string | null;
  fotoUrl: string | null;
  negocio: NegocioDeOferta | null;
}
