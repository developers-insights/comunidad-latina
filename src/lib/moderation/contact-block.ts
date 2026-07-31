/**
 * =============================================================================
 * BLOQUEO DE DATOS DE CONTACTO EN LA NEGOCIACIÓN (spec §6)
 * =============================================================================
 *
 * Por qué existe: en Colaboraciones el acuerdo se cierra ADENTRO. Si en la
 * propuesta se cuela un "escribime al +1 917…", la negociación se muda a un
 * canal donde no hay contrato, no hay historial y no hay a quién reclamarle.
 * Las dos partes pierden — y la que más pierde es la que menos experiencia
 * tiene. Por eso el dato se frena ANTES de enviarse, no se tacha después.
 *
 * QUÉ NO ES: no es moderación de contenido (eso es `moderateText`, que llama a
 * OpenAI y decide tiers). Esto es una regla de producto, síncrona, determinista
 * y sin red — corre igual con OpenAI caído, y por eso no vive en el mismo
 * archivo ni comparte su degradación.
 *
 * DÓNDE CORRE: en el SERVIDOR, al borde de la server action, después de Zod.
 * El cliente puede llamar a `findContactMatches` para avisar mientras se
 * escribe (es una función pura, sin `server-only`), pero el cliente nunca es la
 * frontera: quien manda un POST a mano se salta cualquier chequeo de UI.
 *
 * -----------------------------------------------------------------------------
 * DOCTRINA DE PRECISIÓN (por qué las reglas son las que son)
 *
 * Un falso positivo acá es caro de un modo particular: le rechaza el mensaje a
 * alguien que no hizo nada malo, con un cartel que insinúa que sí. Un falso
 * negativo cuesta un contacto filtrado. Preferimos fallar hacia dejar pasar en
 * los casos DUDOSOS y ser implacables en los INEQUÍVOCOS:
 *
 *  - "$800 por 3 reels" y "3 videos de 30s" NO son teléfonos. Por eso el
 *    detector de teléfono exige ≥7 dígitos y descarta lo que viene pegado a un
 *    símbolo de moneda o a una unidad.
 *  - "instagram" como palabra suelta ("hago reels para Instagram") NO es un
 *    dato de contacto; "@mimarca" y "instagram.com/mimarca" SÍ.
 *  - Ofuscaciones típicas ("arroba", "punto com", "cero uno dos") se cubren
 *    porque son intencionales: quien las escribe ya sabe que está esquivando.
 * -----------------------------------------------------------------------------
 */

/** Qué clase de dato se encontró. Gobierna el mensaje que ve la persona. */
export type ContactKind = "phone" | "email" | "link" | "handle" | "messaging";

export interface ContactMatch {
  kind: ContactKind;
  /** Fragmento exacto que disparó la regla — para resaltarlo en la UI. */
  text: string;
  /** Índice en el texto original (`text.slice(index, index + text.length)`). */
  index: number;
}

/* -------------------------------------------------------------------------- */
/* Normalización                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Homoglifos y separadores que se usan para esquivar un detector ingenuo. Se
 * traducen 1:1 (misma longitud) para que los índices del match sigan siendo
 * válidos sobre el texto ORIGINAL — que es el que ve la persona.
 */
const HOMOGLYPHS: Record<string, string> = {
  // Dígitos "fullwidth" (teclados asiáticos y copy/paste de imágenes).
  "０": "0", "１": "1", "２": "2", "３": "3", "４": "4",
  "５": "5", "６": "6", "７": "7", "８": "8", "９": "9",
  // Arrobas y puntos alternativos.
  "＠": "@", "﹫": "@", "。": ".", "．": ".", "･": ".", "・": ".",
  // Guiones tipográficos que rompen un `-` literal en la regex.
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "−": "-",
};

/** Traducción de homoglifos que PRESERVA la longitud (índices intactos). */
function normalize(input: string): string {
  let out = "";
  for (const char of input) {
    const mapped = HOMOGLYPHS[char];
    // Solo se reemplaza si mide lo mismo: si no, se pierde el alineamiento.
    out += mapped && mapped.length === char.length ? mapped : char;
  }
  return out.toLowerCase();
}

/* -------------------------------------------------------------------------- */
/* Reglas                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Cada regla es una regex `g` sobre el texto normalizado. `refine` puede
 * descartar un match (devolviendo false) mirando el contexto — es lo que salva
 * a "$800" y a "30s" de ser tomados por teléfonos.
 */
interface Rule {
  kind: ContactKind;
  pattern: RegExp;
  refine?: (match: RegExpExecArray, normalized: string) => boolean;
}

