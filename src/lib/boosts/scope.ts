/**
 * =============================================================================
 * ALCANCE GEOGRÁFICO DEL IMPULSO — el contrato, en una sola pieza pura
 * =============================================================================
 *
 * MÓDULO PURO a propósito: sin Supabase, sin React, sin `server-only`. Lo
 * importan el listado (Server Component), el selector de la pantalla de compra
 * (client component) y los tests. Si esto arrastrara el cliente de Supabase, el
 * selector de alcance no podría existir en el navegador.
 *
 * Acá vive UNA sola pregunta, y es la que hace que el alcance no sea una
 * casilla decorativa: **¿a este espectador le aplica el lugar pago de este
 * impulso?** Todo lo demás —el precio, la UI, el SQL— cuelga de esa respuesta.
 *
 * LOS TRES ALCANCES (espejo de la migración 0092)
 * ----------------------------------------------
 *   local     Aplica sólo a quien está en la zona objetivo: la declaró en su
 *             perfil o está mirando la lista filtrada por esa zona. Para el
 *             resto el aviso sigue apareciendo —está publicado— pero en su
 *             orden natural, sin lugar comprado.
 *   nacional  Aplica a toda la comunidad, y el aviso además se ofrece a las
 *             otras comunidades de la plataforma del mismo país.
 *   global    Aplica a toda la comunidad, y el aviso se ofrece a TODAS las
 *             comunidades de la plataforma.
 *
 * LA ASIMETRÍA DELIBERADA DE LAS DUDAS
 * ------------------------------------
 * Cuando falta un dato, las dos preguntas de este módulo se equivocan para el
 * lado opuesto, y es intencional:
 *   * `boostReachesViewer` (adentro de la comunidad que vendió el impulso) ante
 *     la duda dice SÍ. Alguien pagó por ese lugar; negárselo porque a la
 *     comunidad le falta cargar el país sería cobrarle por algo que no se le
 *     entrega.
 *   * `boostIsOfferedOutside` (hacia las otras comunidades) ante la duda dice
 *     NO. Meter contenido de otra comunidad en la vidriera de ésta es una
 *     decisión que hay que tener tomada, no adivinada.
 *
 * CERO GEO NUEVA (§5.4). La zona es un `area_label` —el mismo texto libre
 * aproximado que ya usan `listings.area_label`, el filtro `?zona=` y las
 * campañas de post— y el país es el `country_focus` de la comunidad. Este
 * módulo no deriva ubicación de nadie: sólo compara lo que la gente ya declaró.
 */

export const BOOST_SCOPES = ["local", "nacional", "global"] as const;
export type BoostScope = (typeof BOOST_SCOPES)[number];

/**
 * El alcance por defecto al LEER una fila.
 *
 * Es 'nacional' y no 'local' por la misma razón que el default de la columna
 * (ver el encabezado de la 0092): las filas anteriores al alcance recibieron
 * lugar pago en toda la comunidad, y eso se llama 'nacional'. Que el default de
 * lectura y el de la base digan lo mismo es lo que evita que una fila se
 * comporte distinto según quién la mire.
 */
export const DEFAULT_BOOST_SCOPE: BoostScope = "nacional";

/**
 * Cómo se le presenta cada alcance a quien está por pagar.
 *
 * `label` nombra el escalón; `hint` dice A QUIÉN LLEGA, que es lo único que
 * cambia entre los tres y lo único que justifica pagar más. Nada de "mayor
 * visibilidad": eso no es una promesa verificable, y acá todo lo que se promete
 * se cumple o no se escribe.
 */
export const BOOST_SCOPE_COPY: Record<
  BoostScope,
  { label: string; hint: string; reach: string }
> = {
  local: {
    label: "Tu zona",
    hint: "Aparece primero para la gente de tu zona.",
    reach: "Quien declaró tu zona en su perfil o está filtrando por ella.",
  },
  nacional: {
    label: "Todo el país",
    hint: "Aparece primero en toda tu comunidad, en cualquier zona.",
    reach: "Toda tu comunidad, y las comunidades del mismo país.",
  },
  global: {
    label: "Todas las comunidades",
    hint: "Aparece primero en tu comunidad y en todas las demás.",
    reach: "Toda tu comunidad y todas las comunidades de la plataforma.",
  },
};

/** Orden canónico de render: del alcance más chico al más grande. */
export const BOOST_SCOPE_IDS: readonly BoostScope[] = BOOST_SCOPES;

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

/**
 * Convierte cualquier cosa en un alcance válido. NUNCA lanza.
 *
 * Se usa para leer filas de la base y props que cruzan el borde servidor↔
 * cliente. Un valor imposible (una fila de un dump viejo, un tipo generado
 * desactualizado) cae al default en vez de romper un listado entero: el
 * listado es el producto, el alcance es un detalle del orden.
 *
 * Para lo que ESCRIBE una persona está `parseBoostScope`, que rechaza en vez de
 * adivinar — al comprar, adivinar el alcance sería cobrar por algo que nadie
 * eligió.
 */
export function normalizeBoostScope(
  raw: unknown,
  fallback: BoostScope = DEFAULT_BOOST_SCOPE,
): BoostScope {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim().toLowerCase();
  return (BOOST_SCOPES as readonly string[]).includes(value)
    ? (value as BoostScope)
    : fallback;
}

/** El alcance ELEGIDO por una persona, o `null` si no es uno de los tres. */
export function parseBoostScope(raw: unknown): BoostScope | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  return (BOOST_SCOPES as readonly string[]).includes(value)
    ? (value as BoostScope)
    : null;
}

