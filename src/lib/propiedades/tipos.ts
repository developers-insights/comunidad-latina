/**
 * =============================================================================
 * TIPO DE PROPIEDAD Y OPERACIÓN — contrato del módulo VIVIENDA
 * =============================================================================
 *
 * El pliego pide dos datos que hasta ahora no existían como tales:
 *   · QUÉ es (casa, departamento, cuarto…)
 *   · QUÉ se ofrece (venta o alquiler)
 *
 * Hasta hoy "venta" se DEDUCÍA de que `price_period` fuera `one_time`. Esa
 * inferencia es frágil en las dos direcciones: un alquiler de temporada con
 * precio cerrado también es `one_time`, y un aviso viejo sin período no era
 * ni una cosa ni la otra. Acá la operación pasa a ser un dato declarado, y el
 * período de precio queda como lo que siempre fue: la PRESENTACIÓN del precio.
 *
 * DÓNDE VIVEN: en `listings.attrs` (JSONB libre), al lado de `bedrooms`,
 * `bathrooms` y `sqft`. No hace falta migración — y por eso mismo hace falta
 * este módulo: un JSONB libre no valida nada, así que la única garantía de que
 * lo que se escribe y lo que se lee coinciden es que ambos lados pasen por acá.
 *
 * NO INVENTAMOS VALORES. Un aviso publicado antes de esta feature no tiene
 * estos campos, y eso se lee como "no declarado" — nunca como un valor por
 * defecto. Es el mismo criterio de `declarations.ts`: no poner una afirmación
 * en boca de alguien que no la hizo. En la UI, "no declarado" se ve como
 * ausencia (no aparece el chip), jamás como un negativo.
 *
 * Módulo PURO: sin I/O, sin `server-only`. Lo comparten la server action de
 * publicar, el formulario (client), el listado y el detalle.
 */

// ---------------------------------------------------------------------------
// Claves de attrs — fuente única para escritura y lectura
// ---------------------------------------------------------------------------

/**
 * Nombres de las claves dentro de `listings.attrs`. En inglés snake_case
 * porque así están TODAS las que ya viven ahí (`bedrooms`, `sqft`,
 * `starts_at`, `employment_type`); los parámetros de URL, en cambio, van en
 * español, que es la convención de las rutas (`?precio=`, `?hab=`, `?zona=`).
 * Cada capa mantiene su propio idioma en vez de mezclar los dos.
 *
 * Se exportan como constantes para que el filtro `attrs->>…` del listado y el
 * INSERT de la action no puedan desincronizarse por un typo.
 */
export const PROPERTY_TYPE_ATTR = "property_type";
export const PROPERTY_OPERATION_ATTR = "operation";

// ---------------------------------------------------------------------------
// Catálogo de tipos
// ---------------------------------------------------------------------------

/**
 * La lista está pensada para lo que esta comunidad publica DE VERDAD (latinos
 * en Estados Unidos), no para un catálogo inmobiliario completo:
 *
 * · `cuarto` es el caso más frecuente y por eso tiene entrada propia — el
 *   alquiler de una habitación dentro de una casa compartida es el pan de cada
 *   día del vertical, y meterlo dentro de "casa" lo volvería infiltrable.
 * · `vivienda_compartida` NO es lo mismo que `cuarto` y por eso son dos: en un
 *   cuarto se alquila UNA habitación con nombre y precio propios; en una
 *   vivienda compartida se ofrece un lugar en una casa que ya está habitada, y
 *   lo que define el aviso es con quiénes se convive, no qué metro cuadrado se
 *   ocupa. La spec las nombra por separado ("cuartos en alquiler y viviendas
 *   compartidas aprobadas") justamente porque se moderan distinto.
 * · `townhouse` se queda en inglés A PROPÓSITO: es la palabra que usa el
 *   listado real, el contrato y el vecino. "Casa adosada" sería más correcta
 *   en un diccionario y menos reconocible en Queens.
 * · `terreno` y `local_comercial` son poco frecuentes pero existen, y sin
 *   ellos esa gente elige "casa" y ensucia el filtro de todos los demás.
 * · `otro` cierra la lista para que nadie quede sin poder publicar. Va último.
 */
export const PROPERTY_TYPES = [
  "casa",
  "departamento",
  "cuarto",
  "vivienda_compartida",
  "estudio",
  "townhouse",
  "local_comercial",
  "terreno",
  "otro",
] as const;

export type PropertyType = (typeof PROPERTY_TYPES)[number];

/** Etiqueta humana, tal cual se lee en el formulario, el filtro y el detalle. */
export const PROPERTY_TYPE_LABEL: Record<PropertyType, string> = {
  casa: "Casa",
  departamento: "Departamento",
  cuarto: "Cuarto o habitación",
  vivienda_compartida: "Vivienda compartida",
  estudio: "Estudio",
  townhouse: "Townhouse",
  local_comercial: "Local comercial",
  terreno: "Terreno",
  otro: "Otro",
};

