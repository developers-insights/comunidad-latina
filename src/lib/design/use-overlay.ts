"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * ── LA PILA DE OVERLAYS ──────────────────────────────────────────────────────
 *
 * Desde que las acciones dejaron de navegar (rama "flujo sin cortes") pueden
 * convivir TRES hojas apiladas: publicación → comentarios → entrar. Eso rompió
 * dos supuestos que este módulo daba por ciertos desde que había una sola.
 *
 * Hallazgo de la revisión de código (2026-08-20), reproducido montando el árbol
 * real —`CommentsSheetProvider` padre, `PostSheetProvider` hijo—: abrir la hoja
 * de publicación, abrir comentarios encima y tocar Escape cerraba LAS DOS y
 * dejaba el `<body>` con `overflow: hidden` sin ninguna hoja abierta. La página
 * quedaba sin scroll hasta recargar.
 *
 * Las dos causas son de este archivo, y por eso el arreglo vive acá y no en
 * cada hoja:
 *
 *  1. `event.stopPropagation()` NO detiene a otro listener registrado en el
 *     MISMO nodo (para eso hace falta `stopImmediatePropagation`), y las tres
 *     hojas escuchan en `document`. Un Escape llegaba a todas.
 *  2. Cada capa guardaba el `overflow` previo POR INSTANCIA. Con dos hojas
 *     cerrándose en el mismo commit las limpiezas corren en orden de fiber: la
 *     de adentro restauraba `""` y la de afuera —que había medido cuando la de
 *     adentro ya tenía puesto `hidden`— restauraba `"hidden"`.
 *
 * La respuesta a las dos es la misma: el estado compartido tiene que ser
 * COMPARTIDO. Los registros de abajo son de módulo, no de instancia. Cada capa
 * se anota al activarse y se desanota al cerrarse; el orden de anotación es el
 * de apertura, que es también el orden visual (las hojas portalan a
 * `document.body`, y la que entra después queda arriba).
 *
 * El intento anterior de resolver (1) fue un interceptor propio de Escape en
 * fase de captura dentro de la hoja de entrada. Se borró junto con este cambio:
 * dos soluciones al mismo problema es peor que una, y esa sólo sabía defender a
 * la hoja que la tenía escrita.
 */

/** Capas que se disputan el teclado. La última anotada es la de más arriba. */
const keyboardLayers: symbol[] = [];

function isTopKeyboardLayer(layer: symbol): boolean {
  return keyboardLayers[keyboardLayers.length - 1] === layer;
}

/**
 * Focus trap para overlays (BottomSheet, Dialog):
 * mueve el foco adentro, ciclea con Tab, cierra con Escape y
 * devuelve el foco al elemento previo al cerrar (WCAG 2.4.3).
 *
 * Con hojas apiladas atiende el teclado SOLO la de más arriba: el Escape cierra
 * de a una, y el Tab ciclea dentro de la que se está mirando en vez de que la
 * de abajo se robe el foco de vuelta. Con una sola hoja abierta —el 95% de los
 * casos— siempre es la de arriba, así que no cambia nada.
 */
export function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  onEscape?: () => void,
) {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const layer = Symbol("overlay-keyboard-layer");
    keyboardLayers.push(layer);

    const focusables = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

    (focusables()[0] ?? node).focus();

    function onKeyDown(event: KeyboardEvent) {
      // No es "la hoja de arriba": el teclado no es suyo. Ni siquiera mira la
      // tecla — ver la pila de overlays al principio del archivo.
      if (!isTopKeyboardLayer(layer)) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        onEscapeRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const els = focusables();
      if (els.length === 0) {
        event.preventDefault();
        return;
      }
      const first = els[0];
      const last = els[els.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const index = keyboardLayers.lastIndexOf(layer);
      if (index !== -1) keyboardLayers.splice(index, 1);
      previouslyFocused?.focus();
    };
  }, [ref, active]);
}

/**
 * Cuántas capas piden el bloqueo, y cuánto valía `overflow` ANTES de la
 * primera. Se mide una sola vez —cuando entra la primera capa, o sea antes de
 * que nadie haya tocado el estilo— y se restaura una sola vez, cuando sale la
 * última. Ninguna capa intermedia lee el DOM, así que el orden en que se
 * desmonten deja de importar.
 */
let scrollLocks = 0;
let overflowBeforeLock: string | null = null;

/**
 * Bloquea el scroll del body mientras haya al menos un overlay abierto.
 *
 * Es el defecto que más dolía de los dos: dejaba la página inutilizable, sin
 * hojas a la vista y sin nada que tocar para recuperarla. Ver la explicación
 * completa en la pila de overlays, arriba.
 *
 * `overflow: hidden` y no `position: fixed` a propósito: fixed también bloquea,
 * pero manda el scrollTop a 0 y al cerrar la persona pierde dónde estaba
 * leyendo.
 */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    if (scrollLocks === 0) {
      overflowBeforeLock = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    scrollLocks += 1;
    return () => {
      scrollLocks -= 1;
      if (scrollLocks > 0) return;
      document.body.style.overflow = overflowBeforeLock ?? "";
      overflowBeforeLock = null;
    };
  }, [active]);
}