/**
 * Texto geográfico listo para comparar: sin tildes, sin mayúsculas, sin
 * espacios de más y sin puntuación de separación.
 *
 * `NFD` + borrado de diacríticos es el mismo criterio que la búsqueda sin
 * tildes de la 0052: "Bogotá" y "Bogota" son el mismo lugar, y quien escribe
 * desde un teclado en inglés no debería quedar afuera de su propia zona.
 */
export function normalizeGeoLabel(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * ¿Son la misma zona?
 *
 * Match LAXO por contención, igual que `sameZone` en `src/lib/matching`: la
 * zona es texto libre y la misma gente escribe "Corona" y "Corona, Queens".
 * Exigir igualdad exacta convertiría el alcance local en una lotería de tipeo.
 *
 * La contención NO es reordenamiento: "Queens - Corona" y "Corona, Queens" no
 * se emparejan, y se acepta. Cubrir eso pediría comparar bolsas de palabras, y
 * ahí "Corona, Queens" empezaría a emparejar con "Queens, Flushing" — un falso
 * positivo entre dos barrios distintos es peor que un falso negativo entre dos
 * formas de escribir el mismo, porque el primero le vende a alguien un alcance
 * que no compró.
 *
 * Lo que sí se paga con la contención es algún falso positivo entre nombres
 * anidados de verdad ("Corona" ⊂ "Corona Heights"), y ese error es barato:
 * alguien ve un aviso patrocinado del barrio de al lado.
 *
 * Nota deliberada: dos cadenas vacías NO son la misma zona. Sin zona declarada
 * no hay alcance local que valga — se responde "no sé", no "sí".
 */
export function sameZoneLabel(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = normalizeGeoLabel(a);
  const right = normalizeGeoLabel(b);
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
}

/**
 * ¿Es el mismo país?
 *
 * `tenants.country_focus` es texto libre y hoy conviven 'DO', 'do' y nombres
 * escritos a mano, así que la comparación es normalizada e IGUAL (no laxa):
 * "República Dominicana" y "Dominica" son dos países distintos y la contención
 * los haría iguales. La laxitud sirve para barrios, no para fronteras.
 */
export function sameCountryLabel(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = normalizeGeoLabel(a);
  const right = normalizeGeoLabel(b);
  if (!left || !right) return false;
  return left === right;
}

// ---------------------------------------------------------------------------
// El objetivo del impulso y la geografía del espectador
// ---------------------------------------------------------------------------

/** Alcance comprado + su objetivo, ya normalizado. */
export interface BoostScopeTarget {
  scope: BoostScope;
  /** Zona objetivo (sólo tiene sentido en `local`). */
  area: string | null;
  /** País objetivo (sólo tiene sentido en `nacional`). */
  country: string | null;
}

/** Fila cruda de `boosts`, en lo que a alcance respecta. */
export interface BoostScopeRow {
  scope?: unknown;
  scope_area?: unknown;
  scope_country?: unknown;
}

/** Lee el alcance de una fila sin confiar en nada de lo que trae. */
export function readBoostScopeTarget(row: BoostScopeRow): BoostScopeTarget {
  const scope = normalizeBoostScope(row.scope);
  return {
    scope,
    area: scope === "local" && typeof row.scope_area === "string" ? row.scope_area : null,
    country:
      scope === "nacional" && typeof row.scope_country === "string" ? row.scope_country : null,
  };
}

/**
 * Dónde está parado quien mira, con lo que ya declaró y nada más.
 *
 * `areaLabel` es la zona del perfil O la zona por la que está filtrando en ese
 * momento — las dos cuentan, y la del filtro pesa más: si alguien está mirando
 * "Corona", está mirando Corona, aunque en su perfil diga otra cosa. Sin
 * ninguna de las dos, es `null` y el impulso local no le aplica.
 */
export interface ViewerGeo {
  areaLabel: string | null;
  /** País de la comunidad que está mirando (`tenants.country_focus`). */
  country: string | null;
}

/**
 * ¿A ESTE espectador le aplica el lugar pago de ESTE impulso?
 *
 * La pregunta que hace que el alcance no sea decorativo. Se responde adentro de
 * la comunidad que vendió el impulso, y ante la duda responde que SÍ: alguien
 * pagó por ese lugar y un dato faltante de nuestro lado no puede convertirse en
 * menos de lo que compró.
 */
export function boostReachesViewer(
  target: BoostScopeTarget,
  viewer: ViewerGeo,
): boolean {
  switch (target.scope) {
    case "global":
      return true;

    case "nacional":
      // Sin país en alguno de los dos lados no hay nada que contradecir: la
      // comunidad que vendió el impulso es la que lo está mostrando.
      if (!target.country || !viewer.country) return true;
      return sameCountryLabel(target.country, viewer.country);

    case "local":
      // Acá la duda SÍ se resuelve que no, y es la única excepción: un impulso
      // local sin zona objetivo no existe (lo prohíbe el CHECK de la 0092), y
      // un espectador sin zona declarada no está en ninguna. Decir que sí sería
      // convertir el alcance más barato en el más grande.
      return sameZoneLabel(viewer.areaLabel, target.area);
  }
}

/**
 * ¿Este impulso se ofrece FUERA de la comunidad que lo vendió?
 *
 * Acá la duda se resuelve que NO. Mostrar contenido de otra comunidad en la
 * vidriera de ésta es una decisión que se toma, no se adivina: un `nacional`
 * sin país cargado se queda en su casa.
 *
 * `viewerCountry` es el `country_focus` de la comunidad que está mostrando, y
 * lo resuelve el servidor desde el Host — nunca llega por parámetro.
 */
export function boostIsOfferedOutside(
  target: BoostScopeTarget,
  viewerCountry: string | null,
): boolean {
  switch (target.scope) {
    case "global":
      return true;
    case "nacional":
      return sameCountryLabel(target.country, viewerCountry);
    case "local":
      return false;
  }
}

