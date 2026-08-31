/**
 * EMOJIS PROPIOS DE LA COMUNIDAD — contrato puro (migración 0125).
 *
 * Sin DOM y sin Supabase: lo importan por igual la server action, el picker,
 * el editor de fotos, el horneado en canvas y el renderer del comentario. Es
 * el mismo reparto que hace `audio-track.ts` con la música, y por el mismo
 * motivo: si cada superficie arma la URL o decide qué categoría existe por su
 * cuenta, en algún momento dos de ellas dejan de coincidir y nadie se entera
 * hasta que un usuario ve un cuadrito roto.
 *
 * ─── UN CATÁLOGO, TRES SUPERFICIES ─────────────────────────────────────────
 * El mismo emoji tiene que poder aparecer en tres lugares que no se parecen en
 * nada, y cada uno lo consume distinto:
 *
 *   · EDITOR DE FOTOS — se dibuja en un `<canvas>` y se QUEMA en el JPEG
 *     (`bake-photo.ts`). Necesita la URL del archivo y que se pueda cargar sin
 *     ensuciar el canvas (ver `sticker-image.ts`).
 *   · COMENTARIOS — el cuerpo del comentario es TEXTO (`comments.body`), así
 *     que el emoji viaja como CÓDIGO CORTO `:slug:` y se cambia por la imagen
 *     al pintar. De ahí `parseEmojiText`.
 *   · REACCIONES — `reactions.kind` es texto sin CHECK, así que la reacción se
 *     guarda como el mismo `:slug:`. Nada que migrar del lado de la base.
 *
 * El código corto es lo que hace que las tres puedan compartir catálogo: es un
 * identificador que entra en una columna de texto, en una URL y en un
 * `aria-label` sin transformarse.
 */

// ---------------------------------------------------------------------------
// Bucket y URL pública
// ---------------------------------------------------------------------------

/** Bucket público de la 0125. */
export const COMMUNITY_EMOJI_BUCKET = "community-emojis";

/**
 * Path de storage → URL pública. Espejo exacto de `musicTrackUrl`
 * (lib/media/audio-track.ts): el bucket es público y la app arma la URL contra
 * `/storage/v1/object/public/…`, endpoint que no consulta RLS.
 *
 * Si ya viene una URL absoluta se respeta tal cual — así los assets de prueba
 * y un futuro CDN entran sin tocar nada.
 */
