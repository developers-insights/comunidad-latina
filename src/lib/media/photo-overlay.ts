/**
 * LO QUE VA ENCIMA DE LA FOTO — texto y emojis, contrato puro.
 *
 * Pedido del cliente (2026-08-26): "agregar la chance de ponerle texto a las
 * fotos por encima… y agregar emojis también… los textos que se agregan pueden
 * cambiar de colores, tipografía, etc".
 *
 * El texto ya existía (posición + fondo). Lo nuevo es COLOR, TIPOGRAFÍA y
 * EMOJIS, y los tres tienen la misma trampa: se eligen en una vista previa de
 * CSS y se publican en un canvas. Si los dos lados no leen exactamente los
 * mismos números, lo que se ve al editar no es lo que sale publicado — y como
 * el horneado es irreversible (el archivo que se sube YA es la foto con todo
 * quemado, ver bake-photo.ts), la diferencia se descubre cuando ya no hay
 * vuelta atrás.
 *
 * Por eso este módulo no tiene DOM: define los catálogos y las cuentas UNA vez,
 * y los importan por igual la hoja del editor, la miniatura de la grilla y el
 * horneado.
 *
 * ─── POR QUÉ LOS COLORES SON LITERALES Y NO TOKENS DEL TEMA ─────────────────
 * Todo lo demás en la app usa tokens semánticos (`text-on-media`,
 * `bg-surface`…) que cambian con el tema y con la marca del tenant. Acá no se
 * puede: esto se QUEMA en los píxeles de un JPEG. Una foto publicada por
 * alguien con el teléfono en modo oscuro tiene que verse igual que la de al
 * lado; y el archivo, una vez subido, ya no puede enterarse de nada. Son
 * constantes a propósito.
 */

// ---------------------------------------------------------------------------
// Color del texto
// ---------------------------------------------------------------------------

export const CAPTION_COLORS = [
  "blanco",
  "negro",
  "amarillo",
  "naranja",
  "rosa",
  "turquesa",
  "violeta",
] as const;

export type CaptionColorId = (typeof CAPTION_COLORS)[number];

/**
 * `blanco` es el default y vale exactamente `#f7f6f3`, que es el mismo valor
 * que ya quemaba `bake-photo.ts` antes de que existiera esta paleta (el token
 * `on-media` de globals.css, constante en claro y oscuro). Así una edición
 * guardada antes de hoy se sigue viendo idéntica: el default no cambió nada.
 */
export const DEFAULT_CAPTION_COLOR: CaptionColorId = "blanco";

export interface CaptionColor {
  id: CaptionColorId;
  /** Nombre en pantalla, y el que lee un lector de pantalla. */
  label: string;
  /** Tinta del texto. */
  fill: string;
  /**
   * ¿Es una tinta OSCURA? De esto depende todo lo demás: sobre qué barra se
   * apoya con "Con fondo" y de qué color es el halo con "Sin fondo". Sin este
   * dato, elegir negro con fondo daba texto casi negro sobre una barra casi
   * negra — un control que ofrece volverse ilegible.
   */
  dark: boolean;
}

const CAPTION_COLOR_MAP: Record<CaptionColorId, CaptionColor> = {
  blanco: { id: "blanco", label: "Blanco", fill: "#f7f6f3", dark: false },
  negro: { id: "negro", label: "Negro", fill: "#14120c", dark: true },
  amarillo: { id: "amarillo", label: "Amarillo", fill: "#ffd23f", dark: false },
  naranja: { id: "naranja", label: "Naranja", fill: "#ff7a45", dark: false },
  rosa: { id: "rosa", label: "Rosa", fill: "#ff5f9e", dark: false },
  turquesa: { id: "turquesa", label: "Turquesa", fill: "#2fd3c4", dark: false },
  violeta: { id: "violeta", label: "Violeta", fill: "#9b7cff", dark: false },
};

export const CAPTION_COLOR_LIST: readonly CaptionColor[] = CAPTION_COLORS.map(
  (id) => CAPTION_COLOR_MAP[id],
);

