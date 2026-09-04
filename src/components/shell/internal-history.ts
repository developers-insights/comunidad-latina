/**
 * =============================================================================
 * ¿VOLVER ATRÁS ME DEJA ADENTRO DE LA APP?
 * =============================================================================
 *
 * `router.back()` a secas es una apuesta: si la persona llegó por un link que le
 * mandaron por WhatsApp, o abrió la app instalada (PWA) directo en una pantalla
 * profunda, la entrada anterior del historial NO es nuestra — es Google, es el
 * chat, o no existe — y "Volver" la saca de la app. Que es exactamente el
 * callejón que el cliente reportó, sólo que al revés.
 *
 * Así que antes de retroceder hay que poder contestar: **¿hay al menos una
 * entrada ANTERIOR que la haya puesto esta app?**
 *
 * ── QUÉ NO SIRVE PARA CONTESTARLA ─────────────────────────────────────────
 *  · `history.length`: cuenta TODA la pestaña. Alguien que venía de Google y
 *    tocó un link nuestro ya tiene length 2, y ese "atrás" se va a Google.
 *  · `document.referrer`: vacío en la PWA instalada y en cualquier navegación
 *    de cliente; es una respuesta que llega en blanco justo cuando importa.
 *  · `window.history.state.__NA` de Next: existe —el App Router lo escribe en
 *    CADA commit (`next/dist/client/components/app-router.js`)— pero vale
 *    `true` también en la primerísima carga, así que no distingue "primera
 *    entrada" de "quinta". Además es una clave privada del framework.
 *
 * ── LO QUE SÍ: sellar cada entrada con su profundidad ─────────────────────
 * `history.state` es el ÚNICO almacén por-entrada que da el navegador, y muere
 * con la pestaña igual que el historial. Cada entrada que crea la app se sella
 * con un número: 0 = fue la puerta de entrada, >0 = hay app atrás.
 *
 * El contador de la sesión vive en una variable de módulo (`lastDepth`), no en
 * `sessionStorage`: una navegación de cliente no reinicia el contexto JS, y una
 * recarga —que sí lo reinicia— vuelve a una entrada QUE YA ESTÁ SELLADA, así que
 * el número se recupera de ahí. Cero almacenamiento nuevo que declarar en el
 * inventario de privacidad (`@/lib/consent`), que es una deuda que no vale la
 * pena contraer por un botón de volver.
 *
 * ── EL SELLO NO PISA NADA DE NEXT ─────────────────────────────────────────
 * El App Router parchea `history.replaceState` y, si el `state` que le pasás ya
 * trae `__NA`, delega en el nativo SIN despachar ninguna acción de router (ver
 * el parche en app-router.js). Como acá siempre se escribe
 * `{ ...history.state, [STAMP]: n }`, el `__NA` viaja adentro y la llamada es
 * inerte para Next: ni re-render, ni refetch, ni cambio de URL.
 *
 * En sentido inverso tampoco hay pisada: en una navegación de cliente Next crea
 * la entrada nueva con `preserveCustomHistoryState: false` (o sea, sin nuestro
 * sello) y recién ahí la sellamos nosotros. El único commit que preserva estado
 * propio es el inicial — que es justo el que tiene que conservar el sello 0.
 *
 * ── DEGRADACIÓN ───────────────────────────────────────────────────────────
 * Ante la duda, la respuesta es NO: se navega al `fallbackHref` de la pantalla,
 * que siempre es un lugar de la app. El peor caso es un "Volver" que lleva a la
 * portada de la sección en vez de a la pantalla anterior — molesto, nunca un
 * callejón. Lo contrario (decir que sí cuando no) expulsa de la app, y eso no
 * se puede deshacer desde adentro.
 */

/**
 * Clave del sello dentro de `history.state`. Prefijo propio para no chocar con
 * `__NA` / `__PRIVATE_NEXTJS_INTERNALS_TREE` (Next) ni con nada que escriba una
 * librería de terceros.
 */
const STAMP = "clNavDepth";

/**
 * Profundidad de la última entrada que sellamos EN ESTE CONTEXTO JS.
 *
 * `null` = todavía no sellamos ninguna, o sea: recién se cargó la página
 * (entrada directa, recarga, o arranque en frío de la PWA).
 */
let lastDepth: number | null = null;

/**
 * `history.length` cuando sellamos por última vez. Sirve para distinguir una
 * ENTRADA NUEVA de la MISMA entrada reescrita: un `pushState` hace crecer el
 * largo, un `replaceState` no.
 *
 * Hace falta porque Next reescribe el estado de la entrada en cada commit y en
 * las navegaciones con `router.replace()` (los filtros de las portadas, el
 * login que reemplaza su propia URL) el sello se pierde. Sin este control, la
 * siguiente pasada lo tomaría por una entrada nueva y sumaría una profundidad
 * que no existe — o sea, diría "hay app atrás" cuando atrás está Google.
 */
let lastLength: number | null = null;

