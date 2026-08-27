/**
 * =============================================================================
 * CASOS DE SEGURIDAD — lectura, anonimato y rótulo
 * =============================================================================
 *
 * Espejo en TypeScript de `public.security_cases` (0122) más las dos reglas que
 * la pantalla no puede delegar en la base.
 *
 * ── 1. EL CHEQUEO DE ANONIMATO SE HACE DOS VECES, Y NO ES REDUNDANCIA ───────
 * La migración tiene un CHECK (`app.texto_sin_datos_de_contacto`) que rechaza
 * arrobas, enlaces y tiras de siete dígitos o más. Igual se repite acá antes de
 * renderizar, porque el CHECK tiene dos agujeros conocidos:
 *
 *   · `service_role` no se saltea los CHECK —eso es cierto—, pero SÍ se saltea
 *     la RLS, y una fila cargada por un script contra una base que todavía no
 *     tenía la 0122 aplicada entra sin restricción de ninguna clase. Este repo
 *     tiene varias migraciones que llegaron después de los datos.
 *   · Un CHECK protege la ESCRITURA. Lo que la pantalla publica es la LECTURA, y
 *     entre las dos hay restores, seeds y `alter table ... drop constraint`.
 *
 * Como el costo de repetirlo es un regex por campo y el costo de que falle es
 * publicar el teléfono de una persona en la pantalla de seguridad, se repite.
 * Un caso con riesgo NO se muestra: se descarta en silencio para quien lee y se
 * avisa por consola para quien lo cargó.
 *
 * ── 2. UN PATRÓN NUNCA SE PUEDE LEER COMO UN HECHO PUNTUAL ──────────────────
 * `origin` distingue el patrón documentado (la forma que se repite) del caso que
 * pasó en esta comunidad. `etiquetaDeOrigen` obliga a que cada tarjeta lo diga
 * en la cara, con las mismas palabras siempre. Sin eso, cuatro relatos bien
 * escritos se leen como cuatro estafas frenadas la semana pasada, y la pantalla
 * que existe para no inventar evidencia estaría inventándola.
 */

export const VERTICALES = [
  "vivienda",
  "empleo",
  "marketplace",
  "servicios",
  "mensajes",
  "cuenta",
] as const;
export type Vertical = (typeof VERTICALES)[number];

/** Cómo se nombra cada vertical en la tarjeta. Sustantivo corto, sin jerga. */
export const ETIQUETA_VERTICAL: Record<Vertical, string> = {
  vivienda: "Alquileres",
  empleo: "Empleos",
  marketplace: "Compra y venta",
  servicios: "Servicios",
  mensajes: "Mensajes",
  cuenta: "Tu cuenta",
};

export type Origen = "caso" | "patron";

export interface CasoDeSeguridad {
  id: string;
  slug: string;
  vertical: Vertical;
  origen: Origen;
  /** `YYYY-MM-01`, o `null` en los patrones. Un mes, nunca un día (0122 §2.b). */
  mes: string | null;
  titulo: string;
  /** Qué pasó. */
  resumen: string;
  /** Qué lo delató: lo único que el lector se lleva puesto. */
  senal: string;
  /** Qué hizo el sistema — incluido "nada", cuando ésa es la verdad. */
  respuesta: string;
  /** Qué hacer si te pasa a vos. */
  consejo: string;
}

/** Lo que un texto puede tener y no debería. */
export type Reidentificador = "arroba" | "enlace" | "numero_largo";

