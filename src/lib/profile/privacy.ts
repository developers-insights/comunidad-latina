/**
 * Controles de privacidad del perfil — el modelo, sin UI y sin servidor.
 *
 * Espeja la tabla `public.profile_privacy` y la función `app.privacy_allows()`
 * de la migración 0063. Sirve para tres cosas distintas que conviene tener en un
 * solo lugar:
 *
 *   1. Los DEFAULTS cuando no hay fila. Esa ausencia significa "los defaults
 *      conservadores", igual que en `notification_prefs` (0045) — no se siembra
 *      una fila por registro justamente para que nadie quede expuesto por una
 *      fila que no se llegó a crear.
 *   2. La lista de bloques y su ORDEN, que es el orden de la pantalla.
 *   3. Una copia de la regla de visibilidad para previsualizar el efecto sin ir
 *      al servidor.
 *
 * ── LO QUE ESTE MÓDULO NO ES ─────────────────────────────────────────────────
 * No es la privacidad. La privacidad la aplica `public.profile_card()` DENTRO de
 * la base: los campos que la configuración no permite vuelven NULL desde el
 * servidor y ni siquiera viajan al cliente. Si alguien borrara todo este archivo,
 * no se filtraría nada — sólo se rompería la pantalla de ajustes.
 */

export const PRIVACY_LEVELS = ["publico", "seguidores", "privado"] as const;
export type PrivacyLevel = (typeof PRIVACY_LEVELS)[number];

export function isPrivacyLevel(value: unknown): value is PrivacyLevel {
  return typeof value === "string" && (PRIVACY_LEVELS as readonly string[]).includes(value);
}

/** Las 8 columnas `show_*` de `profile_privacy`. */
export const PRIVACY_KEYS = [
  "show_last_name",
  "show_birthdate",
  "show_location",
  "show_languages",
  "show_country_origin",
  "show_bio",
  "show_followers",
  "show_posts",
] as const;
export type PrivacyKey = (typeof PRIVACY_KEYS)[number];

export type PrivacySettings = Record<PrivacyKey, PrivacyLevel>;

/**
 * Los mismos valores que `app.profile_privacy_defaults()` (0063).
 *
 * Si acá dijera algo más abierto que la base, la pantalla mostraría "público"
 * mientras el servidor sigue devolviendo NULL — el peor de los dos mundos: la
 * persona cree que compartió algo que nadie ve. Lo cuida `privacy.test.ts`.
 */
export const PRIVACY_DEFAULTS: PrivacySettings = {
  show_last_name: "privado",
  show_birthdate: "privado",
  show_location: "seguidores",
  show_languages: "publico",
  show_country_origin: "publico",
  show_bio: "publico",
  show_followers: "seguidores",
  show_posts: "publico",
};

/**
 * Normaliza lo que vino de la base (o de un formulario) a una configuración
 * completa y válida.
 *
 * Fail closed, igual que el `else false` de `app.privacy_allows()`: un valor
 * inesperado NO se interpreta ni se corrige hacia arriba — cae al default, que
 * siempre es el más cerrado de los dos.
 */
export function normalizePrivacy(
  raw: Partial<Record<PrivacyKey, unknown>> | null | undefined,
): PrivacySettings {
  const out = { ...PRIVACY_DEFAULTS };
  if (!raw) return out;
  for (const key of PRIVACY_KEYS) {
    const value = raw[key];
    if (isPrivacyLevel(value)) out[key] = value;
  }
  return out;
}

/** Espejo de `app.privacy_allows(nivel, es_dueño, es_seguidor)` (0063). */
export function privacyAllows(
  level: PrivacyLevel,
  viewerIsOwner: boolean,
  viewerIsFollower: boolean,
): boolean {
  if (viewerIsOwner) return true;
  if (level === "publico") return true;
  if (level === "seguidores") return viewerIsFollower;
  return false;
}

/* ─────────────────────────────── La pantalla ─────────────────────────────── */

export interface PrivacyBlock {
  key: PrivacyKey;
  /** Nombre del BLOQUE tal como lo entiende la persona, no el de la columna. */
  title: string;
  /** Qué dato concreto se está decidiendo. */
  detail: string;
  /**
   * Qué pasa en cada nivel, dicho como efecto y no como etiqueta. Es el punto
   * entero de la pantalla: "público / seguidores / privado" son tres palabras
   * que hay que traducir en la cabeza; "cualquiera puede ver tu apellido" no.
   */
  effect: Record<PrivacyLevel, string>;
  /**
   * Advertencia permanente, cuando el nivel elegido no cuenta toda la historia.
   * Hoy sólo la fecha de nacimiento: ni en "público" sale completa.
   */
  caveat?: string;
}

