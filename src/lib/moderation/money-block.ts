/**
 * =============================================================================
 * BLOQUEO DE DINERO EN AYUDA ENTRE VECINOS (migración 0121)
 * =============================================================================
 *
 * Por qué existe: el cliente lo dijo en una línea — «monetariamente no se
 * ayuda». No es una preferencia estética, es la regla que sostiene el tablón.
 * En una comunidad migrante, el pedido de plata es el vehículo de casi toda
 * estafa: alguien publica una desgracia creíble, pide una transferencia por
 * Zelle y desaparece. La víctima no tiene a quién reclamarle, muchas veces no
 * denuncia, y el que estafa vuelve al día siguiente con otro nombre. Si por
 * acá no pasa plata, ese negocio no existe.
 *
 * QUÉ ES: un control de seguridad determinista que corre EN LA SERVER ACTION y
 * RECHAZA la publicación. No es un cartel de advertencia ni un `aria-live` en
 * el formulario. Un gate de UI no cuenta: quien manda un POST a mano contra la
 * server action se saltea cualquier chequeo que viva en el cliente.
 *
 * QUÉ NO ES: no es `moderateText` (que llama a OpenAI y decide tiers). Esto es
 * una regla de producto, síncrona y sin red — corre igual con OpenAI caído, y
 * por eso no vive en el mismo archivo ni comparte su degradación a `skipped`.
 * Tampoco es `contact-block.ts`, que frena teléfonos y correos en
 * Colaboraciones: mismo patrón, otro dominio, archivos separados.
 *
 * DÓNDE CORRE: en el servidor, al borde de la server action, DESPUÉS de Zod
 * (que ya acotó longitudes) y ANTES de cualquier insert. `findMoneyMatches` es
 * una función pura sin `server-only`, así que el formulario puede llamarla
 * para avisar mientras se escribe — pero el cliente nunca es la frontera.
 *
 * -----------------------------------------------------------------------------
 * DOCTRINA DE PRECISIÓN (por qué las reglas son las que son)
 *
 * Un falso positivo acá le rechaza el pedido de ayuda a alguien que no hizo
 * nada, con un cartel que insinúa que quiso estafar. Un falso negativo deja
 * pasar una línea que un admin todavía puede bajar antes de publicar (nada se
 * publica sin aprobación — pedido B2). Los costos NO son simétricos, así que:
 * implacables con lo inequívoco, permisivos con lo dudoso.
 *
 * De ahí las decisiones que parecen tibias y no lo son:
 *  - "banco de comida" NO se bloquea: la palabra `banco` no está en ninguna
 *    regla, justamente porque el banco de comida es medio tablón.
 *  - "dono medicinas", "recibimos donaciones de ropa" NO se bloquean: `donar`
 *    y `donación` sueltos jamás matchean; hace falta que el objeto donado sea
 *    dinero ("donación en efectivo", "donar plata").
 *  - "colecta de ropa" y "préstamo de herramientas" NO se bloquean: las dos
 *    palabras SÍ disparan solas —el cliente pidió explícitamente frenar
 *    "colecta" y "préstamo"— pero un `refine` las descarta cuando lo que sigue
 *    es una cosa y no plata.
 *  - "quiero prestar mis servicios" NO se bloquea: el verbo `prestar` sólo
 *    cuenta si tiene plata cerca.
 *  - "we need donations" NO se bloquea (es literalmente el centro de acopio);
 *    "we need funds" SÍ.
 *
 * Y las que sí son duras a propósito: cualquier cifra con símbolo de moneda,
 * cualquier app de pago o de colecta nombrada, y cualquier pedido explícito.
 * Ahí no hay ambigüedad que respetar.
 * -----------------------------------------------------------------------------
 */

/** Qué clase de señal se encontró. Gobierna el mensaje que ve la persona. */
export type MoneyKind = "amount" | "payment_app" | "request";

export interface MoneyMatch {
  kind: MoneyKind;
  /** Fragmento exacto que disparó la regla — para resaltarlo en la UI. */
  text: string;
  /** Índice en el texto original (`text.slice(index, index + text.length)`). */
  index: number;
}