/** Un id desconocido (edición vieja, dato corrupto) cae en el default. */
export function resolveCaptionColor(id: CaptionColorId | undefined | null): CaptionColor {
  return CAPTION_COLOR_MAP[id as CaptionColorId] ?? CAPTION_COLOR_MAP[DEFAULT_CAPTION_COLOR];
}

/** Barra de fondo del texto — la contraria a la tinta, o no se lee. */
export function captionBarFill(color: CaptionColor): string {
  // Mismos valores de `media-shade` / `on-media` (globals.css), que ya usaba el
  // horneado: la barra oscura no cambió para el color por defecto.
  return color.dark ? "rgba(247, 246, 243, 0.72)" : "rgba(13, 12, 8, 0.55)";
}

/** Halo del texto SIN barra: la legibilidad no puede depender de la foto. */
export function captionHaloColor(color: CaptionColor): string {
  return color.dark ? "rgba(255, 255, 255, 0.85)" : "rgba(0, 0, 0, 0.9)";
}

// ---------------------------------------------------------------------------
// Tipografía del texto
// ---------------------------------------------------------------------------

export const CAPTION_FONTS = ["titular", "redonda", "clasica", "maquina"] as const;

export type CaptionFontId = (typeof CAPTION_FONTS)[number];

/** El de siempre: la tipografía de interfaz de la app. */
export const DEFAULT_CAPTION_FONT: CaptionFontId = "redonda";

export interface CaptionFont {
  id: CaptionFontId;
  /** Nombre en pantalla. Describe cómo se VE, no cómo se llama la fuente:
   *  "General Sans" no le dice nada a nadie; "Titular" sí. */
  label: string;
  /**
   * Variable CSS donde `next/font` deja la familia real, o `null` para las
   * familias del sistema.
   *
   * NINGUNA FUENTE NUEVA POR RED, y no es una preferencia: el horneado dibuja
   * en canvas, y un canvas que pide una familia que todavía no bajó no falla —
   * dibuja con la de respaldo y no avisa. Sumar una fuente por red significaría
   * que la vista previa y el archivo publicado pueden decir cosas distintas
   * según cuándo terminó de cargar. Acá sólo hay dos familias que la app YA
   * carga con `next/font` (layout.tsx) y dos que están en cualquier sistema.
   */
  cssVar: "--font-general-sans" | "--font-jakarta" | null;
  /** Respaldo real, y la familia entera cuando `cssVar` es null. */
  fallback: string;
  /** Peso con el que se dibuja. El texto sobre una foto pide cuerpo. */
  weight: number;
}

const CAPTION_FONT_MAP: Record<CaptionFontId, CaptionFont> = {
  titular: {
    id: "titular",
    label: "Titular",
    cssVar: "--font-general-sans",
    fallback: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    weight: 700,
  },
  redonda: {
    id: "redonda",
    label: "Redonda",
    cssVar: "--font-jakarta",
    fallback: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    weight: 700,
  },
  clasica: {
    id: "clasica",
    label: "Clásica",
    cssVar: null,
    fallback: 'Georgia, "Times New Roman", ui-serif, serif',
    weight: 700,
  },
  maquina: {
    id: "maquina",
    label: "Máquina",
    cssVar: null,
    fallback: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
    weight: 700,
  },
};

export const CAPTION_FONT_LIST: readonly CaptionFont[] = CAPTION_FONTS.map(
  (id) => CAPTION_FONT_MAP[id],
);

export function resolveCaptionFont(id: CaptionFontId | undefined | null): CaptionFont {
  return CAPTION_FONT_MAP[id as CaptionFontId] ?? CAPTION_FONT_MAP[DEFAULT_CAPTION_FONT];
}

/**
 * Familia para CSS (vista previa y miniatura). Acá SÍ se puede escribir
 * `var(--…)`: lo resuelve la cascada.
 */
export function captionFontCss(id: CaptionFontId | undefined | null): string {
  const font = resolveCaptionFont(id);
  return font.cssVar ? `var(${font.cssVar}), ${font.fallback}` : font.fallback;
}