/**
 * ── EL "ATRÁS" DEL TELÉFONO ──────────────────────────────────────────────────
 *
 * Segundo hallazgo de la misma revisión. El visor de medios ya lo tenía
 * resuelto desde el 29/7 —apila una entrada de historial al abrir, y el
 * `popstate` la cierra— pero ninguna de las hojas nuevas lo hacía. Para la hoja
 * de publicación eso es una REGRESIÓN: antes la miniatura navegaba de verdad,
 * así que en Android el "atrás" volvía a la grilla; ahora abre una hoja y el
 * "atrás" saca del perfil entero. Con tres hojas abiertas, un "atrás" se
 * llevaba las tres y la página. Literalmente "te saca de la pantalla", que es
 * lo que esta rama vino a eliminar.
 *
 * Igual que con el teclado, el reparto tiene que decidirlo alguien que las vea
 * a todas: acá hay UN listener de módulo y una pila paralela a las entradas de
 * historial. Un `popstate` cierra la de más arriba y nada más.
 */
interface BackLayer {
  close: () => void;
  /** ¿Su entrada de historial sigue en pie? El "atrás" del teléfono la consume. */
  entryAlive: boolean;
}

const backLayers: BackLayer[] = [];

/**
 * Cuántos `popstate` provocamos NOSOTROS al consumir en silencio la entrada de
 * una hoja que se cerró por UI (Escape, la X, el scrim, el arrastre). Sin esto,
 * ese aviso lo atendería la hoja de abajo y se cerraría también — el mismo
 * defecto que el Escape, por el otro camino.
 *
 * Se arma sólo si abajo queda alguien escuchando. Con la pila vacía el aviso no
 * le puede hacer daño a nadie, y armar el contador igual sería dejar un pop
 * tragado esperando al próximo que llegue.
 */
let silentPops = 0;
let listeningToPopState = false;

function onOverlayPopState() {
  if (silentPops > 0) {
    silentPops -= 1;
    return;
  }
  const top = backLayers[backLayers.length - 1];
  if (!top) return;
  backLayers.pop();
  // El navegador ya consumió la entrada: cerrar no tiene que devolver nada.
  top.entryAlive = false;
  stopListeningIfIdle();
  top.close();
}

function registerBackLayer(layer: BackLayer) {
  backLayers.push(layer);
  if (listeningToPopState) return;
  window.addEventListener("popstate", onOverlayPopState);
  listeningToPopState = true;
}

function stopListeningIfIdle() {
  if (!listeningToPopState || backLayers.length > 0) return;
  window.removeEventListener("popstate", onOverlayPopState);
  listeningToPopState = false;
  // Sin capas no hay a quién proteger, y el contador arranca limpio la próxima.
  silentPops = 0;
}

/**
 * Cerrar con el gesto/botón "atrás" del teléfono, sin salirse de la pantalla.
 *
 * Se llama con el mismo booleano que abre el overlay y con su cierre de
 * siempre: al abrirse apila una entrada de historial, y el "atrás" la consume
 * cerrando SOLO esa capa. Al cerrarse por cualquier otro camino, la entrada se
 * consume en silencio para que la próxima vez el "atrás" siga valiendo un paso.
 *
 * Sin historial usable (SSR raro, `pushState` que lanza) no hace nada y los
 * demás caminos de cierre siguen intactos: nunca es la ÚNICA forma de salir.
 */
export function useCloseOnBack(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  /**
   * ¿Se está yendo el árbol entero, o sólo se cerró la hoja? Este efecto no
   * tiene dependencias, así que su limpieza corre SÓLO al desmontar — y corre
   * ANTES que la del efecto de abajo, porque las limpiezas de un componente van
   * en orden de declaración.
   *
   * La diferencia decide si tocamos el historial. Un desmontaje casi siempre lo
   * causa una navegación que YA está en curso: hacer `history.back()` ahí sería
   * cancelarle a la persona el paso que acaba de pedir. Preferimos dejar una
   * entrada extra —volver atrás la devuelve a la pantalla donde tenía la hoja
   * abierta, que es semántica correcta de navegador— antes que deshacerle la
   * navegación. El listener y la anotación en la pila, en cambio, se limpian
   * siempre.
   */
  const unmounting = useRef(false);
  useEffect(() => {
    unmounting.current = false;
    return () => {
      unmounting.current = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    const layer: BackLayer = {
      close: () => closeRef.current(),
      entryAlive: false,
    };
    try {
      window.history.pushState({ clOverlay: true }, "");
      layer.entryAlive = true;
    } catch {
      layer.entryAlive = false;
    }
    registerBackLayer(layer);

    return () => {
      const index = backLayers.lastIndexOf(layer);
      if (index !== -1) backLayers.splice(index, 1);
      stopListeningIfIdle();

      if (!layer.entryAlive || unmounting.current) return;
      layer.entryAlive = false;
      // Con alguien abajo, el pop que va a llegar es nuestro y no suyo.
      const armed = backLayers.length > 0;
      if (armed) silentPops += 1;
      try {
        window.history.back();
      } catch {
        if (armed && silentPops > 0) silentPops -= 1;
      }
    };
  }, [open]);
}

/** true recién tras el mount — evita portales durante SSR/hidratación. */
const emptySubscribe = () => () => {};
export function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}
