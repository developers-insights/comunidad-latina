import { sanitizeSearchQuery } from "./helpers";

/**
 * Historial de búsquedas — últimas 8, en `localStorage`.
 *
 * POR QUÉ LA CLAVE LLEVA TENANT + PERSONA
 * ---------------------------------------
 * Un término de búsqueda no es un dato neutro: "abogado de inmigración",
 * "cuarto barato", "trabajo sin papeles" dicen mucho de quien los escribió.
 * En un teléfono compartido —que es el caso REAL de esta comunidad, no una
 * hipótesis— un historial global significa que la próxima persona que entra ve
 * lo que buscó la anterior.
 *
 * Por eso la clave se arma en el servidor con `historyStorageKey(tenant, uid)`
 * y se le pasa a la isla: cada persona logueada tiene su propio cajón y nadie
 * lee el del otro. Las sesiones SIN login comparten el cajón `anon`, que es
 * exactamente el mismo alcance que cualquier otro estado anónimo del navegador
 * — no se rompe nada por guardarlo, así que se guarda (una barra vacía sin
 * historial es una pantalla muda, y ese era el punto de tenerlo).
 *
 * Lo que NO hace: borrar el cajón de la persona anterior al cambiar de sesión.
 * Queda huérfano en `localStorage` y es inalcanzable desde la UI. Limpiarlo de
 * verdad requiere engancharse al logout, que vive en `(auth)/` — fuera de este
 * frente. Anotado como dependencia.
 */

export const HISTORY_LIMIT = 8;

const KEY_PREFIX = "cl:buscar:historial";

/** `cl:buscar:historial:{tenant}:{uid|anon}` — ver el bloque de arriba. */
export function historyStorageKey(tenantSlug: string, userId: string | null): string {
  return `${KEY_PREFIX}:${tenantSlug}:${userId ?? "anon"}`;
}

/**
 * Parseo TOLERANTE de lo que haya en `localStorage`. Todo lo que no sea un
 * arreglo de strings usables se descarta sin lanzar: el contenido puede venir
 * de una versión anterior de la app, de otra pestaña, o de alguien que lo editó
 * a mano en las devtools. Un historial corrupto no puede tumbar la búsqueda.
 */
export function parseHistory(raw: string | null): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry !== "string") continue;
    const term = sanitizeSearchQuery(entry);
    if (term.length === 0) continue;
    const key = term.toLocaleLowerCase("es");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= HISTORY_LIMIT) break;
  }
  return out;
}

/**
 * Agrega un término al frente. Deduplica SIN distinguir mayúsculas ni acentos
 * de más ("Bogotá" y "bogotá" son la misma búsqueda), conservando la escritura
 * más reciente, y recorta a las últimas 8.
 */
export function pushHistory(history: readonly string[], value: string): string[] {
  const term = sanitizeSearchQuery(value);
  if (term.length === 0) return [...history];
  const key = term.toLocaleLowerCase("es");
  const rest = history.filter((entry) => entry.toLocaleLowerCase("es") !== key);
  return [term, ...rest].slice(0, HISTORY_LIMIT);
}

/** Quita UN término (el botón "×" de cada fila). */
export function removeFromHistory(history: readonly string[], value: string): string[] {
  const key = sanitizeSearchQuery(value).toLocaleLowerCase("es");
  return history.filter((entry) => entry.toLocaleLowerCase("es") !== key);
}

// ---------------------------------------------------------------------------
// Acceso a localStorage — SIEMPRE envuelto
// ---------------------------------------------------------------------------
//
// `localStorage` lanza, no devuelve null, en tres casos que pasan de verdad:
// Safari en navegación privada, cuota llena, y cookies de terceros bloqueadas
// en un iframe. Ninguno puede romper la búsqueda: sin historial se busca igual.

export function readHistory(storageKey: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    return parseHistory(window.localStorage.getItem(storageKey));
  } catch {
    return [];
  }
}

function persist(storageKey: string, history: readonly string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
  } catch {
    // Sin historial persistido; la sesión en curso sigue funcionando.
  }
}

// ---------------------------------------------------------------------------
// Store para `useSyncExternalStore`
// ---------------------------------------------------------------------------
//
// `localStorage` es un sistema externo a React, y esta es la forma que React
// tiene para leerlo: `getServerSnapshot` devuelve vacío (en el servidor no hay
// historial que renderizar) y `getSnapshot` devuelve el real en el cliente.
// React sabe reconciliar esa diferencia después de hidratar.
//
// La alternativa —`useState([])` + un `useEffect` que hace `setHistory`— es
// justamente lo que la regla `react-hooks/set-state-in-effect` marca: un render
// en cascada garantizado en cada montaje. Y sembrar el estado inicial leyendo
// `localStorage` tampoco sirve: el servidor no pudo haber pintado esas filas y
// la hidratación falla.
//
// Regalo del camino: dos superficies que muestren el historial quedan
// sincronizadas solas, y el evento `storage` lo mantiene al día entre pestañas.

const listeners = new Set<() => void>();

/**
 * `getSnapshot` DEBE devolver siempre la misma referencia mientras el dato no
 * cambie, o React entra en un bucle de renders ("The result of getSnapshot
 * should be cached"). De ahí este cache de una sola entrada.
 */
let cacheKey: string | null = null;
let cacheValue: readonly string[] = [];

/** Referencia estable para el snapshot del servidor (y para el cache vacío). */
export const EMPTY_HISTORY: readonly string[] = [];

export function subscribeHistory(listener: () => void): () => void {
  listeners.add(listener);
  // Otra pestaña borró el historial ⇒ esta lo refleja. Un "borrar todo" que
  // sólo limpia la pestaña donde se tocó no es haber borrado nada.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === cacheKey) {
      cacheKey = null; // fuerza la relectura en el próximo snapshot
      for (const notify of listeners) notify();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function historySnapshot(storageKey: string): readonly string[] {
  if (cacheKey !== storageKey) {
    cacheKey = storageKey;
    const stored = readHistory(storageKey);
    cacheValue = stored.length === 0 ? EMPTY_HISTORY : stored;
  }
  return cacheValue;
}

export function serverHistorySnapshot(): readonly string[] {
  return EMPTY_HISTORY;
}

/** Escribe, actualiza el cache y avisa a quien esté suscripto. */
function commitHistory(storageKey: string, next: readonly string[]): void {
  persist(storageKey, next);
  cacheKey = storageKey;
  cacheValue = next.length === 0 ? EMPTY_HISTORY : [...next];
  for (const notify of listeners) notify();
}

export function addToHistory(storageKey: string, term: string): void {
  commitHistory(storageKey, pushHistory(historySnapshot(storageKey), term));
}

export function dropFromHistory(storageKey: string, term: string): void {
  commitHistory(storageKey, removeFromHistory(historySnapshot(storageKey), term));
}

export function clearStoredHistory(storageKey: string): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // idem: sin persistencia, pero la pantalla se limpia igual.
    }
  }
  cacheKey = storageKey;
  cacheValue = EMPTY_HISTORY;
  for (const notify of listeners) notify();
}