/* -------------------------------------------------------------------------- */
/* Normalización                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Traducción 1:1 que PRESERVA LA LONGITUD, para que los índices del match
 * sigan siendo válidos sobre el texto ORIGINAL — que es el que ve la persona.
 * Mismo mecanismo (y misma limitación) que `contact-block.ts`.
 *
 * Acá los acentos SÍ se planchan, y no es cosmético: "dólares", "préstamo",
 * "económica" y "donación" son la mitad del vocabulario de este detector, y
 * escribir cada regex en sus dos ortografías es cómo se cuela un bypass. Con
 * el mapa, cada regla se escribe una vez y sin acentos.
 */
const HOMOGLYPHS: Record<string, string> = {
  // Vocales acentuadas y eñe (misma longitud, un carácter por un carácter).
  á: "a", à: "a", ä: "a", â: "a",
  é: "e", è: "e", ë: "e", ê: "e",
  í: "i", ì: "i", ï: "i", î: "i",
  ó: "o", ò: "o", ö: "o", ô: "o",
  ú: "u", ù: "u", ü: "u", û: "u",
  ñ: "n",
  // Dígitos "fullwidth" (copy/paste desde una imagen o un teclado asiático).
  "０": "0", "１": "1", "２": "2", "３": "3", "４": "4",
  "５": "5", "６": "6", "７": "7", "８": "8", "９": "9",
  // Símbolos de moneda alternativos que romperían un `$` literal.
  "＄": "$", "﹩": "$", "$": "$",
};