/** Dígitos de un candidato a teléfono, sin separadores. */
function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Teléfonos: mínimo 7 dígitos (el número local más corto que existe), con
 * separadores opcionales. NO alcanza con "muchos dígitos": un precio de
 * 1.500.000 tiene 7 y no es un teléfono — por eso `refine` mira qué hay
 * inmediatamente antes y después.
 */
const PHONE_PATTERN =
  /\+?\d[\d\s().-]{5,20}\d/g;

/** Símbolos y unidades que delatan que el número NO es un teléfono. */
const MONEY_PREFIX = /[$€£¥]\s*$/;
const UNIT_SUFFIX = /^\s*(?:usd|eur|dls?|dólares|dolares|pesos|%|px|k\b|mb|gb|s\b|seg|min|hs?\b|horas?|días?|dias?)/i;

function looksLikePhone(match: RegExpExecArray, normalized: string): boolean {
  const raw = match[0];
  const digits = digitsOf(raw);
  if (digits.length < 7 || digits.length > 15) return false;

  const before = normalized.slice(Math.max(0, match.index - 4), match.index);
  if (MONEY_PREFIX.test(before)) return false;

  const after = normalized.slice(match.index + raw.length, match.index + raw.length + 10);
  if (UNIT_SUFFIX.test(after)) return false;

  // Un número escrito de corrido con separadores de miles ("1.500.000") tiene
  // grupos de 3 uniformes y ningún signo de teléfono. Los teléfonos reales
  // llegan con "+", con paréntesis de área, o con grupos irregulares.
  const looksLikeThousands = /^\d{1,3}(?:[.,]\d{3})+$/.test(raw.trim());
  if (looksLikeThousands) return false;

  return true;
}

/**
 * Teléfono deletreado en palabras ("cero nueve uno uno…") — 7 números seguidos
 * en texto es una intención, no una casualidad.
 */
const SPELLED_DIGIT = "(?:cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)";
const SPELLED_PHONE_PATTERN = new RegExp(`(?:${SPELLED_DIGIT}[\\s.,-]+){6,}${SPELLED_DIGIT}`, "g");

/** Correos, incluida la ofuscación clásica "nombre arroba dominio punto com". */
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const EMAIL_OBFUSCATED_PATTERN =
  /[\w.+-]{2,}\s*(?:\(|\[)?\s*(?:arroba|at)\s*(?:\)|\])?\s*[\w-]{2,}\s*(?:\(|\[)?\s*(?:punto|dot)\s*(?:\)|\])?\s*[a-z]{2,}/g;

/**
 * Enlaces. Se exige un TLD conocido o un esquema explícito: sin eso, "node.js"
 * o "3.5" entrarían como links. Los acortadores y los invites de WhatsApp caen
 * acá y se marcan como `messaging` más abajo por su dominio.
 */
