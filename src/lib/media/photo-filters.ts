/**
 * PRESETS DE FILTRO — datos puros, sin React ni DOM (se testean sin montar
 * nada). Cada preset es un valor de `filter` de CSS: sirve TAL CUAL para la
 * vista previa instantánea (`style={{ filter: css }}`, gratis en el navegador)
 * y para el horneado en canvas (`ctx.filter = css`, ver `bake-photo.ts`) — un
 * solo valor, dos usos, cero posibilidad de que la vista previa mienta sobre
 * lo que se termina publicando.
 *
 * ESA REGLA MANDA SOBRE EL CATÁLOGO. Sólo entran funciones que `ctx.filter`
 * sabe dibujar (`brightness`, `contrast`, `saturate`, `sepia`, `grayscale`,
 * `hue-rotate`, `blur`, `invert`, `opacity`). Nada de viñeta ni de grano: eso
 * pide un segundo dibujo encima del canvas que la vista previa de CSS no puede
 * replicar, y ahí lo que se ve y lo que se publica dejarían de ser lo mismo.
 * La variedad sale de COMBINAR estas funciones, no de sumar capas.
 *
 * FAMILIAS. Los presets están ordenados por familia y el orden importa: es el
 * recorrido del carrusel. Se pasa de lo cálido a lo frío, de lo vivo a lo
 * suave, y se cierra en blanco y negro y en película — así deslizar se siente
 * como recorrer un catálogo pensado y no una bolsa de efectos.
 *
 * NOMBRES: en español, y que suenen a cómo hablaría una persona de su foto
 * ("quedó cálida", "la dejé bien nítida"), no a un panel de edición
 * profesional ("Curves", "HSL", "Clarity"). Pensados para lo que se publica en
 * esta comunidad — comida, casas, autos, gente — así que ninguno empuja tanto
 * el efecto como para verse "filtrado" en vez de "una foto linda".
 *
 * INTENSIDAD: el preset es el 100%. Bajarlo NO es otro preset, es el MISMO
 * interpolado hacia la foto original (`scaleFilterCss`), así que el catálogo no
 * se duplica para tener "Cálido suave" y "Cálido fuerte".
 */

/** Grupo al que pertenece un preset. Fija el orden del carrusel. */
export type PhotoFilterFamily =
  | "original"
  | "calidos"
  | "frios"
  | "vivos"
  | "suaves"
  | "byn"
  | "film";

export interface PhotoFilter {
  id: string;
  /** Nombre visible, en español rioplatense cálido. */
  label: string;
  /** Familia visual. No se muestra: ordena el catálogo y se testea. */
  family: PhotoFilterFamily;
  /** Valor de `filter` (CSS y canvas). Cadena vacía = sin filtro. */
  css: string;
}

export const PHOTO_FILTERS: readonly PhotoFilter[] = [
  { id: "original", label: "Original", family: "original", css: "" },

  /* ------------------------------- Cálidos -------------------------------- */
  {
    id: "calido",
    label: "Cálido",
    family: "calidos",
    css: "saturate(1.3) sepia(0.14) contrast(1.05) brightness(1.03)",
  },
  {
    id: "dorado",
    label: "Dorado",
    family: "calidos",
    css: "sepia(0.3) saturate(1.4) hue-rotate(-10deg) contrast(1.08) brightness(1.06)",
  },
  {
    id: "atardecer",
    label: "Atardecer",
    family: "calidos",
    css: "sepia(0.22) saturate(1.5) hue-rotate(-18deg) contrast(1.12) brightness(0.98)",
  },

  /* -------------------------------- Fríos --------------------------------- */
  {
    id: "fresco",
    label: "Fresco",
    family: "frios",
    css: "saturate(1.15) hue-rotate(6deg) contrast(1.06) brightness(1.05)",
  },
  {
    id: "brisa",
    label: "Brisa",
    family: "frios",
    css: "saturate(1.08) hue-rotate(12deg) contrast(0.98) brightness(1.07)",
  },
  {
    id: "nocturno",
    label: "Nocturno",
    family: "frios",
    css: "brightness(0.92) contrast(1.2) saturate(0.88) hue-rotate(8deg)",
  },

  /* -------------------------------- Vivos --------------------------------- */
  {
    id: "nitido",
    label: "Nítido",
    family: "vivos",
    css: "contrast(1.22) saturate(1.12) brightness(1.01)",
  },
  {
    id: "vivido",
    label: "Vívido",
    family: "vivos",
    css: "saturate(1.5) contrast(1.1)",
  },

  /* -------------------------------- Suaves -------------------------------- */
  {
    id: "suave",
    label: "Suave",
    family: "suaves",
    css: "brightness(1.06) contrast(0.92) saturate(0.92)",
  },
  {
    id: "retrato",
    label: "Retrato",
    family: "suaves",
    css: "brightness(1.05) contrast(0.95) saturate(1.08) sepia(0.07)",
  },

  /* --------------------------- Blanco y negro ----------------------------- */
  {
    id: "byn",
    label: "Blanco y negro",
    family: "byn",
    css: "grayscale(1) contrast(1.1)",
  },
  {
    id: "carbon",
    label: "Carbón",
    family: "byn",
    css: "grayscale(1) contrast(1.5) brightness(0.95)",
  },

  /* ------------------------------- Película ------------------------------- */
  {
    id: "vintage",
    label: "Vintage",
    family: "film",
    css: "sepia(0.35) saturate(0.85) contrast(0.95) brightness(1.02)",
  },
  {
    id: "super8",
    label: "Súper 8",
    family: "film",
    css: "sepia(0.5) saturate(1.25) contrast(1.12) brightness(1.04) hue-rotate(-12deg)",
  },
  {
    id: "polaroid",
    label: "Polaroid",
    family: "film",
    css: "sepia(0.18) saturate(0.88) contrast(0.88) brightness(1.12) hue-rotate(6deg)",
  },
] as const;