/** Minúsculas + homoglifos, sin mover un solo índice. */
function normalize(input: string): string {
  let out = "";
  for (const char of input.toLowerCase()) {
    const mapped = HOMOGLYPHS[char];
    out += mapped && mapped.length === char.length ? mapped : char;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Reglas                                                                     */
/* -------------------------------------------------------------------------- */

interface Rule {
  kind: MoneyKind;
  pattern: RegExp;
  /** Descarta un match mirando el contexto (devolver false = no es dinero). */
  refine?: (match: RegExpExecArray, normalized: string) => boolean;
}

/* ---- 1. Montos ---------------------------------------------------------- */

/** `$50`, `US$ 1.200`, `€30`. Exige dígito: un "$" suelto es demasiado poco. */
const AMOUNT_SYMBOL_PATTERN = /(?:us\s?)?[$€£¥]\s?\d[\d.,]*/g;

/** `50 dólares`, `200 pesos`, `20 bucks`, `1.500 usd`. */
const AMOUNT_WORD_PATTERN =
  /\b\d[\d.,]*\s*(?:dolares?|dolar|usd|dollars?|bucks|pesos?|euros?|lucas)\b/g;

/** `usd 200` — el mismo monto con la moneda adelante. */
const AMOUNT_PREFIX_PATTERN = /\busd\s?\d[\d.,]*/g;

/* ---- 2. Apps y servicios de pago o colecta ------------------------------ */

/**
 * Nombrar una de éstas en un tablón donde no se maneja plata no tiene lectura
 * inocente. `wise` quedó AFUERA a propósito: es una palabra corriente en
 * inglés ("a wise decision") y la comunidad es bilingüe — el falso positivo
 * costaba más que el caso que cubría.
 */
const PAYMENT_APP_PATTERN =
  /\b(?:zelle|cash\s?app|venmo|pay\s?pal|western\s?union|remitly|money\s?gram|payoneer|go\s?fund\s?me|gofundme|bitcoin|usdt|binance|cripto\w*|crypto\w*|zinli|nequi|daviplata)\b/g;

/* ---- 3. Pedidos explícitos, en español ---------------------------------- */

/**
 * Verbo de transferencia + plata cerca. El límite `[^.\n]{0,20}` mantiene el
 * match dentro de la misma frase: sin él, un "prestá atención" al principio y
 * un "dinero" tres oraciones después se leerían como un pedido.
 *
 * Es la regla que deja pasar "quiero prestar mis servicios" — hay verbo, no
 * hay plata.
 */
const SEND_MONEY_PATTERN =
  /\b(?:mand|envi|pas|transfer|deposit|gir|prest)\w*[^.\n]{0,20}?\b(?:plata|dinero|efectivo)\b/g;

/** Verbo de necesidad + plata cerca. Deja pasar "necesito comida". */
const NEED_MONEY_PATTERN =
  /\b(?:necesit|busc|pid|solicit|requier|junt|recaud|falta|faltan|urge)\w*[^.\n]{0,20}?\b(?:plata|dinero|efectivo|fondos)\b/g;

/** "ayuda económica", "apoyo monetario", "ayuda con la plata". */
const MONEY_HELP_PATTERN =
  /\b(?:ayuda|apoyo|colaboracion|aporte)\s+(?:economic[oa]|monetari[oa]|financier[oa]|en\s+efectivo|con\s+(?:el\s+|la\s+)?(?:dinero|plata))\b/g;

/**
 * `préstamo` (sustantivo) y `colecta`. El cliente pidió las dos por nombre.
 * Cada una lleva su `refine`: en esta comunidad "colecta de ropa" y "préstamo
 * de herramientas" son ayuda mutua de la buena, no un pedido de plata.
 */
const LOAN_NOUN_PATTERN = /\bprestamos?\b/g;
const COLLECTION_NOUN_PATTERN = /\bcolectas?\b/g;

/** Cosas que, si vienen después, prueban que no se trata de plata. */
const GOODS_AFTER =
  /^\s*(?:de|para|con)\s+(?:ropa|alimentos?|comida|viveres|juguetes?|utiles|libros|abrigos?|panales|medicinas?|medicamentos?|donaciones|frazadas|mantas|zapatos|calzado|sangre|muebles|herramientas?|sillas?|mesas?|carpas?|bicicletas?|utensilios?)\b/;

function noEsPorPlata(match: RegExpExecArray, normalized: string): boolean {
  const start = match.index + match[0].length;
  return !GOODS_AFTER.test(normalized.slice(start, start + 40));
}

/** "hacemos una vaquita" — el nombre de andar por casa de una colecta. */
const VAQUITA_PATTERN = /\b(?:hac|arm|junt|organiz)\w*\s+(?:una\s+)?vaquita\b/g;

/** Donar SÍ; donar PLATA no. Sin el objeto de dinero, esto no matchea. */
const CASH_DONATION_PATTERN =
  /\b(?:donaci(?:on|ones)|donar|donacion)\s+(?:en\s+|de\s+)?(?:efectivo|dinero|plata|metalico|monetari[ao]s?)\b/g;

/** "pago en efectivo", "te lo doy en efectivo". */
const CASH_PATTERN = /\b(?:en|de)\s+efectivo\b/g;

/**
 * Pagar una deuda ajena es ayuda monetaria aunque no diga la cifra:
 * "necesito para la fianza", "ayudame a pagar la renta". La fianza migratoria
 * es el caso más frecuente y el más caro de esta comunidad.
 */
const PAY_DEBT_PATTERN =
  /\b(?:pag|abon|cubr|complet)\w*[^.\n]{0,16}?\b(?:fianza|renta|alquiler|deuda|boleta|factura|recibo|hipoteca)\b/g;

/** Las gift cards son la moneda favorita de la estafa: no dejan rastro. */
const GIFT_CARD_PATTERN = /\b(?:tarjetas?\s+de\s+regalo|gift\s?cards?)\b/g;

/* ---- 4. Pedidos explícitos, en inglés ----------------------------------- */

const SEND_MONEY_EN_PATTERN =
  /\b(?:send|wire|lend|loan|give|spot|transfer)\s+(?:me|us)\b[^.\n]{0,16}?\b(?:money|cash|\$|\d)/g;

/**
 * `donations` quedó AFUERA de esta alternancia y es la decisión más
 * importante del bloque en inglés: "we need donations" es literalmente lo que
 * publica un centro de acopio. "we need funds", en cambio, es plata.
 */
const NEED_MONEY_EN_PATTERN =
  /\b(?:need|needs|needing|looking\s+for|asking\s+for|request(?:ing)?)\b[^.\n]{0,20}?\b(?:money|cash|funds)\b/g;

const FINANCIAL_HELP_EN_PATTERN =
  /\b(?:financial|monetary)\s+(?:help|aid|assistance|support|hardship|donations?|contributions?)\b/g;

const FUNDRAISE_EN_PATTERN =
  /\bfund\s?rais(?:er|ers|ing)\b|\b(?:raise|raising|collect(?:ing)?)\s+(?:money|funds)\b/g;

/** `loan` como sustantivo, y `cash` suelto: en inglés no tienen otra lectura. */
const LOAN_EN_PATTERN = /\bloans?\b/g;
const CASH_EN_PATTERN = /\bcash\b/g;

/**
 * El orden importa: gana la regla más específica, porque un match que se pisa
 * con otro ya encontrado se descarta. Por eso las apps de pago van antes que
 * `cash` suelto ("Cash App" se reporta como app, no como pedido genérico).
 */
const RULES: readonly Rule[] = [
  { kind: "amount", pattern: AMOUNT_SYMBOL_PATTERN },
  { kind: "amount", pattern: AMOUNT_WORD_PATTERN },
  { kind: "amount", pattern: AMOUNT_PREFIX_PATTERN },

  { kind: "payment_app", pattern: PAYMENT_APP_PATTERN },

  { kind: "request", pattern: MONEY_HELP_PATTERN },
  { kind: "request", pattern: CASH_DONATION_PATTERN },
  { kind: "request", pattern: SEND_MONEY_PATTERN },
  { kind: "request", pattern: NEED_MONEY_PATTERN },
  { kind: "request", pattern: PAY_DEBT_PATTERN },
  { kind: "request", pattern: VAQUITA_PATTERN },
  { kind: "request", pattern: GIFT_CARD_PATTERN },
  { kind: "request", pattern: LOAN_NOUN_PATTERN, refine: noEsPorPlata },
  { kind: "request", pattern: COLLECTION_NOUN_PATTERN, refine: noEsPorPlata },
  { kind: "request", pattern: CASH_PATTERN },

  { kind: "request", pattern: FINANCIAL_HELP_EN_PATTERN },
  { kind: "request", pattern: FUNDRAISE_EN_PATTERN },
  { kind: "request", pattern: SEND_MONEY_EN_PATTERN },
  { kind: "request", pattern: NEED_MONEY_EN_PATTERN },
  { kind: "request", pattern: LOAN_EN_PATTERN },
  { kind: "request", pattern: CASH_EN_PATTERN },
];

/* -------------------------------------------------------------------------- */
/* API                                                                        */
/* -------------------------------------------------------------------------- */

/** ¿Dos rangos se pisan? Un monto ya detectado no vuelve como otra cosa. */
function overlaps(existing: MoneyMatch, start: number, end: number): boolean {
  const existingEnd = existing.index + existing.text.length;
  return start < existingEnd && existing.index < end;
}

/**
 * Todas las señales de dinero de un texto, en orden de aparición y sin
 * solapamientos.
 *
 * Pura y sin red: se puede llamar desde el cliente para avisar mientras se
 * escribe. La decisión de rechazar la toma el servidor con `blockMoneyTalk`.
 */
export function findMoneyMatches(input: string | null | undefined): MoneyMatch[] {
  const original = (input ?? "").toString();
  if (original.trim().length === 0) return [];

  const normalized = normalize(original);
  const found: MoneyMatch[] = [];

  for (const rule of RULES) {
    // Copia de la regex por llamada: el `lastIndex` de una regex `g` a nivel de
    // módulo es estado mutable, y hace que la segunda llamada arranque donde
    // terminó la primera. Bug clásico, y silencioso.
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalized)) !== null) {
      if (match[0].length === 0) {
        pattern.lastIndex += 1;
        continue;
      }
      if (rule.refine && !rule.refine(match, normalized)) continue;

      const start = match.index;
      const end = start + match[0].length;
      if (found.some((existing) => overlaps(existing, start, end))) continue;

      found.push({
        kind: rule.kind,
        // Del ORIGINAL, no del normalizado: es lo que la persona escribió.
        text: original.slice(start, end),
        index: start,
      });
    }
  }

  return found.sort((a, b) => a.index - b.index);
}

