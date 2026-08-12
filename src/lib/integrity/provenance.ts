/**
 * =============================================================================
 * PROCEDENCIA DE ARCHIVO — metadatos del contenedor, no visión artificial
 * =============================================================================
 *
 * QUÉ ES: un parser en TS puro de los formatos de contenedor más comunes
 * (MP4/MOV vía átomos ISO-BMFF; JPEG/PNG/WebP vía sus propios segmentos) que
 * busca strings ya presentes en el archivo — el nombre del encoder, el
 * "handler", el software que grabó el EXIF — y los compara contra firmas
 * conocidas de apps de descarga/edición (TikTok, CapCut, Instagram, etc.).
 *
 * QUÉ NO ES, Y POR QUÉ ESTE PÁRRAFO IMPORTA MÁS QUE EL CÓDIGO:
 * Este módulo NUNCA se pronuncia sobre copyright. Un archivo con la firma de
 * TikTok en el encoder puede ser perfectamente legítimo (el propio autor
 * resubiendo su video) y un archivo SIN ninguna firma puede ser una descarga
 * de una plataforma que limpia metadatos a propósito. `verdict` describe
 * PROCEDENCIA TÉCNICA — "este contenedor tiene huellas de haber pasado por
 * tal app" — nunca "esto tiene/no tiene derechos". Quien consuma este
 * resultado (panel de moderación, cola humana) tiene que mantener esa
 * distinción en el copy que le muestra a la gente.
 *
 * -----------------------------------------------------------------------------
 * CUÁNTO SE LEE, Y POR QUÉ ESE NÚMERO
 * -----------------------------------------------------------------------------
 * Para MP4/MOV sólo se recorren los primeros `HEADER_WINDOW_BYTES` (256 KB) y
 * los últimos `TAIL_WINDOW_BYTES` (256 KB) del archivo — nunca el medio, que es
 * donde vive el video/audio crudo (`mdat`). El átomo `moov` (donde están todas
 * las firmas que importan) suele ir al principio, pero cuando el archivo no
 * tiene "fast start" queda al final, de ahí las dos ventanas. 512 KB en total
 * es más que suficiente para cualquier `moov` real y acota el trabajo aunque el
 * archivo pese gigabytes. Para JPEG/PNG/WebP los segmentos de metadata viven
 * siempre cerca del principio del archivo, así que alcanza con una sola
 * ventana inicial (ver cada `analyze*` para el tamaño exacto).
 *
 * -----------------------------------------------------------------------------
 * DEFENSA ANTE INPUT HOSTIL (archivos subidos por gente anónima)
 * -----------------------------------------------------------------------------
 *   · Cada lectura de tamaño/offset está acotada contra el límite del buffer
 *     ANTES de leer: nunca se indexa fuera de rango.
 *   · Un átomo con tamaño 0, negativo o menor a su propio header se trata como
 *     estructura rota: se corta esa rama (no se lanza, no se hace loop).
 *   · Hay un tope compartido de cuántos átomos se visitan en total
 *     (`MAX_BOXES_VISITED`) y de profundidad de anidamiento (`MAX_DEPTH`), para
 *     que un archivo armado a propósito con miles de átomos diminutos y
 *     anidados no cueste CPU sin límite.
 *   · `analyzeProvenanceBytes` nunca lanza: cualquier excepción inesperada cae
 *     al resultado "no analizado".
 *
 * -----------------------------------------------------------------------------
 * LÍMITES HONESTOS (lo que este enfoque NO detecta)
 * -----------------------------------------------------------------------------
 *   · Re-encoding que borra metadatos: cualquier app que vuelva a codificar el
 *     archivo (o cualquier plataforma que lo "limpie" a propósito, cosa que
 *     varias hacen) deja un contenedor sin ninguna de estas firmas. Ausencia de
 *     señales NO es evidencia de originalidad.
 *   · Grabación de pantalla: un screen recording genera un contenedor "limpio"
 *     propio del grabador (o del sistema operativo), no de la plataforma cuyo
 *     contenido se grabó. Este módulo no tiene forma de ver eso.
 *   · Capturas/recortes manuales, conversión de formato, o cualquier paso
 *     intermedio que reescriba el contenedor.
 *   · El mapeo `keys`↔`ilst` por índice numérico del formato `mdta` de Apple
 *     (usado por algunas apps para tags como `com.apple.quicktime.software`)
 *     no se resuelve: sólo se entienden los tags `ilst` con fourcc descriptivo
 *     (`©too`, `©nam`, etc.), que es el formato mayoritario en exports de apps
 *     de video de terceros.
 *   · `mimeType` es sólo un dato informativo del cliente, nunca la fuente de
 *     verdad: un cliente hostil puede mentirlo, así que el formato real se
 *     decide siempre por los bytes ("magic numbers"), nunca por ese parámetro.
 */