/**
 * Familia para CANVAS, donde `var(--…)` NO se resuelve: `ctx.font` es una
 * cadena de CSS suelta, sin cascada ni elemento del que heredar.
 *
 * El valor de la variable se INYECTA (`resolveVar`) en vez de leerse acá para
 * que este módulo siga siendo puro y la cuenta se pueda probar sin DOM. Quien
 * hornea pasa un lector de `getComputedStyle`; un test pasa un objeto.
 */
export function captionFontFamilyFor(
  id: CaptionFontId | undefined | null,
  resolveVar: (name: string) => string,
): string {
  const font = resolveCaptionFont(id);
  if (!font.cssVar) return font.fallback;
  const resolved = resolveVar(font.cssVar).trim();
  // Sin variable resuelta (SSR, hoja todavía no aplicada) queda el respaldo
  // solo: es la misma familia que el navegador iba a usar igual.
  return resolved ? `${resolved}, ${font.fallback}` : font.fallback;
}

/** `ctx.font` completo. Un solo lugar arma esta cadena. */
export function captionFontShorthand(
  id: CaptionFontId | undefined | null,
  sizePx: number,
  resolveVar: (name: string) => string,
): string {
  const font = resolveCaptionFont(id);
  return `${font.weight} ${Math.max(1, Math.round(sizePx))}px ${captionFontFamilyFor(id, resolveVar)}`;
}

// ---------------------------------------------------------------------------
// Emojis pegados sobre la foto
// ---------------------------------------------------------------------------

/**
 * Un emoji puesto sobre la foto. Todo NORMALIZADO (0–1) contra el recuadro ya
 * recortado, por el mismo motivo que el recorte: el stage mide distinto en cada
 * teléfono, y un emoji guardado en píxeles de pantalla aparecería en otro lugar
 * al publicar.
 */
export interface PhotoSticker {
  /** Sólo para React y para poder borrar el que se tocó. No se publica. */
  id: string;
  /**
   * El glifo Unicode. VACÍO cuando el sticker es un emoji propio de la
   * comunidad (`image`), que se dibuja con `drawImage` y no con `fillText`.
   */
  emoji: string;
  /**
   * EMOJI PROPIO DE LA COMUNIDAD (migración 0125): una imagen, no un glifo.
   * Ausente = sticker Unicode de siempre, que es como venía funcionando esto.
   *
   * Es un campo OPCIONAL y no una unión discriminada a propósito: todo lo que
   * hay alrededor —posición, tamaño, recorte, arrastre, `stickerBox`— es
   * idéntico para los dos, y lo único que cambia es la última línea, la que
   * pinta. Una unión obligaría a ramificar en cada función que hoy no necesita
   * saber la diferencia.
   */
  image?: PhotoStickerImage;
  /** Centro del emoji, 0–1 sobre el ancho/alto del recuadro publicado. */
  x: number;
  y: number;
  /** Alto del emoji como fracción del LADO CORTO del recuadro. */
  size: number;
}

/** Lo mínimo que hace falta para pintar y para nombrar un emoji de la comunidad. */
export interface PhotoStickerImage {
  /** Código corto del catálogo. Identifica el dibujo sin depender de la URL. */
  slug: string;
  /** URL pública del archivo en el bucket `community-emojis`. */
  url: string;
  /**
   * Qué se ve en el dibujo. OBLIGATORIO: es el nombre accesible del emoji
   * mientras se lo arrastra sobre la foto, y sin él la capa de stickers se
   * anuncia como una fila de botones sin nombre.
   */
  alt: string;
}

/**
 * Las URLs que hay que tener descargadas antes de hornear, sin repetir.
 *
 * Vive acá —con el resto del contrato— y no en el horneado porque el mismo
 * dato lo puede querer una vista previa que precargue. Devuelve `[]` cuando no
 * hay ningún emoji de imagen, que es el caso normal y el que no tiene que
 * pagar nada.
 */
export function stickerImageUrls(stickers: readonly PhotoSticker[]): string[] {
  return [...new Set(stickers.map((sticker) => sticker.image?.url).filter(isUrl))];
}