const DETECTORES: ReadonlyArray<readonly [Reidentificador, RegExp]> = [
  // Mails y menciones de red social de una sola pasada. Ningún relato anónimo
  // necesita una arroba: si aparece, es alguien pegando un dato.
  ["arroba", /@/],
  ["enlace", /https?:\/\//i],
  // Siete dígitos seguidos. Un teléfono de EE. UU. tiene diez; un precio
  // ("$2,400"), un año ("2026") y un monto ("1100") no llegan a siete.
  ["numero_largo", /\d{7}/],
];

/**
 * Qué datos reidentificables tiene un texto. Lista vacía = está limpio.
 *
 * Devuelve QUÉ encontró y no un booleano para que el aviso de consola le sirva a
 * quien cargó el caso: "tiene una arroba" es accionable, "es inválido" no.
 */
export function riesgosDeReidentificacion(texto: string): Reidentificador[] {
  return DETECTORES.filter(([, patron]) => patron.test(texto)).map(([tipo]) => tipo);
}

/** Los cinco campos que se LEEN. `slug` y `vertical` son vocabularios cerrados. */
function textosVisibles(caso: CasoDeSeguridad): string[] {
  return [caso.titulo, caso.resumen, caso.senal, caso.respuesta, caso.consejo];
}

/** Riesgos encontrados en cualquiera de los textos visibles, sin repetir. */
export function riesgosDelCaso(caso: CasoDeSeguridad): Reidentificador[] {
  const vistos = new Set<Reidentificador>();
  for (const texto of textosVisibles(caso)) {
    for (const riesgo of riesgosDeReidentificacion(texto)) vistos.add(riesgo);
  }
  return [...vistos];
}

export function casoEsPublicable(caso: CasoDeSeguridad): boolean {
  return riesgosDelCaso(caso).length === 0;
}

function esTextoUtil(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim().length > 0;
}

const MES_ISO = /^\d{4}-\d{2}-01$/;

/**
 * Una fila de `security_cases` → un caso tipado, o `null`.
 *
 * Rechaza en vez de completar con defaults: un caso al que le falta la señal o
 * el consejo no es un caso a medias, es una tarjeta que no enseña nada. Y un
 * `origin = 'caso'` sin mes se descarta aunque la base lo tenga —el CHECK de la
 * 0122 lo impide, pero la pantalla no depende de que la migración esté aplicada.
 */
export function parseCaso(raw: unknown): CasoDeSeguridad | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const fila = raw as Record<string, unknown>;

  const { id, slug, vertical, origin, title, summary, signal, response, advice } = fila;
  if (!esTextoUtil(id) || !esTextoUtil(slug)) return null;
  if (typeof vertical !== "string" || !(VERTICALES as readonly string[]).includes(vertical)) {
    return null;
  }
  if (origin !== "caso" && origin !== "patron") return null;
  if (
    !esTextoUtil(title) ||
    !esTextoUtil(summary) ||
    !esTextoUtil(signal) ||
    !esTextoUtil(response) ||
    !esTextoUtil(advice)
  ) {
    return null;
  }

  // `date` llega como 'YYYY-MM-DD' por PostgREST. Se exige el día 1 —el mismo
  // CHECK que la base— para que una fecha exacta no llegue nunca a la pantalla.
  const bruto = fila["occurred_month"];
  let mes: string | null = null;
  if (typeof bruto === "string" && MES_ISO.test(bruto)) mes = bruto;
  if (origin === "caso" && mes === null) return null;
  if (origin === "patron") mes = null;

  return {
    id,
    slug,
    vertical: vertical as Vertical,
    origen: origin,
    mes,
    titulo: title.trim(),
    resumen: summary.trim(),
    senal: signal.trim(),
    respuesta: response.trim(),
    consejo: advice.trim(),
  };
}

export interface LecturaDeCasos {
  publicables: CasoDeSeguridad[];
  /** Cuántas filas se descartaron por forma inválida o por riesgo de PII. */
  descartados: number;
}

/**
 * Filas crudas → los casos que se pueden mostrar.
 *
 * Descarta en silencio para quien lee (una tarjeta menos, no un error) y deja el
 * conteo para quien llama, que es el que decide si loguearlo.
 */
export function leerCasos(filas: unknown): LecturaDeCasos {
  if (!Array.isArray(filas)) return { publicables: [], descartados: 0 };
  const publicables: CasoDeSeguridad[] = [];
  let descartados = 0;
  for (const fila of filas) {
    const caso = parseCaso(fila);
    if (caso === null || !casoEsPublicable(caso)) {
      descartados += 1;
      continue;
    }
    publicables.push(caso);
  }
  return { publicables, descartados };
}

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

/**
 * 'YYYY-MM-01' → "mayo de 2026".
 *
 * Se parsea a mano y NO con `new Date(iso)`: el constructor interpreta la cadena
 * como medianoche UTC, así que un navegador al oeste de Greenwich muestra el mes
 * ANTERIOR. Un mes corrido no rompe nada visible y por eso no se descubre nunca.
 */
export function formatearMes(iso: string): string | null {
  if (!MES_ISO.test(iso)) return null;
  const anio = Number(iso.slice(0, 4));
  const mes = Number(iso.slice(5, 7));
  if (mes < 1 || mes > 12) return null;
  return `${MESES[mes - 1]} de ${anio}`;
}

/**
 * El rótulo que va arriba de cada tarjeta. Es la regla 2 de la cabecera hecha
 * función: el patrón y el caso NUNCA se dicen con las mismas palabras.
 */
export function etiquetaDeOrigen(caso: CasoDeSeguridad): string {
  if (caso.origen === "patron") return "Patrón documentado por el equipo";
  const mes = caso.mes ? formatearMes(caso.mes) : null;
  return mes ? `Caso de la comunidad · ${mes}` : "Caso de la comunidad";
}
