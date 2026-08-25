import { normalizeGeoLabel } from "@/lib/boosts/scope";

/**
 * =============================================================================
 * "TU ZONA" — la cookie, y el saneo de su valor
 * =============================================================================
 *
 * MÓDULO PURO a propósito (sin `next/headers`, sin Supabase, sin React): lo
 * importan el Server Component que la lee, la action que la escribe y los
 * tests. Mismo criterio que `@/lib/boosts/scope`.
 *
 * ── POR QUÉ UNA COOKIE Y NO EL PERFIL ───────────────────────────────────────
 * Elegir zona es una preferencia de VISTA, no un dato de la persona. Alguien
 * vive en Corona y quiere mirar Jackson Heights porque se está por mudar:
 * pisarle `profiles.area_label` para resolver esa consulta pasajera sería
 * cambiarle quién es para contestarle qué quiere ver.
 *
 * ── POR QUÉ UNA COOKIE Y NO localStorage ────────────────────────────────────
 * Porque el filtro tiene que aplicarse en el PRIMER render, en el servidor. Con
 * localStorage la lista sale completa, hidrata y recién ahí se recorta: un
 * parpadeo y un salto de layout en cada pantalla. Una cookie viaja con el
 * request y el HTML sale ya filtrado.
 *
 * ── EL SANEO NO ES OPCIONAL ─────────────────────────────────────────────────
 * El valor lo escribe el navegador, así que llega como entrada del cliente y se
 * trata como tal — mismo criterio que `sanitizeSlug` para `cl-tenant`. Lo que
 * pasa por acá va a terminar dentro de un `.in("area_label", …)` de PostgREST.
 */

/** Nombre de la cookie. Prefijo `cl-` = de la plataforma, igual que `cl-tenant`. */
export const ZONA_COOKIE = "cl-zona";

/**
 * Valor que significa "TODA LA COMUNIDAD, y lo elegí yo".
 *
 * No alcanza con borrar la cookie: sin cookie el default es la zona del perfil,
 * así que quien vive en Corona y pidió ver todo volvería a Corona en el próximo
 * request. La salida tiene que poder GUARDARSE, o no es una salida.
 *
 * Empieza con `__` justamente para que ningún `area_label` real pueda chocarlo:
 * `sanitizeZona` rechaza cualquier etiqueta que normalice a este valor.
 */
export const ZONA_TODAS = "__todas";

/** Un `area_label` es un barrio, no un ensayo. Mismo techo que `?zona=`. */
export const ZONA_MAX_LEN = 80;

/**
 * Mínimo de caracteres ÚTILES (ya normalizados). Con uno solo, el match laxo
 * por contención de `sameZoneLabel` emparejaría media comunidad: "a" está
 * adentro de "Washington Heights" y de "Corona, Queens" a la vez.
 */
const ZONA_MIN_LEN = 2;

/** 180 días. Es una preferencia de uso diario; renovarla cada mes sería ruido. */
export const ZONA_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

/** Controles C0/C1 — nunca son parte de un nombre de barrio. */
const CONTROLES = /\p{Cc}/gu;

/**
 * La etiqueta lista para usar, o `null` si no sirve.
 *
 * No se toca la forma en que la persona la escribió (acentos, mayúsculas,
 * comas): esa etiqueta se muestra en el header y se compara contra
 * `listings.area_label`, que también es texto libre. Lo único que se saca es lo
 * que no puede ser parte de un nombre: controles, espacios de más y el exceso
 * de largo.
 */
export function sanitizeZona(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const limpio = raw.replace(CONTROLES, " ").replace(/\s+/g, " ").trim().slice(0, ZONA_MAX_LEN).trim();
  if (!limpio) return null;
  const normalizado = normalizeGeoLabel(limpio);
  if (normalizado.length < ZONA_MIN_LEN) return null;
  // Nadie puede llamar a su barrio como el centinela y secuestrar la salida.
  if (limpio === ZONA_TODAS || normalizado === normalizeGeoLabel(ZONA_TODAS)) return null;
  return limpio;
}

/** Lo que la cookie puede querer decir. `null` = no dice nada usable. */
export type ZonaCookie = { modo: "todas" } | { modo: "zona"; label: string };

/**
 * El valor que se guarda. `null` ⇒ "toda la comunidad" (el centinela).
 *
 * Se percent-codifica porque un `area_label` real trae comas ("Corona,
 * Queens"), acentos ("Bogotá") y espacios — y una coma cruda dentro de un
 * `Set-Cookie` es un separador, no un carácter.
 */
export function encodeZonaCookie(label: string | null): string {
  return encodeURIComponent(label ?? ZONA_TODAS);
}

/** El valor crudo de la cookie → intención, ya saneada. */
export function readZonaCookie(raw: string | null | undefined): ZonaCookie | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let decodificado: string;
  try {
    decodificado = decodeURIComponent(raw);
  } catch {
    // Percent-encoding roto (cookie editada a mano): se ignora, no se rompe.
    return null;
  }
  if (decodificado === ZONA_TODAS) return { modo: "todas" };
  const label = sanitizeZona(decodificado);
  return label ? { modo: "zona", label } : null;
}
