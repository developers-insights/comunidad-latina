import { mediaKindOf, postMediaUrl } from "@/components/feed/helpers";
import { firstPhotoUrl } from "@/components/listings";

/**
 * Modelo PURO de /impulsar/resultados — "Cómo van tus promociones".
 *
 * Sin imports de servidor, igual que `../impulsar-items.ts`: la RSC hace las
 * consultas y le pasa filas crudas a estas funciones, que son las que se
 * testean en node (sin jsdom y sin mock de Supabase).
 *
 * QUÉ RESUELVE ESTE ARCHIVO, ADEMÁS DE MAPEAR. Junta impulsos de avisos
 * (`boosts`) y promociones de publicaciones (`post_promotions`) en UNA lista
 * ordenada, y —lo importante— mantiene separadas tres cosas que un panel
 * perezoso colapsa en un cero: el número que se leyó, el que no se pudo leer y
 * el que no existe para ese tipo de campaña. Ver `Medicion`.
 */

// ---------------------------------------------------------------------------
// El tipo que hace todo el trabajo
// ---------------------------------------------------------------------------

/**
 * UN NÚMERO, O LA RAZÓN POR LA QUE NO HAY NÚMERO.
 *
 * Son tres estados y no dos porque en esta pantalla conviven tres situaciones
 * que se ven distinto y significan distinto:
 *
 *   ok        · se leyó. `valor` puede ser 0, y ese 0 es un dato real.
 *   ilegible  · la consulta se cayó. Se muestra un hueco, NUNCA un 0: quien
 *               pagó leería "no te vio nadie" sobre algo que no se miró.
 *   no_aplica · la métrica no existe para este tipo de campaña (las
 *               publicaciones promocionadas no tienen lugar pago que contar,
 *               así que no hay impresiones). No se muestra la celda.
 *
 * Es el mismo criterio que la migración 0074 fijó para el tablero de ingresos
 * ("los ilegibles se informan aparte para que el tablero muestre un hueco en
 * vez de un cero inventado") y que ya usan `reach` y las impresiones en la
 * pantalla de estadísticas de un aviso.
 */
export type Medicion =
  | { estado: "ok"; valor: number }
  | { estado: "ilegible" }
  | { estado: "no_aplica" };

export const ILEGIBLE: Medicion = { estado: "ilegible" };
export const NO_APLICA: Medicion = { estado: "no_aplica" };

export function medido(valor: number): Medicion {
  return { estado: "ok", valor };
}

/**
 * Suma de mediciones para los totales de la cabecera.
 *
 * Si CUALQUIERA es ilegible, el total es ilegible: un total al que le faltan
 * sumandos, presentado como total, es peor que no mostrarlo — se lee como la
 * cifra completa. Las `no_aplica` no contaminan (simplemente no participan), y
 * si no queda ninguna medición real el total tampoco aplica.
 */
export function sumar(mediciones: readonly Medicion[]): Medicion {
  let total = 0;
  let hubo = false;
  for (const m of mediciones) {
    if (m.estado === "ilegible") return ILEGIBLE;
    if (m.estado === "ok") {
      total += m.valor;
      hubo = true;
    }
  }
  return hubo ? medido(total) : NO_APLICA;
}

// ---------------------------------------------------------------------------
// La campaña
// ---------------------------------------------------------------------------

/**
 * En qué punto está la campaña. `pending_payment` no llega acá: lo descarta la
 * consulta, igual que hace `fetchListingStats` — un checkout abandonado nunca
 * se sirvió y no tiene resultados que mostrar.
 */
export type EstadoCampana = "activa" | "terminada" | "cancelada";

export interface CampanaResumen {
  id: string;
  tipo: "aviso" | "publicacion";
  /** Título del aviso o recorte del post. Nunca vacío: hay respaldo. */
  titulo: string;
  thumbnailUrl: string | null;
  thumbnailIsVideo: boolean;
  estado: EstadoCampana;
  /** Días enteros que le quedan. `null` si ya no corre. */
  diasRestantes: number | null;
  endsAt: string | null;
  pagadoCents: number | null;
  /** Veces que ocupó el lugar pago. `no_aplica` en publicaciones. */
  vecesMostrada: Medicion;
  /**
   * Vistas TOTALES de lo promocionado, no sólo las del período pago: es el
   * contador de la propia fila. La pantalla lo rotula así de explícito, porque
   * ponerlo al lado de "veces que se mostró" sin aclararlo haría creer que las
   * trajo el impulso.
   */
  vistas: Medicion;
  /** A dónde lleva la fila. */
  href: string;
  createdAt: string;
}

export interface TotalesDeCampanas {
  activas: number;
  /** Lo gastado en todo lo que se lista. Los importes nulos no suman. */
  pagadoCents: number;
  vecesMostrada: Medicion;
  vistas: Medicion;
}

export interface ResumenDeCampanas {
  campanas: CampanaResumen[];
  totales: TotalesDeCampanas;
}

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Estado de una campaña combinando su `status` con el reloj.
 *
 * Un `active` cuyo `ends_at` ya pasó está TERMINADO aunque la fila todavía no
 * lo diga: el barrido que las vence corre cada tanto, y mientras tanto la
 * pantalla mostraría "activa, 0 días" — que es justo lo que alguien miraría
 * para decidir si renovar.
 */
export function estadoDeCampana(
  status: string,
  endsAt: string | null,
  ahoraMs: number,
): EstadoCampana {
  if (status === "canceled") return "cancelada";
  if (status !== "active") return "terminada";
  const fin = endsAt ? Date.parse(endsAt) : NaN;
  if (Number.isNaN(fin) || fin <= ahoraMs) return "terminada";
  return "activa";
}