export interface PropertyTypeOption {
  value: PropertyType;
  label: string;
}

/** Mismo orden que `PROPERTY_TYPES`: lo más publicado primero, "Otro" al final. */
export const PROPERTY_TYPE_OPTIONS: readonly PropertyTypeOption[] = PROPERTY_TYPES.map(
  (value) => ({ value, label: PROPERTY_TYPE_LABEL[value] }),
);

// ---------------------------------------------------------------------------
// Catálogo de operaciones
// ---------------------------------------------------------------------------

/**
 * VOCABULARIO DE LECTURA. Todo lo que la app tiene que poder ENTENDER.
 *
 * Sigue teniendo `venta` y va a seguir teniéndola: hay avisos publicados con
 * `attrs.operation = 'venta'` y borrarla de acá no los borraría a ellos — los
 * volvería ilegibles. `normalizePropertyOperation` devolvería `null`, el chip
 * "Venta" desaparecería del detalle y el filtro por operación dejaría de
 * encontrarlos, todo sin un solo error. Un aviso que existe y no se puede leer
 * es peor que un aviso que no se puede crear.
 */
export const PROPERTY_OPERATIONS = ["alquiler", "venta"] as const;

export type PropertyOperation = (typeof PROPERTY_OPERATIONS)[number];

/**
 * VOCABULARIO DE ESCRITURA. Lo único que se puede publicar HOY.
 *
 * La spec es literal: «Inicialmente, Comunidad Latina solamente aceptará
 * apartamentos en alquiler, cuartos en alquiler y viviendas compartidas
 * aprobadas. No se incluirán propiedades en venta ni Open Houses.»
 *
 * POR QUÉ DOS LISTAS Y NO UNA RECORTADA. Lo que cambia es la POLÍTICA de qué se
 * acepta hoy, no el significado de la palabra "venta". Separar lectura de
 * escritura deja las dos verdades escritas al mismo tiempo: no se crean ventas
 * nuevas, y las que ya están se siguen mostrando enteras hasta que venzan solas
 * por el ciclo de la 0098. Cuando la comunidad decida abrir la venta, este
 * arreglo vuelve a tener dos elementos y no hay que tocar nada más.
 *
 * ES LA FUENTE ÚNICA de esa política: la usan el esquema de la server action
 * (`createListingDraft`) y el formulario. El filtro del listado y el detalle
 * siguen leyendo `PROPERTY_OPERATIONS`, que es lo correcto — filtran sobre lo
 * publicado, no sobre lo publicable.
 */
export const PUBLISHABLE_PROPERTY_OPERATIONS = ["alquiler"] as const;

export type PublishablePropertyOperation =
  (typeof PUBLISHABLE_PROPERTY_OPERATIONS)[number];

const PUBLISHABLE_OPERATION_SET = new Set<string>(PUBLISHABLE_PROPERTY_OPERATIONS);

/**
 * ¿Se puede crear un aviso nuevo con esta operación?
 *
 * Recibe `unknown` y no `PropertyOperation` a propósito: el punto donde se
 * pregunta esto es el borde del servidor, donde el valor todavía no es de
 * confianza. Un valor irreconocible NO es publicable — falla cerrado.
 */
export function isPublishableOperation(value: unknown): boolean {
  const operation = normalizePropertyOperation(value);
  return operation !== null && PUBLISHABLE_OPERATION_SET.has(operation);
}

/**
 * "Alquiler" y no "Renta" como etiqueta canónica (el resto del módulo ya habla
 * de alquileres), pero el normalizador acepta "renta" y "rento" porque es la
 * palabra que esta comunidad escribe en Estados Unidos. La etiqueta es una
 * decisión de voz; el normalizador es una defensa, y ahí conviene ser amplio.
 */
export const PROPERTY_OPERATION_LABEL: Record<PropertyOperation, string> = {
  alquiler: "Alquiler",
  venta: "Venta",
};

export interface PropertyOperationOption {
  value: PropertyOperation;
  label: string;
  /** Una línea que explica qué cambia al elegirla. Se lee debajo de la opción. */
  hint: string;
}

export const PROPERTY_OPERATION_OPTIONS: readonly PropertyOperationOption[] = [
  { value: "alquiler", label: "Alquiler", hint: "Se paga por mes, semana o día" },
  { value: "venta", label: "Venta", hint: "Un precio único por la propiedad" },
];

