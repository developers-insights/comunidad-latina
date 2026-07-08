"use client";

import {
  DEFAULT_THEME,
  MEDIA_QUERY,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type Theme,
} from "./constants";

/**
 * Store del tema. Sin Context ni Provider: es estado global del documento, no
 * del árbol de React. Un módulo + `useSyncExternalStore` alcanza y evita que
 * cada layout tenga que envolver a sus hijos (mismo patrón que OfflineBanner).
 */

export interface ThemeSnapshot {
  /** Lo que el usuario eligió. */
  theme: Theme;
  /** Lo que se está viendo. `null` en el server y durante la hidratación. */
  resolvedTheme: ResolvedTheme | null;
}

/** El server no sabe el tema. Devolver `null` es honesto y evita el mismatch. */
const SERVER_SNAPSHOT: ThemeSnapshot = { theme: DEFAULT_THEME, resolvedTheme: null };

const listeners = new Set<() => void>();
let snapshot: ThemeSnapshot | null = null;

/**
 * Elección del usuario cuando NO se pudo persistir.
 *
 * `null` = el storage anda y es la fuente de verdad (caso normal; también deja
 * que el evento `storage` de otra pestaña gane). Distinto de `null` = el último
 * `setTheme()` no logró escribir, así que esta memoria manda hasta que una
 * escritura vuelva a funcionar.
 *
 * Sin esto el toggle era un botón MUERTO en Chrome/Edge con "bloquear todos los
 * datos de sitios", en Firefox con cookies en "bloquear todo", y en un iframe
 * cross-origin con storage particionado denegado (ahí `window.localStorage`
 * lanza SecurityError en TODO acceso): `setTheme()` escribía, fallaba en
 * silencio, y acto seguido `refreshSnapshot()` volvía a LEER el storage —
 * descartando el argumento recién recibido— y recalculaba 'system'. El snapshot
 * quedaba idéntico, así que ni el DOM ni `aria-pressed` se movían.
 *
 * Se decide por el resultado de la ESCRITURA, no por el de la lectura: si
 * `setItem` tira por cuota mientras `getItem` funciona, releer devolvería el
 * valor viejo y el tema revertiría igual.
 */
let memoryTheme: Theme | null = null;

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

function readStoredTheme(): Theme {
  if (memoryTheme !== null) return memoryTheme;
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    // Storage ilegible y el usuario todavía no eligió nada: seguimos al sistema.
    return DEFAULT_THEME;
  }
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia(MEDIA_QUERY).matches ? "dark" : "light";
}

function resolve(theme: Theme): ResolvedTheme {
  return theme === "system" ? systemTheme() : theme;
}

/**
 * Estampa la clase en <html>: el mismo contrato que el script pre-paint.
 *
 * Exportada porque hace falta REAFIRMARLA desde el cliente, no sólo al cambiar
 * de tema: React trata <html> como HostSingleton y, al montarlo o desmontarlo
 * (p. ej. cuando el árbol cae al global-error boundary y vuelve por `reset()`),
 * borra TODOS sus atributos —incluida la clase de tema— y aplica sólo los props
 * del elemento nuevo (react-dom `acquireSingletonInstance` /
 * `releaseSingletonInstance`). El <ThemeScript /> no se re-ejecuta: React crea
 * los <script> con el truco de "already started", así que nunca corren.
 */
export function applyToDocument(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
}

function computeSnapshot(): ThemeSnapshot {
  const theme = readStoredTheme();
  return { theme, resolvedTheme: resolve(theme) };
}

/**
 * `useSyncExternalStore` exige una referencia estable: si devolviéramos un
 * objeto nuevo en cada llamada, React re-renderizaría para siempre.
 */
function refreshSnapshot(): void {
  const next = computeSnapshot();
  if (
    snapshot &&
    snapshot.theme === next.theme &&
    snapshot.resolvedTheme === next.resolvedTheme
  ) {
    return;
  }
  snapshot = next;
}

export function getSnapshot(): ThemeSnapshot {
  if (snapshot === null) refreshSnapshot();
  return snapshot!;
}

export function getServerSnapshot(): ThemeSnapshot {
  return SERVER_SNAPSHOT;
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  // Sólo el primer suscriptor cablea los listeners del documento.
  if (listeners.size === 1) attachDocumentListeners();

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) detachDocumentListeners();
  };
}

let mediaQueryList: MediaQueryList | null = null;

function onSystemChange(): void {
  // Sólo importa si el usuario nunca eligió: `system` sigue al SO en vivo.
  if (getSnapshot().theme !== "system") return;
  refreshSnapshot();
  applyToDocument(getSnapshot().resolvedTheme!);
  emit();
}

function onStorageChange(event: StorageEvent): void {
  if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
  refreshSnapshot();
  applyToDocument(getSnapshot().resolvedTheme!);
  emit();
}

function onThemeChange(): void {
  refreshSnapshot();
  emit();
}

function attachDocumentListeners(): void {
  mediaQueryList = window.matchMedia(MEDIA_QUERY);
  mediaQueryList.addEventListener("change", onSystemChange);
  window.addEventListener("storage", onStorageChange);
  window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
}

function detachDocumentListeners(): void {
  mediaQueryList?.removeEventListener("change", onSystemChange);
  mediaQueryList = null;
  window.removeEventListener("storage", onStorageChange);
  window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
}

/** Persiste la elección, la aplica al DOM y avisa a todos los hooks montados. */
export function setTheme(theme: Theme): void {
  try {
    if (theme === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, theme);
    // Persistió: el storage vuelve a ser la fuente de verdad (y con él, la
    // sincronización entre pestañas).
    memoryTheme = null;
  } catch {
    // No persistió (storage bloqueado o sin cuota): la elección se pierde al
    // recargar, pero el tema SÍ cambia en esta sesión.
    memoryTheme = theme;
  }
  refreshSnapshot();
  applyToDocument(getSnapshot().resolvedTheme!);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

/** Alterna claro↔oscuro fijando una preferencia explícita (sale de `system`). */
export function toggleTheme(): void {
  setTheme(getSnapshot().resolvedTheme === "dark" ? "light" : "dark");
}
