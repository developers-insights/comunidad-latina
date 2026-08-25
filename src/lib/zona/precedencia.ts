import { readZonaCookie, sanitizeZona } from "./cookie";

/**
 * =============================================================================
 * QUIÉN GANA — la precedencia de "Tu zona", en una función pura
 * =============================================================================
 *
 *   URL > cookie > perfil > toda la comunidad
 *
 * ── POR QUÉ LA URL GANA ─────────────────────────────────────────────────────
 * Porque un enlace compartido tiene que mostrar lo que promete. Si alguien
 * manda `/propiedades?zona=Jackson%20Heights` por WhatsApp, quien lo abre ve
 * Jackson Heights aunque tenga Corona elegida. La cookie es el DEFAULT, no una
 * cárcel: gobierna la navegación normal y se corre cuando la URL es explícita.
 *
 * ── POR QUÉ EL PERFIL ES EL DEFAULT Y NO "TODO" ─────────────────────────────
 * Cero regresión para quien no toca nada: hoy `resolveViewerGeo` ya cae a la
 * zona del perfil para el alcance de los impulsos, y las recomendaciones
 * locales ya la usan. Estrenar la feature con "todo" cambiaría lo que ve gente
 * que no pidió nada.
 *
 * ── POR QUÉ EL CENTINELA ES UN ESTADO Y NO LA AUSENCIA DE COOKIE ────────────
 * Ver `ZONA_TODAS` en ./cookie. "Elegí ver todo" tiene que sobrevivir al
 * próximo request; si fuera "borrar la cookie", el perfil lo pisaría enseguida.
 */

/** De dónde salió la zona que se está mostrando. Se usa para el copy y los tests. */
export type ZonaOrigen = "url" | "cookie" | "perfil" | "todas";

export interface ZonaActiva {
  /** `null` = toda la comunidad (sin filtro geográfico). */
  label: string | null;
  origen: ZonaOrigen;
}

export const TODA_LA_COMUNIDAD: ZonaActiva = { label: null, origen: "todas" };

export interface EntradaZona {
  /** El `?zona=` (o `?ciudad=`) del módulo, si lo tiene y viene puesto. */
  urlZona?: string | null;
  /** El valor CRUDO de la cookie `cl-zona`, tal como llegó del navegador. */
  cookieRaw?: string | null;
  /** `profiles.area_label` de quien mira, si hay sesión. */
  perfilZona?: string | null;
}

export function resolverZona({ urlZona, cookieRaw, perfilZona }: EntradaZona): ZonaActiva {
  const deUrl = sanitizeZona(urlZona);
  if (deUrl) return { label: deUrl, origen: "url" };

  const cookie = readZonaCookie(cookieRaw);
  if (cookie?.modo === "todas") return TODA_LA_COMUNIDAD;
  if (cookie?.modo === "zona") return { label: cookie.label, origen: "cookie" };

  const delPerfil = sanitizeZona(perfilZona);
  if (delPerfil) return { label: delPerfil, origen: "perfil" };

  return TODA_LA_COMUNIDAD;
}

/**
 * ¿La zona activa la puede cambiar el selector del header?
 *
 * No cuando vino de la URL: ahí manda el enlace, y ofrecer "volver a toda la
 * comunidad" desde el estado vacío tiene que sacar el parámetro, no escribir
 * una cookie que el `?zona=` va a seguir tapando.
 */
export function zonaVieneDeLaUrl(zona: ZonaActiva): boolean {
  return zona.origen === "url";
}