/**
 * Las opciones que el FORMULARIO puede ofrecer hoy. Derivadas —no escritas de
 * nuevo— para que no puedan desincronizarse de la política ni de las etiquetas.
 *
 * Hoy tiene un solo elemento, y el formulario está escrito para reaccionar a
 * eso: con una sola operación no dibuja un grupo de opciones (elegir entre una
 * cosa no es elegir), la asume y lo dice en una línea. Si mañana vuelve a haber
 * dos, el grupo reaparece solo.
 */
export const PUBLISHABLE_PROPERTY_OPERATION_OPTIONS: readonly PropertyOperationOption[] =
  // Se filtra contra el SET y no con `isPublishableOperation`: esta constante se
  // evalúa al cargar el módulo, y esa función pasa por `normalizePropertyOperation`,
  // que usa un `const` declarado más abajo. El `const` no se hoistea como una
  // función, así que llamarla acá reventaba el módulo entero con un
  // "Cannot access before initialization" al importarlo. Los valores de este
  // arreglo ya son canónicos —salen del catálogo, no de una entrada externa—,
  // así que el normalizador no aportaba nada.
  PROPERTY_OPERATION_OPTIONS.filter((option) => PUBLISHABLE_OPERATION_SET.has(option.value));

/**
 * La operación que se asume cuando hay una sola publicable. Se sigue ESCRIBIENDO
 * en `attrs.operation`: el aviso tiene que decir qué es por sí mismo, porque el
 * filtro y el detalle leen el dato, no la política vigente el día que se creó.
 */
export const DEFAULT_PUBLISHABLE_OPERATION: PropertyOperation =
  PUBLISHABLE_PROPERTY_OPERATION_OPTIONS[0]?.value ?? "alquiler";

// ---------------------------------------------------------------------------
// Normalizadores — NUNCA lanzan, devuelven null ante cualquier basura
// ---------------------------------------------------------------------------

/**
 * Texto → forma canónica comparable: minúsculas, sin acentos, separadores
 * unificados en `_`, y sin nada que no sea `[a-z0-9_]`.
 *
 * Lo que entra acá viene de un JSONB libre y de la URL, así que puede ser
 * cualquier cosa: un número, `null`, un objeto, un array, una cadena con
 * emojis. Todo lo que no sea un string con contenido sale como `null` sin
 * lanzar. `normalize("NFD")` es seguro con cualquier string (solo lanzaría con
 * una forma de normalización inválida, y ésta es literal).
 */
function canonicalize(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const canonical = value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s./-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return canonical.length > 0 ? canonical : null;
}

/**
 * Sinónimos que la gente escribe de verdad, más las variantes que puede haber
 * dejado un seed o una importación. NO es para que el formulario mande
 * cualquier cosa —ahí el valor sale de un `<select>` cerrado— sino para que un
 * dato viejo o importado se pueda leer en vez de perderse.
 */
const PROPERTY_TYPE_ALIASES: Record<string, PropertyType> = {
  // departamento
  apartamento: "departamento",
  apartment: "departamento",
  depto: "departamento",
  depa: "departamento",
  apto: "departamento",
  dpto: "departamento",
  // cuarto
  habitacion: "cuarto",
  pieza: "cuarto",
  recamara: "cuarto",
  room: "cuarto",
  // estudio
  studio: "estudio",
  monoambiente: "estudio",
  // casa
  house: "casa",
  // townhouse
  town_house: "townhouse",
  casa_adosada: "townhouse",
  // local comercial
  local: "local_comercial",
  comercial: "local_comercial",
  oficina: "local_comercial",
  // terreno
  lote: "terreno",
  land: "terreno",
  // otro
  other: "otro",
};

const PROPERTY_OPERATION_ALIASES: Record<string, PropertyOperation> = {
  // alquiler
  renta: "alquiler",
  rento: "alquiler",
  rentar: "alquiler",
  alquilar: "alquiler",
  alquilo: "alquiler",
  arriendo: "alquiler",
  rent: "alquiler",
  for_rent: "alquiler",
  rental: "alquiler",
  // venta
  vendo: "venta",
  vender: "venta",
  sale: "venta",
  for_sale: "venta",
  sell: "venta",
};

const PROPERTY_TYPE_SET = new Set<string>(PROPERTY_TYPES);
const PROPERTY_OPERATION_SET = new Set<string>(PROPERTY_OPERATIONS);

/** Cualquier entrada → `PropertyType` válido, o `null`. Nunca lanza. */
export function normalizePropertyType(value: unknown): PropertyType | null {
  const canonical = canonicalize(value);
  if (canonical === null) return null;
  if (PROPERTY_TYPE_SET.has(canonical)) return canonical as PropertyType;
  return PROPERTY_TYPE_ALIASES[canonical] ?? null;
}

