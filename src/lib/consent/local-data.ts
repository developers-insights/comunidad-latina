/**
 * Enumerar y borrar lo que la app dejó en ESTE navegador.
 *
 * Existe para que "borrá tus datos" deje de ser una instrucción de soporte
 * ("andá a la configuración de tu navegador y buscá…") y pase a ser un botón.
 * La gente a la que le hablamos no va a entrar al menú de privacidad de Chrome.
 *
 * REGLA DURA: nunca se toca la sesión.
 * Las claves de Supabase (`sb-…-auth-token`) son de categoría "necesarias".
 * Barrerlas dejaría a la persona deslogueada de golpe, sin haberlo pedido, con
 * un botón que prometía borrar preferencias. Por eso el borrado se hace por
 * lista blanca de prefijos propios y no con `localStorage.clear()`.
 */

import { notifyConsentChange } from "./store";

/** Prefijos de las claves que SÍ se pueden borrar (categoría "preferencias"). */
const CLEARABLE_PREFIXES = [
  "cl-theme",
  "cl:buscar:historial",
  "cl-guias-offline",
  "cl-pwa-",
] as const;

/**
 * `cl-consent` NO se borra acá: es la decisión de privacidad de la persona.
 * Perderla al limpiar preferencias haría que la app volviera a preguntar como
 * si nunca hubiera respondido. Para eso está "Volver a preguntarme", que es un
 * acto aparte y explícito.
 */
const NEVER_CLEAR = ["cl-consent"] as const;

export interface LocalEntry {
  key: string;
  /** Bytes aproximados que ocupa. Sirve para mostrar que "algo hay". */
  size: number;
  store: "local" | "session";
}

function safeKeys(storage: Storage): string[] {
  try {
    return Object.keys(storage);
  } catch {
    // Storage bloqueado (modo privado, storage particionado): no hay nada que
    // listar y tampoco nada que borrar.
    return [];
  }
}

export function isClearable(key: string): boolean {
  if ((NEVER_CLEAR as readonly string[]).includes(key)) return false;
  return CLEARABLE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Lo que hay ahora mismo en este navegador y se puede borrar. */
export function listLocalData(): LocalEntry[] {
  if (typeof window === "undefined") return [];
  const out: LocalEntry[] = [];

  for (const key of safeKeys(window.localStorage)) {
    if (!isClearable(key)) continue;
    let size = 0;
    try {
      size = window.localStorage.getItem(key)?.length ?? 0;
    } catch {
      /* ignorar */
    }
    out.push({ key, size, store: "local" });
  }

  for (const key of safeKeys(window.sessionStorage)) {
    if (!isClearable(key)) continue;
    let size = 0;
    try {
      size = window.sessionStorage.getItem(key)?.length ?? 0;
    } catch {
      /* ignorar */
    }
    out.push({ key, size, store: "session" });
  }

  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Borra las preferencias locales. Devuelve cuántas claves sacó, para poder
 * confirmarle a la persona que algo pasó de verdad.
 */
export function clearLocalData(): number {
  if (typeof window === "undefined") return 0;
  const entries = listLocalData();

  for (const entry of entries) {
    try {
      const storage = entry.store === "local" ? window.localStorage : window.sessionStorage;
      storage.removeItem(entry.key);
    } catch {
      /* si una falla, seguimos con las demás */
    }
  }

  // Despertar a la UI: sin esto la lista sigue mostrando lo que ya no está.
  notifyConsentChange();
  return entries.length;
}

/**
 * Borra también las copias de fotos que guardó el service worker. Es la otra
 * mitad de "borrar lo de este teléfono": el Cache Storage no vive en
 * localStorage y `clearLocalData()` no lo alcanza.
 */
export async function clearCachedMedia(): Promise<number> {
  if (typeof window === "undefined" || !("caches" in window)) return 0;
  try {
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
    return names.length;
  } catch {
    return 0;
  }
}