export type BlockMoneyResult =
  | { ok: true }
  | { ok: false; kinds: MoneyKind[]; matches: MoneyMatch[]; message: string };

/**
 * Copy del bloqueo. No reta y no acusa: quien escribe "necesito $200 para la
 * renta" está en problemas de verdad, no tratando de estafar a nadie. El
 * mensaje tiene que explicarle por qué la regla lo protege A ÉL, y dejarlo
 * parado frente a la puerta que sí le sirve.
 */
export const MONEY_BLOCK_COPY = {
  title: "Por acá no se pide ni se manda plata",
  /** Qué se encontró, en criollo. */
  kindLabel: {
    amount: "un monto de plata",
    payment_app: "una app para transferir",
    request: "un pedido de plata",
  } satisfies Record<MoneyKind, string>,
  reason:
    "Es la única regla dura de esta sección y está para cuidarte: casi todas las estafas que llegan a la comunidad arrancan igual, con alguien que pide una transferencia y después no contesta más. Si por acá no pasa plata, no hay nada que sacarte.",
  fix: "Contá lo que sí podés dar o lo que sí necesitás —tiempo, comida, ropa, un viaje en auto, tu oficio— y publicá de nuevo.",
  /**
   * La salida real, no un "lo sentimos". Se expone aparte para que el
   * formulario la muestre como enlace a `/comunidad/recursos`: quien necesita
   * plata para la renta necesita un programa de asistencia, y ésos están en el
   * directorio con su fuente citada.
   */
  where:
    "Si lo que te aprieta es la renta, la comida o un tratamiento, en «Dónde pedir ayuda» están las organizaciones que manejan esos programas.",
} as const;