/** Nivel de confianza de una coincidencia con una firma conocida. */
type Confidence = "alta" | "media" | "baja";

export type ProvenanceSignal = {
  platform: string;
  /** El string exacto encontrado en el archivo que disparó la regla. */
  signal: string;
  confidence: Confidence;
  /** Dónde apareció (ej. "ftyp.major_brand", "udta>meta>ilst>©too", "exif.software"). */
  field: string;
};

export type ProvenanceResult = {
  signals: ProvenanceSignal[];
  /**
   * Derivación de `signals` (nunca al revés — ver `deriveVerdict`):
   *   · alguna señal `alta`               → "probable_descarga_de_plataforma"
   *   · sin `alta` pero hay `media`/`baja` → "sospechoso"
   *   · sin señales                        → "sin_indicios"
   */
  verdict: "sin_indicios" | "sospechoso" | "probable_descarga_de_plataforma";
  /** `major_brand` del `ftyp` (sólo MP4/MOV). null si no aplica o no se encontró. */
  containerBrand: string | null;
  /** Mejor candidato a "con qué se codificó/editó". null si no se encontró ninguno. */
  encoder: string | null;
  /** false si el formato no se reconoció o el archivo está truncado/corrupto. */
  analyzed: boolean;
};

/** Resultado degradado: nunca lanza, esto es lo que se devuelve ante cualquier fallo. */
function notAnalyzed(): ProvenanceResult {
  return { signals: [], verdict: "sin_indicios", containerBrand: null, encoder: null, analyzed: false };
}

/**
 * Punto de entrada público. Nunca lanza: ver el docblock de cabecera para el
 * porqué de cada decisión defensiva.
 */
export function analyzeProvenanceBytes(
  bytes: Uint8Array,
  // Sólo informativo — ver "LÍMITES HONESTOS" arriba. No condiciona ninguna
  // rama de detección: el formato real se decide por los bytes.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  mimeType: string,
): ProvenanceResult {
  try {
    if (!bytes || bytes.length === 0) return notAnalyzed();
    if (isIsoBmff(bytes)) return analyzeMp4(bytes);
    if (isJpeg(bytes)) return analyzeJpeg(bytes);
    if (isPng(bytes)) return analyzePng(bytes);
    if (isWebp(bytes)) return analyzeWebp(bytes);
    return notAnalyzed();
  } catch (error) {
    console.warn("[integrity] analyzeProvenanceBytes: fallo inesperado, se degrada a no analizado", {
      message: error instanceof Error ? error.message : "error desconocido",
    });
    return notAnalyzed();
  }
}

/* =============================================================================
 * REGLAS DE DETECCIÓN — el mapa string encontrado → plataforma
 * ============================================================================= */

interface Rule {
  platform: string;
  confidence: Confidence;
  test: (value: string) => boolean;
}