function isUrl(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Cuántos entran. Más que esto no es una foto con emojis, es una calcomanía. */
export const MAX_STICKERS = 8;

export const DEFAULT_STICKER_SIZE = 0.18;
export const MIN_STICKER_SIZE = 0.07;
export const MAX_STICKER_SIZE = 0.6;

/**
 * Catálogo Unicode por temas.
 *
 * SE MUDÓ a `src/lib/emojis/catalog.ts` cuando el picker pasó a ser compartido
 * (0125): la misma lista la usa ahora la pestaña "Clásicos" del comentario. Se
 * re-exporta con este nombre para no tocar a quien ya la importaba de acá —el
 * editor de fotos y su test—, y para que no queden dos listas que alguien tenga
 * que acordarse de mantener iguales.
 */
export { CLASSIC_EMOJI_GROUPS as STICKER_GROUPS } from "@/lib/emojis/catalog";

/**
 * Familia de emoji para el canvas. `fillText` con un emoji dibuja la fuente de
 * color del sistema; nombrarla explícitamente evita que caiga en una tipográfica
 * monocroma en los sistemas donde el default de `sans-serif` no trae emoji.
 */
export const STICKER_FONT_FAMILY =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';

export function clampStickerSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_STICKER_SIZE;
  return Math.min(MAX_STICKER_SIZE, Math.max(MIN_STICKER_SIZE, size));
}

/**
 * El CENTRO del emoji nunca sale del recuadro. Se recorta el centro y no la
 * caja entera a propósito: dejar que un emoji asome por el borde es un recurso
 * legítimo (queda "pegado" al filo, como en cualquier app de historias); lo que
 * no puede pasar es que se vaya entero afuera y desaparezca al publicar.
 */
export function clampStickerPosition(x: number, y: number): { x: number; y: number } {
  const safe = (value: number) =>
    Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
  return { x: safe(x), y: safe(y) };
}

export function normalizeSticker(sticker: PhotoSticker): PhotoSticker {
  const { x, y } = clampStickerPosition(sticker.x, sticker.y);
  return { ...sticker, x, y, size: clampStickerSize(sticker.size) };
}

/**
 * Deja como mucho {@link MAX_STICKERS}, ya normalizados.
 *
 * Descarta los que no tienen NADA que pintar —ni glifo ni imagen—: desde que un
 * sticker puede ser una imagen, `emoji: ""` es un estado alcanzable, y un
 * `fillText("")` no dibuja nada pero ocupa uno de los ocho lugares. Se filtra
 * ANTES del corte para que el cupo lo gasten los que sí se ven.
 */
export function normalizeStickers(
  stickers: readonly PhotoSticker[] | undefined | null,
): PhotoSticker[] {
  if (!stickers?.length) return [];
  return stickers
    .filter((sticker) => Boolean(sticker.image?.url) || sticker.emoji.trim().length > 0)
    .slice(0, MAX_STICKERS)
    .map(normalizeSticker);
}

export interface StickerBox {
  /** Centro, en píxeles del recuadro. */
  centerX: number;
  centerY: number;
  /** Alto de la caja del emoji, en píxeles: es el tamaño de fuente a usar. */
  fontSize: number;
}

/**
 * Un sticker normalizado, en píxeles de un recuadro concreto. La MISMA cuenta
 * la usa la vista previa (con el tamaño del stage) y el horneado (con el tamaño
 * del canvas): por eso el emoji cae en el mismo lugar en los dos.
 *
 * El tamaño se mide contra el LADO CORTO y no contra el ancho: si se midiera
 * contra el ancho, el mismo 18% sería un emoji chico en vertical y enorme en
 * panorámica. Contra el lado corto, "18%" significa siempre lo mismo.
 */
export function stickerBox(sticker: PhotoSticker, box: { width: number; height: number }): StickerBox {
  const shortSide = Math.max(1, Math.min(box.width, box.height));
  const safe = normalizeSticker(sticker);
  return {
    centerX: safe.x * box.width,
    centerY: safe.y * box.height,
    fontSize: Math.max(1, Math.round(safe.size * shortSide)),
  };
}