/** Días enteros que le quedan, o `null` si ya no corre. */
export function diasRestantesDe(
  estado: EstadoCampana,
  endsAt: string | null,
  ahoraMs: number,
): number | null {
  if (estado !== "activa" || !endsAt) return null;
  const fin = Date.parse(endsAt);
  if (Number.isNaN(fin)) return null;
  return Math.max(0, Math.ceil((fin - ahoraMs) / DIA_MS));
}

// ---------------------------------------------------------------------------
// Filas crudas que entran
// ---------------------------------------------------------------------------

export interface BoostRowInput {
  id: string;
  listing_id: string;
  status: string;
  amount_cents: number | null;
  ends_at: string | null;
  created_at: string;
}

export interface PromoRowInput {
  id: string;
  post_id: string;
  status: string;
  amount_cents: number | null;
  ends_at: string | null;
  created_at: string;
}

export interface ListingLite {
  id: string;
  title: string;
  photos: string[] | null;
  view_count: number | null;
}

export interface PostLite {
  id: string;
  body: string;
  media: string[] | null;
  view_count: number | null;
}

const EXCERPT_MAX = 70;

function excerptOf(body: string): string {
  const clean = body.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > EXCERPT_MAX ? `${clean.slice(0, EXCERPT_MAX)}…` : clean;
}

/**
 * Lo promocionado ya no está (borrado, o fuera del alcance de la RLS).
 *
 * La campaña se lista IGUAL, con este título: la plata se gastó y borrar el
 * aviso no borra el gasto. Esconder la fila haría que los totales no cierren
 * con lo que la persona pagó, que es la clase de diferencia por la que se deja
 * de confiar en un panel.
 */
const SIN_CONTENIDO = "Ya no está disponible";

/**
 * Todo junto: las dos clases de campaña en una lista, ordenada por la más
 * reciente, más los totales de la cabecera.
 *
 * `impresionesPorBoost === null` significa que la consulta de impresiones se
 * cayó ENTERA — es una sola lectura, así que o están todas o no está ninguna, y
 * por eso cada impulso queda `ilegible` en vez de en cero.
 */
export function armarResumen(input: {
  boosts: readonly BoostRowInput[];
  promociones: readonly PromoRowInput[];
  listingsPorId: ReadonlyMap<string, ListingLite>;
  postsPorId: ReadonlyMap<string, PostLite>;
  impresionesPorBoost: ReadonlyMap<string, number> | null;
  ahoraMs: number;
}): ResumenDeCampanas {
  const deAvisos: CampanaResumen[] = input.boosts.map((row) => {
    const listing = input.listingsPorId.get(row.listing_id);
    const estado = estadoDeCampana(row.status, row.ends_at, input.ahoraMs);
    return {
      id: row.id,
      tipo: "aviso",
      titulo: listing?.title?.trim() || SIN_CONTENIDO,
      thumbnailUrl: listing ? firstPhotoUrl(listing.photos) : null,
      thumbnailIsVideo: false,
      estado,
      diasRestantes: diasRestantesDe(estado, row.ends_at, input.ahoraMs),
      endsAt: row.ends_at,
      pagadoCents: row.amount_cents,
      vecesMostrada:
        input.impresionesPorBoost === null
          ? ILEGIBLE
          : medido(input.impresionesPorBoost.get(row.id) ?? 0),
      vistas: listing ? medido(listing.view_count ?? 0) : NO_APLICA,
      // Al panel del aviso, que es donde está el detalle botón por botón. Si el
      // aviso ya no está, la fila no linkea a ningún lado.
      href: listing ? `/impulsar/${row.listing_id}/estadisticas` : "",
      createdAt: row.created_at,
    };
  });

  const dePosts: CampanaResumen[] = input.promociones.map((row) => {
    const post = input.postsPorId.get(row.post_id);
    const estado = estadoDeCampana(row.status, row.ends_at, input.ahoraMs);
    const primerMedio = (post?.media ?? []).find(
      (path) => typeof path === "string" && path.trim().length > 0,
    );
    return {
      id: row.id,
      tipo: "publicacion",
      titulo: (post ? excerptOf(post.body) : "") || (post ? "Publicación sin texto" : SIN_CONTENIDO),
      thumbnailUrl: primerMedio ? postMediaUrl(primerMedio) : null,
      thumbnailIsVideo: primerMedio ? mediaKindOf(primerMedio) === "video" : false,
      estado,
      diasRestantes: diasRestantesDe(estado, row.ends_at, input.ahoraMs),
      endsAt: row.ends_at,
      pagadoCents: row.amount_cents,
      // Una publicación promocionada no ocupa un lugar pago numerado: entra en
      // el feed. No hay impresiones que contar y un 0 acá sería inventarle una
      // métrica que el producto no mide.
      vecesMostrada: NO_APLICA,
      vistas: post ? medido(post.view_count ?? 0) : NO_APLICA,
      href: post ? `/impulsar-post/${row.post_id}` : "",
      createdAt: row.created_at,
    };
  });

  const campanas = [...deAvisos, ...dePosts].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );

  return {
    campanas,
    totales: {
      activas: campanas.filter((c) => c.estado === "activa").length,
      pagadoCents: campanas.reduce((sum, c) => sum + (c.pagadoCents ?? 0), 0),
      vecesMostrada: sumar(campanas.map((c) => c.vecesMostrada)),
      vistas: sumar(campanas.map((c) => c.vistas)),
    },
  };
}
