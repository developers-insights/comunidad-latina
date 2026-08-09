/**
 * Nombre de usuario (handle) — espejo EXACTO de lo que valida la base.
 *
 * ── POR QUÉ ESTO ES UN ESPEJO Y NO "LA" VALIDACIÓN ───────────────────────────
 * La verdad vive en la migración 0062: el trigger `app.normalize_profile_username`
 * pasa a minúsculas y recorta, y el CHECK `profiles_username_format` exige
 * `^[a-z0-9](?:[a-z0-9._]{1,28}[a-z0-9])$` DESPUÉS de normalizar. Este módulo
 * repite esas dos reglas para poder decirle a la persona qué corregir mientras
 * escribe, en vez de mandarla a un error opaco del servidor.
 *
 * Si las dos se separan, gana la base: acá sólo puede haber reglas IGUALES o
 * MÁS estrictas, nunca más laxas. Lo cuida `username.test.ts`.
 *
 * ── LA UNICIDAD NO SE VALIDA ACÁ ─────────────────────────────────────────────
 * Es POR TENANT y sólo la puede resolver el índice `profiles_username_tenant_uniq`.
 * Cualquier chequeo previo ("¿está libre?") es una carrera perdida: entre la
 * consulta y el insert alguien más puede tomarlo. El servidor escribe y captura
 * el `23505`, que es el único momento en que la respuesta es verdad.
 */

/** Igual que el trigger `app.normalize_profile_username()` de 0062. */
export function normalizeUsername(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const normalized = raw.trim().toLowerCase();
  return normalized === "" ? null : normalized;
}

/** El mismo patrón del CHECK `profiles_username_format` (0062). */
const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._]{1,28}[a-z0-9])$/;

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;

export type UsernameProblem = "vacio" | "corto" | "largo" | "formato" | "bordes";

/**
 * Qué tiene de malo un handle, o `null` si está bien.
 *
 * Devuelve un CÓDIGO y no un texto: el mensaje que ve la persona depende de la
 * pantalla, y un módulo de dominio que también escribe copy termina teniendo dos
 * dueños. El mapa código→texto vive en la UI.
 */
export function usernameProblem(raw: string): UsernameProblem | null {
  const value = normalizeUsername(raw);
  if (value === null) return "vacio";
  if (value.length < USERNAME_MIN_LENGTH) return "corto";
  if (value.length > USERNAME_MAX_LENGTH) return "largo";
  if (USERNAME_PATTERN.test(value)) return null;

  // Dos diagnósticos distintos para que el mensaje pueda ser útil: "usaste un
  // caracter que no va" no es lo mismo que "no puede empezar con un punto".
  if (/^[._]|[._]$/.test(value)) return "bordes";
  return "formato";
}

export function isValidUsername(raw: string): boolean {
  return usernameProblem(raw) === null;
}

/**
 * ¿Este error de Postgres es "ese handle ya está tomado"?
 *
 * `23505` es unique_violation genérico — la fila de `profiles` tiene además la
 * PK y podría ganar otros índices en el futuro, así que mirar sólo el código
 * haría que un choque de PK se reportara como "elegí otro nombre de usuario",
 * que es exactamente el mensaje que no ayuda a nadie. Por eso se exige además
 * que el nombre del índice aparezca en el detalle que manda PostgREST.
 */
export function isUsernameTakenError(
  error: { code?: string | null; message?: string | null; details?: string | null } | null,
): boolean {
  if (!error || error.code !== "23505") return false;
  const haystack = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return haystack.includes("username");
}

/**
 * Sugerencia de handle a partir del nombre visible. Se ofrece como valor inicial
 * del campo, NUNCA se guarda sin que la persona lo vea: un handle es identidad
 * pública y que aparezca solo es la forma más rápida de que nadie lo revise.
 *
 * Devuelve `""` cuando no queda nada usable (un nombre de puros emojis, por
 * ejemplo) para que la UI muestre el campo vacío en vez de un handle raro.
 */
export function suggestUsername(displayName: string): string {
  const base = displayName
    .normalize("NFD")
    // "Martínez" → "Martinez": el CHECK de la base sólo acepta a-z0-9._
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+|\.+$/g, "");

  if (base.length < USERNAME_MIN_LENGTH) return "";
  return base.slice(0, USERNAME_MAX_LENGTH).replace(/[._]+$/, "");
}