export function communityEmojiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/${COMMUNITY_EMOJI_BUCKET}/${path}`;
}

// ---------------------------------------------------------------------------
// Categorías — espejan el CHECK de la 0125
// ---------------------------------------------------------------------------

/**
 * Espeja el check `category` de `community_emojis`. El orden ES el orden de
 * las pestañas del picker: se entra saludando.
 */
export const COMMUNITY_EMOJI_CATEGORIES = [
  "saludos",
  "expresiones",
  "animo",
  "fiesta",
  "comida",
  "general",
] as const;

export type CommunityEmojiCategory = (typeof COMMUNITY_EMOJI_CATEGORIES)[number];

/**
 * Nombre de la pestaña. Español neutro y corto: son etiquetas que se leen de
 * reojo mientras el pulgar ya está deslizando, no títulos.
 */
export const COMMUNITY_EMOJI_CATEGORY_LABELS: Record<CommunityEmojiCategory, string> = {
  saludos: "Saludos",
  expresiones: "Dichos",
  animo: "Ánimo",
  fiesta: "Fiesta",
  comida: "Comida",
  general: "Varios",
};

/** Una categoría desconocida (fila más nueva que este build) cae en 'general'. */
export function resolveCommunityEmojiCategory(raw: string): CommunityEmojiCategory {
  return (COMMUNITY_EMOJI_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as CommunityEmojiCategory)
    : "general";
}

// ---------------------------------------------------------------------------
// La ficha, tal como la usa la app
// ---------------------------------------------------------------------------

export interface CommunityEmoji {
  id: string;
  /** Código corto sin los dos puntos: `klk`. */
  slug: string;
  /** Cómo se llama en el pack ("KLK"). Se BUSCA por acá. */
  label: string;
  /** Qué se ve en el dibujo. Es el `alt` real de la imagen. */
  alt: string;
  /** URL pública ya resuelta. */
  url: string;
  category: CommunityEmojiCategory;
  /**
   * De dónde sale: del catálogo de la plataforma o de esta comunidad. Lo
   * necesita `indexBySlug` para resolver un slug repetido, y el picker para no
   * mostrar dos veces el mismo código corto.
   */
  scope: "global" | "comunidad";
}

/** Fila cruda de `community_emojis`, tal como la devuelve PostgREST. */
export interface CommunityEmojiRow {
  id: string;
  tenant_id: string | null;
  slug: string;
  label: string;
  alt_text: string;
  storage_path: string;
  category: string;
}

/** Las columnas que pide cualquiera de los dos caminos de lectura. */
export const COMMUNITY_EMOJI_COLUMNS =
  "id, tenant_id, slug, label, alt_text, storage_path, category";

/**
 * Fila → ficha de la app. Puro y compartido entre la server action (picker) y
 * la consulta del servidor (renderer): dos mapeos distintos sobre las mismas
 * columnas es cómo se llega a que el picker muestre un alt y el comentario
 * otro.
 */
export function toCommunityEmoji(row: CommunityEmojiRow): CommunityEmoji {
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    alt: row.alt_text,
    url: communityEmojiUrl(row.storage_path),
    category: resolveCommunityEmojiCategory(row.category),
    scope: row.tenant_id === null ? "global" : "comunidad",
  };
}

// ---------------------------------------------------------------------------
// El código corto
// ---------------------------------------------------------------------------

/** `klk` → `:klk:`. Un solo lugar arma esta cadena. */
export function emojiShortcode(slug: string): string {
  return `:${slug}:`;
}

/**
 * Reconoce un código corto dentro de un texto. Es DELIBERADAMENTE el mismo
 * formato que acepta el check de `slug` en la 0125 (minúsculas, dígitos y
 * guiones internos): si acá fuera más permisivo, el parseo encontraría códigos
 * que la base no puede contener y quedarían siempre sin resolver.
 *
 * `[a-z0-9]` sin acentos ni `ñ` a propósito: el slug es un identificador, no
 * el nombre. "CHÉVERE" es el `label`; su slug es `chevere`.
 */
const SHORTCODE_RE = /:([a-z0-9]+(?:-[a-z0-9]+)*):/g;

/**
 * Cuántos emojis se pintan como imagen en UN texto. Más allá de esto los
 * códigos restantes se dejan como texto.
 *
 * Es un freno de rendimiento, no de estilo: un comentario de 1000 caracteres
 * lleno de códigos podría pedir cien imágenes en una lista que ya scrollea, y
 * hay un reclamo abierto del cliente por lentitud. Veinte es más de lo que
 * nadie escribe de verdad y acota el peor caso a algo que se puede sostener.
 */
export const MAX_EMOJIS_IN_TEXT = 20;

export type EmojiTextSegment =
  | { kind: "text"; text: string }
  | { kind: "emoji"; emoji: CommunityEmoji };

/**
 * Parte un texto en tramos de texto plano y emojis resueltos.
 *
 * Un código que NO está en el catálogo —porque se apagó, porque es de otra
 * comunidad, porque alguien lo escribió a mano— vuelve como TEXTO tal cual se
 * escribió. Nunca desaparece: borrar del mensaje algo que la persona tipeó es
 * peor que mostrar `:loquesea:`.
 */
export function parseEmojiText(
  text: string,
  bySlug: ReadonlyMap<string, CommunityEmoji>,
): EmojiTextSegment[] {
  if (!text) return [];
  if (bySlug.size === 0) return [{ kind: "text", text }];

  const segments: EmojiTextSegment[] = [];
  let cursor = 0;
  let painted = 0;

  // `matchAll` sobre una regex con /g: no hay `lastIndex` compartido entre
  // llamadas, que es la trampa clásica de reusar una regex global de módulo.
  for (const match of text.matchAll(SHORTCODE_RE)) {
    const emoji = bySlug.get(match[1] ?? "");
    if (!emoji || painted >= MAX_EMOJIS_IN_TEXT) continue;

    const start = match.index ?? 0;
    if (start > cursor) segments.push({ kind: "text", text: text.slice(cursor, start) });
    segments.push({ kind: "emoji", emoji });
    cursor = start + match[0].length;
    painted += 1;
  }

  if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });
  return segments;
}

/**
 * Catálogo → índice por código corto, para el renderer.
 *
 * RESUELVE EL EMPATE A FAVOR DE LA COMUNIDAD. Los índices únicos parciales de
 * la 0125 permiten a propósito que un tenant repita un slug global: así una
 * comunidad cambia el dibujo de `:klk:` por el suyo sin tocar el catálogo de
 * todas. Ese permiso sólo sirve si acá el de la comunidad GANA — con el orden
 * al revés, el emoji propio nunca se vería y el permiso sería decorativo.
 */
export function indexBySlug(
  emojis: readonly CommunityEmoji[],
): ReadonlyMap<string, CommunityEmoji> {
  const map = new Map<string, CommunityEmoji>();
  for (const emoji of emojis) {
    const previo = map.get(emoji.slug);
    if (previo && previo.scope === "comunidad" && emoji.scope === "global") continue;
    map.set(emoji.slug, emoji);
  }
  return map;
}

/**
 * Catálogo → pestañas del picker. SÓLO las categorías que tienen algo: un
 * catálogo a medio cargar no puede pintar cinco pestañas vacías para que
 * alguien las recorra una por una buscando dónde están los dibujos.
 *
 * Respeta el orden de `COMMUNITY_EMOJI_CATEGORIES` y, dentro de cada una, el
 * orden en que vino la lista (la consulta ya ordena por `sort_order, label`).
 */
export function groupByCategory(
  emojis: readonly CommunityEmoji[],
): Array<{ category: CommunityEmojiCategory; label: string; emojis: CommunityEmoji[] }> {
  const buckets = new Map<CommunityEmojiCategory, CommunityEmoji[]>();
  for (const emoji of emojis) {
    const list = buckets.get(emoji.category);
    if (list) list.push(emoji);
    else buckets.set(emoji.category, [emoji]);
  }

  return COMMUNITY_EMOJI_CATEGORIES.flatMap((category) => {
    const list = buckets.get(category);
    if (!list?.length) return [];
    return [{ category, label: COMMUNITY_EMOJI_CATEGORY_LABELS[category], emojis: list }];
  });
}

/**
 * Filtro del buscador del picker. Busca por NOMBRE y por CÓDIGO: quien conoce
 * el pack escribe "KLK" y quien ya lo usó una vez escribe "klk". Sin acentos
 * de por medio —"chevere" encuentra "CHÉVERE"— porque nadie va a escribir la
 * tilde en un buscador de emojis con el pulgar.
 */
export function filterEmojis(
  emojis: readonly CommunityEmoji[],
  query: string,
): CommunityEmoji[] {
  const needle = foldText(query);
  if (!needle) return [...emojis];
  return emojis.filter(
    (emoji) => foldText(emoji.label).includes(needle) || emoji.slug.includes(needle),
  );
}

/** Minúsculas y sin diacríticos. `NFD` + descarte de marcas combinantes. */
function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// ---------------------------------------------------------------------------
// Los emojis de siempre (Unicode)
// ---------------------------------------------------------------------------

/**
 * LOS CLÁSICOS, los del teclado. Vive acá y no en `media/photo-overlay.ts`
 * —donde nació— porque desde que hay picker compartido lo usan DOS superficies:
 * la pestaña "Clásicos" del comentario y la del editor de fotos. Una lista
 * copiada en dos lados es cómo se llega a que el mismo emoji esté en el editor
 * y no en el comentario. `photo-overlay.ts` lo re-exporta con su nombre de
 * siempre (`STICKER_GROUPS`) para no tocar a quien ya lo importaba.
 *
 * Cortito a propósito: un teclado de emojis completo dentro de una hoja ya
 * abierta es una pantalla entera de scroll para elegir una carita. Éstos son
 * los que la gente usa de verdad en una comunidad.
 */
export const CLASSIC_EMOJI_GROUPS: ReadonlyArray<{
  label: string;
  emojis: readonly string[];
}> = [
  { label: "Caras", emojis: ["😀", "😍", "🥹", "😎", "🤣", "😮", "🥳", "😴"] },
  { label: "Gestos", emojis: ["❤️", "🔥", "👏", "🙌", "💪", "🙏", "👌", "✌️"] },
  { label: "Fiesta", emojis: ["🎉", "🎂", "🎈", "🍻", "🎶", "⚽", "🏆", "✨"] },
  { label: "Nuestro", emojis: ["🌎", "🇦🇷", "🇨🇴", "🇲🇽", "🇻🇪", "🇵🇪", "🇪🇸", "🌴"] },
];

// ---------------------------------------------------------------------------
// Medidas
// ---------------------------------------------------------------------------

/**
 * Lado del PNG que se pide al cliente. 512 px es el estándar de un sticker: el
 * uso más grande es el editor de fotos, donde un emoji al 60% del lado corto de
 * una foto de 1600 px llega a ~960 px… pero un emoji ocupando el 60% de la foto
 * se mira a distancia de pulgar, no de lupa. 512 se ve nítido en todo lo demás
 * (picker a 40 px, comentario a ~20 px, reacción a 24 px) y pesa un cuarto que
 * 1024.
 */
export const EMOJI_ASSET_SIDE_PX = 512;

/**
 * Lado del emoji cuando va DENTRO de un texto (un comentario). 22 px con
 * `line-height` de 1.5 sobre cuerpo 14: el dibujo pisa un poco el interlineado
 * —como hace cualquier emoji— sin separar las líneas del párrafo.
 */
export const EMOJI_INLINE_SIDE_PX = 22;

/**
 * Blanco táctil mínimo de una celda del picker. 44 px es el piso accesible
 * (WCAG 2.5.8 / Apple HIG); las celdas reales son más grandes porque estos
 * dibujos traen PALABRAS adentro ("KLK", "CHÉVERE") y a 44 px la palabra no se
 * lee — que es distinto de un glifo, que a 44 px se reconoce igual.
 */
export const EMOJI_TILE_MIN_PX = 44;