const LINK_PATTERN =
  /(?:https?:\/\/|www\.)[^\s<>"']+|\b[\w-]+\.(?:com|net|org|io|co|me|app|link|es|ar|mx|us|cl|pe|do|ve|gg|ly|be|tv|shop|store)\b(?:\/[^\s<>"']*)?/g;

/** "punto com" escrito en palabras: mismo intento, otra ortografía. */
const LINK_OBFUSCATED_PATTERN =
  /\b[\w-]{2,}\s+punto\s+(?:com|net|org|io|co|me|app|es|ar|mx)\b/g;

/**
 * Usuarios de redes. `@algo` con al menos 3 caracteres — "@" suelto o "@1" no
 * son un usuario, y en español se usa "@" para nada más.
 */
const HANDLE_PATTERN = /@[a-z0-9._]{3,30}\b/g;

/**
 * Mensajería y redes NOMBRADAS COMO CANAL. La palabra suelta no alcanza: un
 * creador dice "hago contenido para Instagram" todo el tiempo y eso es su
 * oficio, no un dato de contacto. Se exige el verbo o la preposición que la
 * convierte en una invitación a salir de acá.
 */
const MESSAGING_PATTERN =
  /\b(?:whats\s*app|wasap|wsp|telegram|signal|messenger|imessage|discord|snapchat|zelle|venmo|cashapp)\b|\b(?:escrib[ií]|mand[aá]|habl[aá]|contact[aá]|busc[aá]|segu[ií]|agreg[aá]|ll[aá]m[aá])(?:me|nos)?\s+(?:por|al|a|en)\s+(?:whats\s*app|wasap|wsp|ig|insta(?:gram)?|tik\s*tok|face(?:book)?|fb|telegram|messenger|discord|snap(?:chat)?|linkedin|x|twitter)\b/g;

const RULES: readonly Rule[] = [
  { kind: "email", pattern: EMAIL_PATTERN },
  { kind: "email", pattern: EMAIL_OBFUSCATED_PATTERN },
  { kind: "link", pattern: LINK_PATTERN },
  { kind: "link", pattern: LINK_OBFUSCATED_PATTERN },
  { kind: "messaging", pattern: MESSAGING_PATTERN },
  { kind: "handle", pattern: HANDLE_PATTERN },
  { kind: "phone", pattern: PHONE_PATTERN, refine: looksLikePhone },
  { kind: "phone", pattern: SPELLED_PHONE_PATTERN },
];

/* -------------------------------------------------------------------------- */
/* API                                                                        */
/* -------------------------------------------------------------------------- */

/** ¿Dos rangos se pisan? Un correo ya detectado no vuelve como "link". */
function overlaps(a: ContactMatch, start: number, end: number): boolean {
  const aEnd = a.index + a.text.length;
  return start < aEnd && a.index < end;
}

/**
 * Todos los datos de contacto de un texto, en orden de aparición y sin
 * solapamientos (gana la regla más específica: el orden de `RULES` manda).
 *
 * Pura y sin red: se puede llamar desde el cliente para avisar mientras se
 * escribe. La decisión de rechazar la toma el servidor con `blockContactInfo`.
 */
export function findContactMatches(input: string | null | undefined): ContactMatch[] {
  const original = (input ?? "").toString();
  if (original.trim().length === 0) return [];

  const normalized = normalize(original);
  const found: ContactMatch[] = [];

  for (const rule of RULES) {
    // Copia de la regex por llamada: `lastIndex` de una regex `g` compartida a
    // nivel de módulo es estado mutable, y hace que la segunda llamada empiece
    // donde terminó la primera (bug clásico, y silencioso).
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

export type BlockContactResult =
  | { ok: true }
  | { ok: false; kinds: ContactKind[]; matches: ContactMatch[]; message: string };

/**
 * Copy del bloqueo. NO reta ni acusa: explica el porqué en una línea y dice qué
 * hacer. Quien escribe un teléfono casi siempre está tratando de agilizar, no
 * de evadir — el mensaje tiene que tratarlo así.
 */
export const CONTACT_BLOCK_COPY = {
  title: "Dejá los datos de contacto para después",
  /** Qué se encontró, en criollo. */
  kindLabel: {
    phone: "un teléfono",
    email: "un correo",
    link: "un enlace",
    handle: "un usuario de redes",
    messaging: "una invitación a escribir por otro lado",
  } satisfies Record<ContactKind, string>,
  reason:
    "Acordar por acá es lo que te protege: queda el contrato, queda el historial y, si algo sale mal, hay a quién reclamarle. Afuera no.",
  fix: "Sacá ese dato y mandá tu mensaje — cuando cierren el trato se comparten los datos que hagan falta.",
} as const;

function humanList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

/**
 * Mensaje completo para la persona: qué encontramos, por qué no va, y qué
 * hacer. Exportado aparte para poder testearlo y para reusarlo en el aviso en
 * vivo del formulario.
 */
export function contactBlockMessage(kinds: ContactKind[]): string {
  const unique = [...new Set(kinds)];
  const labels = unique.map((kind) => CONTACT_BLOCK_COPY.kindLabel[kind]);
  return `Encontramos ${humanList(labels)} en tu mensaje. ${CONTACT_BLOCK_COPY.reason} ${CONTACT_BLOCK_COPY.fix}`;
}

/**
 * Puerta del servidor: `{ ok: false }` si el texto trae datos de contacto.
 *
 * El caller NO guarda nada y devuelve `message` tal cual — el texto ya está
 * escrito para leerse en pantalla. Se llama DESPUÉS de Zod (que ya acotó
 * longitud) y ANTES de cualquier insert.
 */
export function blockContactInfo(input: string | null | undefined): BlockContactResult {
  const matches = findContactMatches(input);
  if (matches.length === 0) return { ok: true };

  const kinds = [...new Set(matches.map((match) => match.kind))];
  return { ok: false, kinds, matches, message: contactBlockMessage(kinds) };
}

/**
 * Igual que `blockContactInfo` pero sobre varios campos (título + alcance de un
 * contrato, por ejemplo). Devuelve el primer bloqueo — con uno alcanza para
 * frenar el envío, y listar todos los campos rotos de golpe abruma.
 */
export function blockContactInfoIn(
  values: ReadonlyArray<string | null | undefined>,
): BlockContactResult {
  for (const value of values) {
    const result = blockContactInfo(value);
    if (!result.ok) return result;
  }
  return { ok: true };
}