/**
 * Los 8 bloques, en el orden de la pantalla: primero lo que más identifica a una
 * persona fuera de la plataforma (apellido, edad, dónde vive) y al final lo que
 * ya es visiblemente público (bio, publicaciones). Así el primer bloque que se
 * ve es el que más conviene revisar.
 */
export const PRIVACY_BLOCKS: readonly PrivacyBlock[] = [
  {
    key: "show_last_name",
    title: "Tu apellido",
    detail: "Aparece al lado de tu nombre en el perfil.",
    effect: {
      publico: "Cualquiera ve tu nombre y tu apellido completos.",
      seguidores: "Solo quien te sigue ve tu apellido. El resto ve tu nombre.",
      privado: "Nadie ve tu apellido. En el perfil aparece solo tu nombre.",
    },
  },
  {
    key: "show_birthdate",
    title: "Tu edad",
    detail: "Los años que tenés, calculados desde tu fecha de nacimiento.",
    effect: {
      publico: "Cualquiera ve cuántos años tenés.",
      seguidores: "Solo quien te sigue ve cuántos años tenés.",
      privado: "Nadie ve tu edad.",
    },
    caveat: "Tu fecha de nacimiento exacta no se muestra nunca — ni en «Cualquiera». Solo la ves vos.",
  },
  {
    key: "show_location",
    title: "Dónde vivís",
    detail: "Tu ciudad y tu país de residencia.",
    effect: {
      publico: "Cualquiera ve tu ciudad y tu país de residencia.",
      seguidores: "Solo quien te sigue ve tu ciudad y tu país de residencia.",
      privado: "Nadie ve dónde vivís.",
    },
    caveat: "Tu dirección exacta no se guarda en ningún lado, elijas lo que elijas.",
  },
  {
    key: "show_country_origin",
    title: "Tu país de origen",
    detail: "De dónde venís — lo que te conecta con el resto de la comunidad.",
    effect: {
      publico: "Cualquiera ve de qué país sos.",
      seguidores: "Solo quien te sigue ve de qué país sos.",
      privado: "Nadie ve de qué país sos.",
    },
  },
  {
    key: "show_languages",
    title: "Los idiomas que hablás",
    detail: "Ayuda a que te encuentren quienes hablan lo mismo que vos.",
    effect: {
      publico: "Cualquiera ve qué idiomas hablás.",
      seguidores: "Solo quien te sigue ve qué idiomas hablás.",
      privado: "Nadie ve qué idiomas hablás.",
    },
  },
  {
    key: "show_bio",
    title: "Tu presentación",
    detail: "El texto donde contás quién sos.",
    effect: {
      publico: "Cualquiera lee tu presentación.",
      seguidores: "Solo quien te sigue lee tu presentación.",
      privado: "Nadie lee tu presentación.",
    },
  },
  {
    key: "show_followers",
    title: "A quién seguís y quién te sigue",
    detail: "Las dos listas de tu perfil.",
    effect: {
      publico: "Cualquiera puede abrir tus listas de seguidores y seguidos.",
      seguidores: "Solo quien te sigue puede abrir esas listas.",
      privado: "Nadie puede abrir esas listas.",
    },
  },
  {
    key: "show_posts",
    title: "Tus publicaciones en el perfil",
    detail: "La grilla de lo que publicaste, vista desde tu perfil.",
    effect: {
      publico: "Cualquiera ve tus publicaciones desde tu perfil.",
      seguidores: "Solo quien te sigue ve tus publicaciones desde tu perfil.",
      privado: "Tus publicaciones no se listan en tu perfil.",
    },
    caveat:
      "Esto controla tu perfil, no el resto de la app: lo que publicás en el feed o en un aviso se sigue viendo ahí.",
  },
] as const;

/** Etiquetas de los tres niveles. Cortas: el detalle lo cuenta `effect`. */
export const PRIVACY_LEVEL_LABEL: Record<PrivacyLevel, string> = {
  publico: "Cualquiera",
  seguidores: "Quien me sigue",
  privado: "Solo yo",
};

/** ¿Difiere de los defaults? Sirve para ofrecer "volver a lo recomendado". */
export function isDefaultPrivacy(settings: PrivacySettings): boolean {
  return PRIVACY_KEYS.every((key) => settings[key] === PRIVACY_DEFAULTS[key]);
}