/** Coincidencia case-insensitive por substring. La firma más común. */
function includesCI(value: string, needle: string): boolean {
  return value.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Tabla de firmas. `alta` = el nombre literal (o casi) de la plataforma/app;
 * `media` = una marca interna/de la empresa dueña, específica pero no
 * inequívoca (ej. "ByteDance" es dueña de TikTok Y de CapCut); `baja` = una
 * señal genérica que por sí sola no alcanza (el propio pliego pide que
 * "ISO Media, MP4 v2" o "Google" solos nunca suban de baja).
 */
const RULES: Rule[] = [
  // --- TikTok --------------------------------------------------------------
  { platform: "TikTok", confidence: "alta", test: (v) => includesCI(v, "tiktok") },
  { platform: "TikTok", confidence: "alta", test: (v) => includesCI(v, "aweme") },
  { platform: "TikTok", confidence: "alta", test: (v) => includesCI(v, "musically") },
  { platform: "TikTok", confidence: "media", test: (v) => includesCI(v, "bytedance") },
  { platform: "TikTok", confidence: "media", test: (v) => v.includes("zhisheng") },

  // --- CapCut y editores emparentados ---------------------------------------
  { platform: "CapCut", confidence: "alta", test: (v) => includesCI(v, "capcut") },
  { platform: "VivaVideo", confidence: "alta", test: (v) => includesCI(v, "vivavideo") },
  { platform: "InShot", confidence: "alta", test: (v) => includesCI(v, "inshot") },
  { platform: "KineMaster", confidence: "alta", test: (v) => includesCI(v, "kinemaster") },
  { platform: "Videoleap", confidence: "alta", test: (v) => includesCI(v, "videoleap") },
  // "lv_" es el prefijo interno que CapCut/VivaVideo usan para nombrar sus
  // propios átomos/archivos temporales — específico pero corto, de ahí `media`.
  { platform: "CapCut", confidence: "media", test: (v) => v.startsWith("lv_") },

  // --- Instagram / Facebook --------------------------------------------------
  { platform: "Instagram", confidence: "alta", test: (v) => includesCI(v, "instagram") },
  // FBMD: marcador propio del pipeline de re-encoding de Meta. Aparece tanto
  // en MP4 (udta) como en JPEG (APPn) — de ahí que el pliego lo mencione en los
  // dos formatos.
  { platform: "Facebook", confidence: "alta", test: (v) => v.includes("FBMD") },
  { platform: "Facebook", confidence: "media", test: (v) => includesCI(v, "facebook") },

  // --- YouTube (deliberadamente débil, ver el pliego) -----------------------
  { platform: "YouTube", confidence: "baja", test: (v) => includesCI(v, "google") },
  {
    platform: "YouTube",
    confidence: "baja",
    test: (v) => includesCI(v, "ISO Media, MP4 v2 [ISO 14496-14]"),
  },

  // --- Otras plataformas con firma clara -------------------------------------
  { platform: "Snapchat", confidence: "alta", test: (v) => includesCI(v, "snapchat") },
  { platform: "Likee", confidence: "alta", test: (v) => includesCI(v, "likee") },
  { platform: "Triller", confidence: "alta", test: (v) => includesCI(v, "triller") },
  { platform: "Clipchamp", confidence: "alta", test: (v) => includesCI(v, "clipchamp") },
];

/** Corre todas las reglas contra todos los strings encontrados. Deduplica. */
function matchSignatures(hits: StringHit[]): ProvenanceSignal[] {
  const seen = new Set<string>();
  const out: ProvenanceSignal[] = [];
  for (const hit of hits) {
    for (const rule of RULES) {
      if (!rule.test(hit.value)) continue;
      const key = `${rule.platform}|${rule.confidence}|${hit.field}|${hit.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ platform: rule.platform, signal: hit.value, confidence: rule.confidence, field: hit.field });
    }
  }
  return out;
}

/** La regla de negocio del veredicto, documentada una sola vez (ver el tipo). */
function deriveVerdict(signals: ProvenanceSignal[]): ProvenanceResult["verdict"] {
  if (signals.some((s) => s.confidence === "alta")) return "probable_descarga_de_plataforma";
  if (signals.length > 0) return "sospechoso";
  return "sin_indicios";
}

/** Campos por los que se busca el "encoder", en orden de preferencia. */
const ENCODER_FIELD_PRIORITY = ["©too", "hdlr", "©enc", "©swr", "exif.software"];

function pickEncoder(hits: StringHit[]): string | null {
  for (const key of ENCODER_FIELD_PRIORITY) {
    const hit = hits.find((h) => h.field === key || h.field.endsWith(">" + key));
    if (hit) return hit.value;
  }
  return null;
}

/** Un string encontrado en el archivo, con dónde apareció. */
interface StringHit {
  field: string;
  value: string;
}

/* =============================================================================
 * UTILIDADES DE BYTES — compartidas entre los cuatro formatos
 * ============================================================================= */

/** Decodifica un rango como Latin-1 (1 byte = 1 char). Nunca lanza. */
function latin1Slice(bytes: Uint8Array, start: number, end: number): string {
  const safeStart = Math.max(0, start);
  const safeEnd = Math.min(bytes.length, end);
  let out = "";
  for (let i = safeStart; i < safeEnd; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

let sharedUtf8Decoder: TextDecoder | null = null;
function utf8Slice(bytes: Uint8Array, start: number, end: number): string {
  const safeStart = Math.max(0, start);
  const safeEnd = Math.min(bytes.length, end);
  if (safeEnd <= safeStart) return "";
  sharedUtf8Decoder ??= new TextDecoder("utf-8", { fatal: false });
  return sharedUtf8Decoder.decode(bytes.subarray(safeStart, safeEnd));
}

/**
 * Extrae corridas de bytes ASCII imprimibles (0x20–0x7E) de largo >= minLen.
 * Es el mismo criterio que usa cualquier utilidad tipo `strings(1)`: no le
 * importa la semántica del contenedor, así que sirve tanto de extractor
 * principal (JPEG APPn, PNG tEXt) como de red de contención cuando la
 * estructura de un átomo MP4 no se pudo interpretar con precisión.
 */
function extractPrintableStrings(bytes: Uint8Array, start: number, end: number, minLen = 4): string[] {
  const out: string[] = [];
  const safeStart = Math.max(0, start);
  const safeEnd = Math.min(bytes.length, end);
  let runStart = -1;
  for (let i = safeStart; i <= safeEnd; i += 1) {
    const b = i < safeEnd ? bytes[i] : -1;
    const printable = b >= 0x20 && b <= 0x7e;
    if (printable) {
      if (runStart === -1) runStart = i;
    } else if (runStart !== -1) {
      if (i - runStart >= minLen) out.push(latin1Slice(bytes, runStart, i));
      runStart = -1;
    }
  }
  return out;
}

function pushStrings(hits: StringHit[], bytes: Uint8Array, start: number, end: number, field: string): void {
  for (const value of extractPrintableStrings(bytes, start, end)) hits.push({ field, value });
}

/* =============================================================================
 * MP4 / MOV — recorrido de átomos ISO-BMFF
 * ============================================================================= */

const HEADER_WINDOW_BYTES = 256 * 1024;
const TAIL_WINDOW_BYTES = 256 * 1024;
/** Tope de átomos visitados en TODO el recorrido (ambas ventanas, toda la recursión). */
const MAX_BOXES_VISITED = 5000;
/** Tope de anidamiento. Ningún contenedor real baja tan hondo; existe contra input adversario. */
const MAX_DEPTH = 12;

/** Contenedores "planos" (sin header propio) que vale la pena recorrer. */
const KNOWN_CONTAINERS = new Set(["moov", "trak", "mdia", "udta", "ilst", "edts"]);

function isIsoBmff(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && decodeBoxType(bytes, 4) === "ftyp";
}

/** 4 bytes de tipo de átomo → string, o null si no son válidos (no imprimibles). */
function decodeBoxType(bytes: Uint8Array, offset: number): string | null {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  let out = "";
  for (let i = 0; i < 4; i += 1) {
    const b = bytes[offset + i];
    if (b === 0xa9) out += "©"; // el © de los tags iTunes-style (©too, ©nam, ...)
    else if (b >= 0x20 && b <= 0x7e) out += String.fromCharCode(b);
    else return null;
  }
  return out;
}

interface BoxHeader {
  type: string;
  bodyStart: number;
  bodyEnd: number;
}

/**
 * Lee el header de UN átomo en `offset`. Devuelve null ante cualquier
 * estructura inválida (tamaño menor al header, que se salga de `limit`, tipo
 * no imprimible, largesize que no entra en un `number` seguro) — nunca lanza.
 */
function readBoxHeader(view: DataView, bytes: Uint8Array, offset: number, limit: number): BoxHeader | null {
  if (offset + 8 > limit) return null;
  const size32 = view.getUint32(offset, false);
  const type = decodeBoxType(bytes, offset + 4);
  if (type === null) return null;

  let headerSize = 8;
  let boxSize: number;
  if (size32 === 1) {
    // largesize: 8 bytes big-endian justo después del header de 8 bytes.
    if (offset + 16 > limit) return null;
    const hi = view.getUint32(offset + 8, false);
    const lo = view.getUint32(offset + 12, false);
    // Si el tamaño no entra en un entero seguro de JS, se trata como
    // inválido: mejor cortar acá que operar con un número que perdió precisión.
    if (hi > 0x1fffff) return null;
    boxSize = hi * 0x100000000 + lo;
    headerSize = 16;
  } else if (size32 === 0) {
    // "se extiende hasta el final" — acá, hasta el final de la VENTANA que
    // estamos leyendo (no del archivo real, que puede ser mucho más grande).
    boxSize = limit - offset;
  } else {
    boxSize = size32;
  }

  if (boxSize < headerSize) return null; // más chico que su propio header: roto
  const boxEnd = offset + boxSize;
  if (boxEnd > limit || boxEnd <= offset) return null; // se sale de la ventana, o no avanza

  return { type, bodyStart: offset + headerSize, bodyEnd: boxEnd };
}

/** ¿El contenido en `offset` arranca con un header de átomo válido? Heurística de "¿esto es un contenedor?". */
function looksLikeNestedBox(view: DataView, bytes: Uint8Array, offset: number, limit: number): boolean {
  return readBoxHeader(view, bytes, offset, limit) !== null;
}

interface Budget {
  count: number;
}

/** Itera los átomos hermanos en [start, end). Nunca hace loop infinito: cada átomo avanza >= 8 bytes. */
function* iterateBoxes(
  view: DataView,
  bytes: Uint8Array,
  start: number,
  end: number,
  budget: Budget,
): Generator<BoxHeader> {
  let offset = start;
  while (offset + 8 <= end) {
    if (budget.count >= MAX_BOXES_VISITED) return;
    budget.count += 1;
    const header = readBoxHeader(view, bytes, offset, end);
    if (!header) return; // estructura rota: se corta esta rama, no se asume nada más
    yield header;
    offset = header.bodyEnd;
  }
}

interface FtypInfo {
  majorBrand: string;
  compatibleBrands: string[];
}

function parseFtyp(bytes: Uint8Array, start: number, end: number): FtypInfo | null {
  if (end - start < 8) return null;
  const majorBrand = latin1Slice(bytes, start, start + 4).replace(/\0+$/, "").trim();
  if (!majorBrand) return null;
  const compatibleBrands: string[] = [];
  let offset = start + 8; // salta major_brand(4) + minor_version(4)
  // Tope defensivo: un ftyp real nunca declara decenas de brands.
  while (offset + 4 <= end && compatibleBrands.length < 32) {
    const brand = latin1Slice(bytes, offset, offset + 4).replace(/\0+$/, "").trim();
    if (brand) compatibleBrands.push(brand);
    offset += 4;
  }
  return { majorBrand, compatibleBrands };
}

/**
 * Recorre un contenedor y sus hijos, acumulando strings de interés en `hits`.
 *
 * La decisión de "qué se recorre y qué no" es deliberada: `mdat` (el payload
 * crudo de audio/video, casi siempre la mayor parte del archivo) NUNCA se
 * recorre ni se escanea — bajar ahí sería caro y, peor, arriesgaría falsos
 * positivos por coincidencias casuales en datos binarios comprimidos. Al nivel
 * superior (depth 0) sólo se baja a `moov`; el resto de los átomos de primer
 * nivel que no sean `ftyp`/`free`/`skip` se ignoran sin descender.
 */
function walkContainer(
  view: DataView,
  bytes: Uint8Array,
  start: number,
  end: number,
  path: string[],
  depth: number,
  budget: Budget,
  hits: StringHit[],
  ftypOut: { value: FtypInfo | null },
): void {
  if (depth > MAX_DEPTH) return;

  for (const header of iterateBoxes(view, bytes, start, end, budget)) {
    const { type, bodyStart, bodyEnd } = header;
    const newPath = [...path, type];

    if (depth === 0 && type === "ftyp") {
      if (!ftypOut.value) ftypOut.value = parseFtyp(bytes, bodyStart, bodyEnd);
      continue;
    }
    if (type === "mdat") continue; // payload crudo: nunca se toca
    if (type === "mvhd") continue; // binario puro (timestamps/matriz), sin texto útil
    if (type === "free" || type === "skip") {
      pushStrings(hits, bytes, bodyStart, bodyEnd, newPath.join(">"));
      continue;
    }
    if (type === "hdlr") {
      pushStrings(hits, bytes, bodyStart, bodyEnd, "hdlr");
      continue;
    }
    if (type === "data") {
      // Formato iTunes-style: 4 bytes de "type indicator" + 4 de locale, y
      // recién ahí el texto. El campo se etiqueta con el TAG padre (ej.
      // "udta>meta>ilst>©too"), no con "data", que no dice nada por sí solo.
      const parentField = path.length ? path.join(">") : "data";
      pushStrings(hits, bytes, Math.min(bodyStart + 8, bodyEnd), bodyEnd, parentField);
      continue;
    }
    if (type === "meta") {
      // Ambigüedad real del formato: ISO-BMFF define `meta` como "full box"
      // (4 bytes de version+flags antes de los hijos); QuickTime clásico lo
      // usa como box plano. Se prueba la interpretación ISO primero (la más
      // común en exports de apps modernas) y se cae a la plana si no valida.
      if (looksLikeNestedBox(view, bytes, bodyStart + 4, bodyEnd)) {
        walkContainer(view, bytes, bodyStart + 4, bodyEnd, newPath, depth + 1, budget, hits, ftypOut);
      } else if (looksLikeNestedBox(view, bytes, bodyStart, bodyEnd)) {
        walkContainer(view, bytes, bodyStart, bodyEnd, newPath, depth + 1, budget, hits, ftypOut);
      } else {
        pushStrings(hits, bytes, bodyStart, bodyEnd, newPath.join(">"));
      }
      continue;
    }
    if (KNOWN_CONTAINERS.has(type)) {
      walkContainer(view, bytes, bodyStart, bodyEnd, newPath, depth + 1, budget, hits, ftypOut);
      continue;
    }
    if (depth === 0) continue; // átomo de primer nivel no reconocido: se ignora sin bajar

    // Átomo desconocido dentro de un árbol que YA nos interesa (udta/meta/ilst
    // en adelante): puede ser un item `ilst` (ej. "©too") que envuelve un
    // "data", o puede ser texto plano (convención QuickTime clásica, sin
    // envoltorio). Si su contenido arranca con un header de átomo válido se
    // sigue bajando; si no, se lo trata como hoja de texto.
    if (looksLikeNestedBox(view, bytes, bodyStart, bodyEnd)) {
      walkContainer(view, bytes, bodyStart, bodyEnd, newPath, depth + 1, budget, hits, ftypOut);
    } else {
      pushStrings(hits, bytes, bodyStart, bodyEnd, newPath.join(">"));
    }
  }
}

/**
 * Recorre el archivo completo (ventana de cabecera + ventana de cola).
 * Devuelve null si el archivo es "basura"/truncado: ni siquiera el primer
 * átomo (`ftyp`, obligatorio como primer átomo de un ISO-BMFF válido) entra
 * completo dentro del buffer disponible.
 */
function collectMp4Strings(bytes: Uint8Array): { hits: StringHit[]; majorBrand: string | null } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const firstHeader = readBoxHeader(view, bytes, 0, bytes.length);
  if (!firstHeader || firstHeader.type !== "ftyp") return null;

  const hits: StringHit[] = [];
  const ftypOut: { value: FtypInfo | null } = { value: null };
  const budget: Budget = { count: 0 };

  const headerEnd = Math.min(bytes.length, HEADER_WINDOW_BYTES);
  walkContainer(view, bytes, 0, headerEnd, [], 0, budget, hits, ftypOut);

  if (bytes.length > HEADER_WINDOW_BYTES) {
    const tailStart = Math.max(headerEnd, bytes.length - TAIL_WINDOW_BYTES);
    // Segunda pasada, como si fuera otro archivo top-level: existe para
    // encontrar un `moov` que haya quedado al final (sin "fast start").
    walkContainer(view, bytes, tailStart, bytes.length, [], 0, budget, hits, ftypOut);
  }

  return { hits, majorBrand: ftypOut.value?.majorBrand ?? null };
}

function analyzeMp4(bytes: Uint8Array): ProvenanceResult {
  const collected = collectMp4Strings(bytes);
  if (!collected) return notAnalyzed(); // truncado o basura: no se pudo ni leer el primer átomo

  const signals = matchSignatures(collected.hits);
  return {
    signals,
    verdict: deriveVerdict(signals),
    containerBrand: collected.majorBrand,
    encoder: pickEncoder(collected.hits),
    analyzed: true,
  };
}

/* =============================================================================
 * JPEG — segmentos APPn, con parsing estructurado de EXIF (APP1)
 * ============================================================================= */

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isAsciiPrefix(bytes: Uint8Array, start: number, end: number, prefix: string): boolean {
  if (start + prefix.length > end || start + prefix.length > bytes.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[start + i] !== prefix.charCodeAt(i)) return false;
  }
  return true;
}

/** Umbral a partir del cual la AUSENCIA de EXIF se registra como señal débil. Ver el docblock de `analyzeJpeg`. */
const NO_EXIF_SIZE_THRESHOLD_BYTES = 100 * 1024;

const EXIF_ASCII_TAGS: Record<number, string> = {
  0x010f: "exif.make",
  0x0110: "exif.model",
  0x0131: "exif.software",
};

/**
 * Lee los tags ASCII conocidos (Make/Model/Software) de un bloque TIFF/EXIF
 * que arranca en `tiffStart`. Nunca lanza: cualquier offset fuera de rango
 * simplemente hace que se descarte esa entrada, no que se lance una excepción.
 */
function readExifAsciiTags(bytes: Uint8Array, tiffStart: number, limit: number, hits: StringHit[]): void {
  if (tiffStart + 8 > limit || tiffStart < 0) return;
  const b0 = bytes[tiffStart];
  const b1 = bytes[tiffStart + 1];
  let little: boolean;
  if (b0 === 0x49 && b1 === 0x49) little = true;
  else if (b0 === 0x4d && b1 === 0x4d) little = false;
  else return; // no arranca con "II" ni "MM": no es un TIFF válido

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(tiffStart + 2, little) !== 42) return;

  const ifdOffset = tiffStart + view.getUint32(tiffStart + 4, little);
  if (ifdOffset < tiffStart || ifdOffset + 2 > limit) return;

  const entryCount = Math.min(view.getUint16(ifdOffset, little), 200); // tope defensivo
  for (let i = 0; i < entryCount; i += 1) {
    const entryOffset = ifdOffset + 2 + i * 12;
    if (entryOffset + 12 > limit) break;

    const tag = view.getUint16(entryOffset, little);
    const fieldType = view.getUint16(entryOffset + 2, little);
    const field = EXIF_ASCII_TAGS[tag];
    if (!field || fieldType !== 2) continue; // sólo interesan strings ASCII en tags conocidos

    const valueCount = view.getUint32(entryOffset + 4, little);
    const dataOffset = valueCount <= 4 ? entryOffset + 8 : tiffStart + view.getUint32(entryOffset + 8, little);
    const dataEnd = Math.min(dataOffset + valueCount, limit);
    if (dataOffset < 0 || dataOffset >= limit || dataEnd <= dataOffset) continue;

    const value = latin1Slice(bytes, dataOffset, dataEnd).replace(/\0+$/, "").trim();
    if (value) hits.push({ field, value });
  }
}

function analyzeJpeg(bytes: Uint8Array): ProvenanceResult {
  const hits: StringHit[] = [];
  let hasExif = false;

  // Las marcas de metadata (APPn) viven siempre pegadas al principio, antes
  // del SOS (inicio de los datos de imagen comprimidos). 1 MB da margen de
  // sobra sin tener que recorrer fotos de decenas de MB byte a byte.
  const limit = Math.min(bytes.length, 1024 * 1024);
  let offset = 2; // después del SOI (0xFFD8)
  let segments = 0;
  const MAX_SEGMENTS = 500;

  while (offset + 4 <= limit && segments < MAX_SEGMENTS) {
    segments += 1;
    if (bytes[offset] !== 0xff) break; // estructura rota: se corta, no se lanza
    const marker = bytes[offset + 1];
    offset += 2;

    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // sin payload
    if (marker === 0xda || marker === 0xd9) break; // Start of Scan / End of Image: no hay más metadata

    if (offset + 2 > limit) break;
    const segLen = (bytes[offset] << 8) | bytes[offset + 1]; // BE, incluye los 2 bytes de longitud
    if (segLen < 2) break;
    const dataStart = offset + 2;
    const dataEnd = Math.min(offset + segLen, limit);
    if (dataStart > dataEnd) break;

    if (marker === 0xe1) {
      // APP1: casi siempre Exif o XMP.
      if (isAsciiPrefix(bytes, dataStart, dataEnd, "Exif")) {
        hasExif = true;
        readExifAsciiTags(bytes, dataStart + 6, dataEnd, hits); // +6 = "Exif\0\0"
      } else {
        pushStrings(hits, bytes, dataStart, dataEnd, "jpeg.app1");
      }
    } else if (marker >= 0xe0 && marker <= 0xef) {
      pushStrings(hits, bytes, dataStart, dataEnd, `jpeg.app${marker - 0xe0}`);
    } else if (marker === 0xfe) {
      pushStrings(hits, bytes, dataStart, dataEnd, "jpeg.comment");
    }

    offset = dataEnd;
  }

  const signals = matchSignatures(hits);

  // Señal débil: un JPEG "grande" sin NINGÚN EXIF. Documentado en la cabecera
  // del módulo y acá otra vez porque es el punto más fácil de malinterpretar:
  // muchísimas plataformas legítimas borran EXIF al re-comprimir por razones
  // de privacidad/peso, así que esto NO prueba re-encoding ni descarga — sólo
  // es un dato más, y por eso nunca sube de `baja`.
  if (!hasExif && bytes.length > NO_EXIF_SIZE_THRESHOLD_BYTES) {
    signals.push({
      platform: "desconocida",
      signal: "sin-metadata-exif",
      confidence: "baja",
      field: "jpeg",
    });
  }

  return {
    signals,
    verdict: deriveVerdict(signals),
    containerBrand: null,
    encoder: pickEncoder(hits),
    analyzed: true,
  };
}

/* =============================================================================
 * PNG — chunks tEXt / iTXt
 * ============================================================================= */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i += 1) if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  return true;
}

function findNul(bytes: Uint8Array, start: number, end: number): number {
  for (let i = start; i < end; i += 1) if (bytes[i] === 0) return i;
  return -1;
}

function parseTextChunk(bytes: Uint8Array, start: number, end: number, hits: StringHit[]): void {
  const sep = findNul(bytes, start, end);
  if (sep === -1) return;
  const keyword = latin1Slice(bytes, start, sep) || "texto";
  const text = latin1Slice(bytes, sep + 1, end).trim();
  if (text) hits.push({ field: `png.text.${keyword}`, value: text });
}

/** iTXt sin comprimir (compression flag = 0). El comprimido queda sin leer: ver límites en la cabecera. */
function parseItxtChunk(bytes: Uint8Array, start: number, end: number, hits: StringHit[]): void {
  let p = start;
  const kwEnd = findNul(bytes, p, end);
  if (kwEnd === -1) return;
  const keyword = latin1Slice(bytes, p, kwEnd) || "texto";
  p = kwEnd + 1;
  if (p + 2 > end) return;
  const compressed = bytes[p] === 1;
  p += 2; // compression flag + compression method
  const langEnd = findNul(bytes, p, end);
  if (langEnd === -1) return;
  p = langEnd + 1;
  const trKwEnd = findNul(bytes, p, end);
  if (trKwEnd === -1) return;
  p = trKwEnd + 1;
  if (compressed) return; // sin zlib disponible sin agregar dependencia: se omite, no se inventa el texto
  const text = utf8Slice(bytes, p, end).trim();
  if (text) hits.push({ field: `png.itxt.${keyword}`, value: text });
}

function analyzePng(bytes: Uint8Array): ProvenanceResult {
  const hits: StringHit[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8; // después de la firma
  let chunks = 0;
  const MAX_CHUNKS = 2000;

  while (offset + 8 <= bytes.length && chunks < MAX_CHUNKS) {
    chunks += 1;
    const length = view.getUint32(offset, false);
    const type = latin1Slice(bytes, offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (length < 0 || dataEnd > bytes.length || dataEnd < dataStart) break; // corrupto/truncado

    if (type === "tEXt") parseTextChunk(bytes, dataStart, dataEnd, hits);
    else if (type === "iTXt") parseItxtChunk(bytes, dataStart, dataEnd, hits);
    else if (type === "IEND") break;

    offset = dataEnd + 4; // +4 por el CRC del chunk
  }

  const signals = matchSignatures(hits);
  return {
    signals,
    verdict: deriveVerdict(signals),
    containerBrand: null,
    encoder: pickEncoder(hits),
    analyzed: true,
  };
}

/* =============================================================================
 * WebP — chunks RIFF, mejor esfuerzo (EXIF + XMP)
 * ============================================================================= */

function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  return (
    latin1Slice(bytes, 0, 4) === "RIFF" &&
    latin1Slice(bytes, 8, 12) === "WEBP"
  );
}

function analyzeWebp(bytes: Uint8Array): ProvenanceResult {
  const hits: StringHit[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12; // "RIFF"(4) + tamaño(4) + "WEBP"(4)
  let chunks = 0;
  const MAX_CHUNKS = 500;

  while (offset + 8 <= bytes.length && chunks < MAX_CHUNKS) {
    chunks += 1;
    const fourcc = latin1Slice(bytes, offset, offset + 4);
    const size = view.getUint32(offset + 4, true); // RIFF es little-endian
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    if (size < 0 || dataEnd > bytes.length || dataEnd < dataStart) break;

    if (fourcc === "EXIF") {
      const tiffStart = isAsciiPrefix(bytes, dataStart, dataEnd, "Exif") ? dataStart + 6 : dataStart;
      readExifAsciiTags(bytes, tiffStart, dataEnd, hits);
    } else if (fourcc === "XMP ") {
      pushStrings(hits, bytes, dataStart, dataEnd, "webp.xmp");
    }

    offset = dataEnd + (size % 2); // los chunks RIFF se alinean a tamaño par
  }

  const signals = matchSignatures(hits);
  return {
    signals,
    verdict: deriveVerdict(signals),
    containerBrand: null,
    encoder: pickEncoder(hits),
    analyzed: true,
  };
}