function humanList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

/**
 * Mensaje completo para la persona: qué encontramos, por qué no va y qué
 * hacer. Exportado aparte para poder testearlo y para reusarlo en el aviso en
 * vivo del formulario.
 */
export function moneyBlockMessage(kinds: MoneyKind[]): string {
  const unique = [...new Set(kinds)];
  const labels = unique.map((kind) => MONEY_BLOCK_COPY.kindLabel[kind]);
  return `Encontramos ${humanList(labels)} en lo que escribiste. ${MONEY_BLOCK_COPY.reason} ${MONEY_BLOCK_COPY.fix}`;
}

/**
 * Puerta del servidor: `{ ok: false }` si el texto habla de dinero.
 *
 * El caller NO guarda nada y devuelve `message` tal cual — ya está escrito
 * para leerse en pantalla. Se llama DESPUÉS de Zod y ANTES de cualquier insert.
 */
export function blockMoneyTalk(input: string | null | undefined): BlockMoneyResult {
  const matches = findMoneyMatches(input);
  if (matches.length === 0) return { ok: true };

  const kinds = [...new Set(matches.map((match) => match.kind))];
  return { ok: false, kinds, matches, message: moneyBlockMessage(kinds) };
}

/**
 * Igual que `blockMoneyTalk` pero sobre varios campos (título + descripción +
 * disponibilidad). Devuelve el PRIMER bloqueo: con uno alcanza para frenar el
 * envío, y listar todos los campos rotos de golpe abruma justo a quien menos
 * margen tiene.
 */
export function blockMoneyTalkIn(
  values: ReadonlyArray<string | null | undefined>,
): BlockMoneyResult {
  for (const value of values) {
    const result = blockMoneyTalk(value);
    if (!result.ok) return result;
  }
  return { ok: true };
}