/** Cualquier entrada → `PropertyOperation` válida, o `null`. Nunca lanza. */
export function normalizePropertyOperation(value: unknown): PropertyOperation | null {
  const canonical = canonicalize(value);
  if (canonical === null) return null;
  if (PROPERTY_OPERATION_SET.has(canonical)) return canonical as PropertyOperation;
  return PROPERTY_OPERATION_ALIASES[canonical] ?? null;
}

/** Etiqueta humana de un tipo, o `null` si el valor no se pudo reconocer. */
export function propertyTypeLabel(value: unknown): string | null {
  const type = normalizePropertyType(value);
  return type === null ? null : PROPERTY_TYPE_LABEL[type];
}

/** Etiqueta humana de una operación, o `null` si no se pudo reconocer. */
export function propertyOperationLabel(value: unknown): string | null {
  const operation = normalizePropertyOperation(value);
  return operation === null ? null : PROPERTY_OPERATION_LABEL[operation];
}

// ---------------------------------------------------------------------------
// Lectura desde attrs (JSONB libre)
// ---------------------------------------------------------------------------

export interface PropertyFacts {
  /** `null` = el aviso no lo declaró. NO es "otro" ni un default. */
  type: PropertyType | null;
  /** `null` = el aviso no lo declaró. NO se infiere del período de precio. */
  operation: PropertyOperation | null;
}

/**
 * Lee tipo y operación de un `listings.attrs` cualquiera.
 *
 * ÉSTE es el punto donde se sostiene la retrocompatibilidad: un aviso
 * publicado antes de esta feature no tiene las claves, y sale con los dos
 * campos en `null`. La UI muestra ausencia; nadie escribe "Alquiler" en un
 * aviso cuyo dueño nunca lo dijo.
 *
 * En particular NO se deduce `venta` de `price_period === 'one_time'`: esa era
 * justamente la inferencia frágil que esta feature vino a reemplazar, y
 * resucitarla acá para "rellenar" los avisos viejos sería propagar el error
 * con cara de dato.
 */
export function readPropertyFacts(attrs: unknown): PropertyFacts {
  const record =
    attrs !== null && typeof attrs === "object" && !Array.isArray(attrs)
      ? (attrs as Record<string, unknown>)
      : {};
  return {
    type: normalizePropertyType(record[PROPERTY_TYPE_ATTR]),
    operation: normalizePropertyOperation(record[PROPERTY_OPERATION_ATTR]),
  };
}

// ---------------------------------------------------------------------------
// Coherencia entre operación y período de precio
// ---------------------------------------------------------------------------

/** Los períodos que expresan una FRECUENCIA de pago (lenguaje de alquiler). */
export const RECURRING_PRICE_PERIODS = ["month", "week", "day"] as const;

export type RecurringPricePeriod = (typeof RECURRING_PRICE_PERIODS)[number];

const RECURRING_SET = new Set<string>(RECURRING_PRICE_PERIODS);

export function isRecurringPricePeriod(value: unknown): value is RecurringPricePeriod {
  return typeof value === "string" && RECURRING_SET.has(value);
}

export type PricePeriodResolution =
  | { ok: true; period: "month" | "week" | "day" | "one_time" | null }
  | { ok: false; reason: "venta_con_frecuencia" };

/**
 * Período de precio coherente con la operación declarada.
 *
 * LAS TRES REGLAS, y por qué:
 *
 * 1. `venta` + período recurrente ("$450.000 por mes") es una CONTRADICCIÓN,
 *    no un dato incompleto. Se rechaza en vez de elegir cuál de los dos
 *    campos gana: adivinar la intención sería inventar. El formulario hace
 *    inalcanzable ese estado —al elegir Venta oculta la frecuencia— así que
 *    esto sólo salta con un payload armado a mano o con un cliente viejo.
 *
 * 2. `venta` sin período (o con `one_time`) → `one_time`. El precio de una
 *    venta ES único; no es una suposición sobre lo que quiso decir la persona,
 *    es la única lectura posible de lo que ya dijo.
 *
 * 3. `alquiler` o SIN OPERACIÓN DECLARADA → el período pasa tal cual. Un
 *    alquiler de temporada con precio cerrado (`one_time`) es legítimo, y un
 *    aviso que no declaró operación no puede perder el período que sí declaró.
 *    Esta última rama es la que deja publicar sin romper a un cliente viejo
 *    que todavía no manda `operation`.
 */
export function resolvePricePeriod(
  operation: PropertyOperation | null,
  period: "month" | "week" | "day" | "one_time" | null | undefined,
): PricePeriodResolution {
  const normalized = period ?? null;
  if (operation === "venta") {
    if (isRecurringPricePeriod(normalized)) {
      return { ok: false, reason: "venta_con_frecuencia" };
    }
    return { ok: true, period: "one_time" };
  }
  return { ok: true, period: normalized };
}