export type PhotoFilterId = (typeof PHOTO_FILTERS)[number]["id"];

export const DEFAULT_PHOTO_FILTER_ID: PhotoFilterId = "original";

/** Busca un preset por id; si no existe (dato corrupto), cae a "Original". */
export function getPhotoFilter(id: string | undefined | null): PhotoFilter {
  return PHOTO_FILTERS.find((filter) => filter.id === id) ?? PHOTO_FILTERS[0];
}

// ---------------------------------------------------------------------------
// Intensidad
// ---------------------------------------------------------------------------

/** El preset tal cual fue diseñado. */
export const DEFAULT_PHOTO_FILTER_INTENSITY = 1;

/**
 * Piso del control. Por debajo de esto el efecto no se distingue del original
 * y el deslizador se convertiría en un tramo muerto: quien quiere "nada" tiene
 * el preset Original, que es una decisión, no un 3% de Cálido.
 */
export const MIN_PHOTO_FILTER_INTENSITY = 0.2;

/**
 * Valor NEUTRO de cada función: el número con el que la función no hace nada.
 * Es lo que permite bajar la intensidad interpolando hacia él en vez de
 * inventar presets intermedios a mano.
 *
 * Una función que no esté acá se deja intacta: preferimos un preset que no
 * atenúa a uno que se atenúa mal (`blur` sí está, pero hoy ningún preset lo
 * usa — ver el docblock de arriba).
 */
const FILTER_IDENTITY: Readonly<Record<string, number>> = {
  brightness: 1,
  contrast: 1,
  saturate: 1,
  opacity: 1,
  grayscale: 0,
  sepia: 0,
  invert: 0,
  "hue-rotate": 0,
  blur: 0,
};

/** `saturate(1.3)`, `hue-rotate(-10deg)`, `blur(2px)` — nombre, número, unidad. */
const FILTER_TOKEN = /([a-z-]+)\(\s*(-?\d*\.?\d+)\s*(deg|px|rad|turn|%)?\s*\)/g;

export function clampFilterIntensity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PHOTO_FILTER_INTENSITY;
  return Math.min(1, Math.max(0, value));
}

/**
 * El MISMO filtro, aplicado al `amount` que se pidió (0 = foto original,
 * 1 = el preset tal cual).
 *
 * Interpola cada número hacia su valor neutro. Que sea una función pura sobre
 * el string —y no dos catálogos, uno "suave" y otro "fuerte"— es lo que
 * garantiza que la vista previa y el horneado sigan recibiendo EXACTAMENTE el
 * mismo valor: `bake-photo.ts` no se entera de que existe la intensidad.
 *
 * En 1 devuelve el string ORIGINAL sin tocar: nada de reescribir
 * `saturate(1.3)` como `saturate(1.300)` por haber pasado por acá.
 */
export function scaleFilterCss(css: string, amount: number): string {
  const factor = clampFilterIntensity(amount);
  if (!css) return "";
  if (factor >= 1) return css;
  if (factor <= 0) return "";

  return css.replace(FILTER_TOKEN, (token, rawName: string, rawValue: string, unit = "") => {
    const identity = FILTER_IDENTITY[rawName];
    if (identity === undefined) return token; // función desconocida: intacta
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return token;
    const next = identity + (value - identity) * factor;
    // Tres decimales: más precisión no cambia un píxel y ensucia el string que
    // termina en `ctx.filter`.
    return `${rawName}(${Math.round(next * 1000) / 1000}${unit})`;
  });
}

/**
 * Lo que hay que escribir en `style.filter` (y en `ctx.filter`) para un preset
 * y una intensidad. Único punto por donde pasan las dos cosas: la miniatura de
 * la grilla, la vista previa grande y el horneado llaman todos acá.
 */
export function resolvePhotoFilterCss(
  id: string | undefined | null,
  intensity: number = DEFAULT_PHOTO_FILTER_INTENSITY,
): string {
  return scaleFilterCss(getPhotoFilter(id).css, intensity);
}