function readStamp(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const state = window.history.state as Record<string, unknown> | null;
    const raw = state?.[STAMP];
    return typeof raw === "number" ? raw : null;
  } catch {
    // `history.state` puede lanzar en contextos restringidos (iframes de
    // terceros, algunos modos privados viejos). Sin dato = sin historial.
    return null;
  }
}

/**
 * Sella la entrada actual del historial, si todavía no lo estaba.
 *
 * Idempotente a propósito: se llama en cada navegación y también dos veces por
 * navegación (ver `internal-history-tracker.tsx`), y volver a una entrada ya
 * sellada —back, forward, recarga— sólo recupera su número.
 */
export function markInternalNavigation(): void {
  if (typeof window === "undefined") return;

  const length = window.history.length;
  const stamped = readStamp();
  if (stamped !== null) {
    lastDepth = stamped;
    lastLength = length;
    return;
  }

  /**
   * Entrada sin sello. Es NUEVA sólo si el historial creció; si no, es la misma
   * de antes con el estado reescrito y conserva su profundidad.
   *
   * Cuando el largo no crece pero la entrada sí es nueva (pasa después de un
   * "atrás": el push pisa la entrada de adelante y el largo queda igual) nos
   * quedamos cortos, y eso está elegido: quedarse corto manda al `fallbackHref`
   * —que siempre es un lugar de la app— y pasarse expulsa de la app.
   */
  const esNueva = lastLength === null || length > lastLength;
  const depth = esNueva ? (lastDepth ?? -1) + 1 : (lastDepth ?? 0);
  lastDepth = depth;
  lastLength = length;
  try {
    // Sin tercer argumento: la URL NO se toca (pasar "" la resolvería contra la
    // base del documento y se comería el query string).
    window.history.replaceState({ ...window.history.state, [STAMP]: depth }, "");
  } catch {
    // Si el navegador no deja escribir el estado, `lastDepth` sigue siendo la
    // respuesta para esta sesión de JS. Peor caso: una recarga pierde el rastro
    // y se cae al fallback.
  }
}

/** ¿Hay al menos una entrada anterior puesta por esta app? */
export function hasInternalHistory(): boolean {
  if (typeof window === "undefined") return false;
  // El sello de ESTA entrada manda; si la entrada no está sellada (una
  // navegación que el tracker no llegó a ver, p. ej. un cambio de `?filtro=`),
  // vale lo último que sí sellamos en este contexto.
  const depth = readStamp() ?? lastDepth;
  return depth !== null && depth > 0;
}

/**
 * Sella la entrada NUEVA en el instante en que Next la crea.
 *
 * `markInternalNavigation` corre en un efecto (más un tick), y eso alcanza
 * cuando la ruta ya está en caché. En la PRIMERA visita a una sección, Next
 * hace el `pushState` recién al terminar de traer los datos del servidor —
 * después del efecto y del tick — y la entrada nacía sin sello: `readStamp()`
 * daba null, `lastDepth` seguía en el valor de la pantalla anterior, y
 * "Volver" caía al fallback. Visto en vivo el 2026-09-04 (feed → Empleos →
 * Volver → `/buscar`). Envolver `window.history.pushState` cierra el hueco:
 * Next lo invoca por el global (`app-router.js`: `window.history.pushState(...)`),
 * así que toda entrada nueva pasa por acá, con o sin caché.
 *
 * `popstate` (atrás/adelante del navegador) resincroniza `lastDepth` con el
 * sello de la entrada a la que se llegó, para que un "Volver" posterior lea
 * el número correcto aunque el tracker no haya vuelto a correr.
 *
 * Devuelve la función que deshace el envoltorio (cleanup del efecto).
 */
export function installHistoryStamping(): () => void {
  if (typeof window === "undefined") return () => {};
  const history = window.history;
  const original = history.pushState;

  const envuelto = function (this: History, data: unknown, unused: string, url?: string | URL | null) {
    const result = original.call(this, data, unused, url);
    // Entrada nueva: una más de profundidad que la anterior, sellada ya mismo.
    // Si la inicial todavía no se selló (`lastDepth` null), igual hay una
    // entrada anterior: la que se acaba de dejar atrás.
    const depth = (lastDepth ?? 0) + 1;
    lastDepth = depth;
    lastLength = this.length;
    try {
      this.replaceState({ ...(this.state as Record<string, unknown> | null), [STAMP]: depth }, "");
    } catch {
      // Mismo caso que en markInternalNavigation: `lastDepth` sigue valiendo
      // para esta sesión de JS.
    }
    return result;
  } as History["pushState"];

  history.pushState = envuelto;

  const onPopState = () => {
    const stamped = readStamp();
    if (stamped !== null) {
      lastDepth = stamped;
      lastLength = history.length;
    }
  };
  window.addEventListener("popstate", onPopState);

  return () => {
    if (history.pushState === envuelto) history.pushState = original;
    window.removeEventListener("popstate", onPopState);
  };
}