// ---------------------------------------------------------------------------
// El filtro como METADATO (video) — lo que viaja al servidor y se guarda
// ---------------------------------------------------------------------------

/**
 * EL FILTRO DE UN VIDEO NO SE HORNEA, SE GUARDA.
 *
 * En una foto el filtro se quema en los píxeles (`bake-photo.ts`) y el archivo
 * publicado ES la foto filtrada. En un video eso no se sostiene: hornear cuadro
 * a cuadro con canvas + MediaRecorder es codificar en tiempo real —90 s de
 * video, 90 s de espera— rompe la subida directa al bucket (el archivo deja de
 * ser el que ya se subió) y desalinea la huella perceptual de Content
 * Integrity, que se calcula sobre el archivo real.
 *
 * Así que del video se guarda la DECISIÓN, no el resultado: qué preset y con
 * cuánta intensidad. El reproductor la aplica con `filter` de CSS, que es
 * gratis y es exactamente lo que ya se vio en la vista previa del compositor.
 *
 * LO QUE NUNCA SE GUARDA ES CSS. Del cliente sólo se acepta un `id` del
 * catálogo y un número; el string de `filter` lo arma SIEMPRE
 * `resolvePhotoFilterCss` a partir del catálogo de este archivo. Guardar CSS
 * crudo que venga del navegador sería dejar que un cliente modificado escriba
 * en el `style` de todo el que abra la publicación — inyección de estilos con
 * dueño ajeno.
 */
export interface MediaFilterRef {
  id: PhotoFilterId;
  /** 0–1, ya validada contra el rango real del control. */
  intensity: number;
}

/** ¿Es un id que EXISTE en el catálogo? Único lugar que responde esa pregunta. */
export function isPhotoFilterId(value: unknown): value is PhotoFilterId {
  return (
    typeof value === "string" && PHOTO_FILTERS.some((filter) => filter.id === value)
  );
}

/**
 * Resultado de leer un filtro que llegó de afuera. Tres desenlaces, no dos:
 * válido con filtro, válido SIN filtro (nadie eligió nada, o eligió "Original")
 * y directamente inválido — que es el único que tiene que frenar la publicación.
 */
export type MediaFilterParse =
  | { ok: true; value: MediaFilterRef | null }
  | { ok: false };

/**
 * Valida un filtro recibido del cliente contra el catálogo REAL.
 *
 * Se rechaza —no se ignora— cualquier cosa que no sea exactamente del catálogo:
 * un id inventado es un cliente que no es el nuestro, y publicar igual dejando
 * el video sin filtro le enseñaría que puede mandar cualquier cosa mientras el
 * servidor la limpie en silencio. Un `null` (o un "Original") sí es una
 * respuesta legítima: significa "sin filtro", y no se guarda nada.
 *
 * La intensidad se valida contra el rango del control real —`MIN` a 1—, no se
 * recorta: un 4 no es "alguien que quiso el máximo", es alguien probando qué
 * aguanta.
 */
export function parseMediaFilterRef(raw: unknown): MediaFilterParse {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false };

  const candidate = raw as { id?: unknown; intensity?: unknown };
  if (!isPhotoFilterId(candidate.id)) return { ok: false };

  const intensity =
    candidate.intensity === undefined
      ? DEFAULT_PHOTO_FILTER_INTENSITY
      : candidate.intensity;
  if (typeof intensity !== "number" || !Number.isFinite(intensity)) return { ok: false };
  if (intensity < MIN_PHOTO_FILTER_INTENSITY || intensity > 1) return { ok: false };

  // "Original" es la ausencia de filtro dicha con todas las letras: se acepta,
  // pero no se persiste — un metadato que no cambia un píxel es ruido en la fila.
  if (candidate.id === DEFAULT_PHOTO_FILTER_ID) return { ok: true, value: null };

  return { ok: true, value: { id: candidate.id, intensity } };
}

/**
 * LA LECTURA: `posts.media_filters` (jsonb) → CSS por ruta de archivo.
 *
 * Es la contracara de `parseMediaFilterRef` y la ÚNICA puerta por la que lo
 * guardado llega a un `style`. Todo lo que no sea exactamente un preset del
 * catálogo se descarta en silencio —acá sí, no rechazando: una fila vieja o
 * tocada a mano no puede tumbar el feed entero, sólo pierde su filtro— y lo que
 * sale es SIEMPRE el string que arma este archivo, nunca el que diga la base.
 *
 * Devuelve un `Map` y no el objeto crudo para que quien lo consuma no pueda
 * confundirse y leer una clave que no pasó por acá.
 */
export function mediaFilterCssByPath(raw: unknown): Map<string, string> {
  const result = new Map<string, string>();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;

  for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = parseMediaFilterRef(value);
    if (!parsed.ok || !parsed.value) continue;
    const css = resolvePhotoFilterCss(parsed.value.id, parsed.value.intensity);
    if (css) result.set(path, css);
  }
  return result;
}
