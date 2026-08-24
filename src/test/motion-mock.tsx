import { createElement, type ReactNode } from "react";

/**
 * =============================================================================
 * `motion/react` NEUTRALIZADO — un solo mock para toda la suite
 * =============================================================================
 *
 * Bajo jsdom las animaciones no corren, así que cualquier componente montado
 * dentro de un `<motion.div>` aparecería con `opacity: 0` y los tests no
 * podrían encontrarlo. Todos los tests de este repo que tocan una hoja, un
 * visor o una tarjeta animada neutralizan `motion/react` por eso.
 *
 * ── POR QUÉ ESTE ARCHIVO EXISTE ─────────────────────────────────────────────
 * El mock estaba COPIADO en 16 archivos de test, cada uno con su propia
 * variante: unos exponían `m: { div }`, otros `{ div, span, p }`, otros un
 * `passthrough(tag)` propio. Y los 16 filtraban las props de motion
 * destructurándolas para descartarlas:
 *
 *     const { layout, initial, animate, exit, transition, drag, …, ...rest } = props;
 *
 * Eso es válido y es también la fuente de **147 de los 148 warnings de lint del
 * proyecto** (`no-unused-vars`, 11 por archivo): las variables se declaran
 * justamente para no usarlas. Un ruido de ese tamaño tiene un costo real —
 * esconde el warning número 148, que sí puede importar.
 *
 * Acá se filtra por LISTA DE CLAVES en vez de por destructuring. Mismo
 * resultado, cero variables sin usar.
 *
 * ── EL PROXY, Y POR QUÉ NO UNA LISTA DE TAGS ────────────────────────────────
 * `m` y `motion` son un Proxy que devuelve un passthrough para cualquier tag.
 * Con una lista fija (`{ div, span, p }`) el día que alguien anime un `<ul>` el
 * test falla con "undefined is not a component", que no dice nada sobre la
 * causa. El Proxy no tiene ese modo de fallar.
 *
 * Se devuelve `undefined` para símbolos y para `then`: vitest y React sondean
 * esas claves para saber si un módulo es un thenable o un elemento, y un Proxy
 * que contesta a todo con una función los confunde.
 *
 * ── CÓMO SE USA ─────────────────────────────────────────────────────────────
 *     vi.mock("motion/react", async () => (await import("@/test/motion-mock")).motionMock());
 *
 * El `await import` es necesario porque `vi.mock` se hoistea por encima de los
 * imports del archivo: una referencia directa daría "cannot access before
 * initialization".
 */

/**
 * Props que `motion` consume y que un `<div>` normal no entiende. Si llegaran al
 * DOM, React avisaría por consola en cada render ("unknown prop").
 */
const MOTION_PROPS = new Set([
  "layout",
  "layoutId",
  "layoutDependency",
  "initial",
  "animate",
  "exit",
  "transition",
  "variants",
  "custom",
  "drag",
  "dragConstraints",
  "dragElastic",
  "dragMomentum",
  "dragSnapToOrigin",
  "onDragStart",
  "onDrag",
  "onDragEnd",
  "whileTap",
  "whileHover",
  "whileFocus",
  "whileDrag",
  "whileInView",
  "viewport",
  "onAnimationStart",
  "onAnimationComplete",
]);
// OJO: `style` NO está en la lista a propósito. Es una prop legítima del DOM y
// los 16 mocks originales tampoco la filtraban; sacarla rompería cualquier test
// que compruebe un estilo en línea.

type Props = Record<string, unknown> & { children?: ReactNode };

function sinPropsDeMotion(props: Props): Record<string, unknown> {
  const limpio: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(props)) {
    if (!MOTION_PROPS.has(clave)) limpio[clave] = valor;
  }
  return limpio;
}

function passthrough(tag: string) {
  const Componente = ({ children, ...props }: Props) =>
    createElement(tag, sinPropsDeMotion(props), children);
  Componente.displayName = `motion.${tag}`;
  return Componente;
}

const porTag = new Proxy({} as Record<string, ReturnType<typeof passthrough>>, {
  get(cache, clave) {
    // `then` y los símbolos los sondean vitest y React; contestarles con una
    // función los haría tratar este objeto como un thenable o un elemento.
    if (typeof clave !== "string" || clave === "then") return undefined;
    cache[clave] ??= passthrough(clave);
    return cache[clave];
  },
});

/**
 * El módulo `motion/react` entero, neutralizado. Ver el docblock de arriba.
 *
 * `reducedMotion` es parámetro y no constante porque los dos valores se usan y
 * significan cosas distintas: `true` (el default) apaga la animación y es lo que
 * quiere un test que sólo necesita ver el contenido; `false` es lo que quiere un
 * test que justamente comprueba el camino animado.
 *
 * Y acepta una FUNCIÓN además de un booleano porque hay tests que lo cambian a
 * mitad de camino — `comments-sheet.test.tsx` arranca con la animación prendida,
 * comprueba que el hilo se desplaza solo, y después la apaga para comprobar que
 * se detiene. Con un valor fijo esa segunda mitad no se puede escribir.
 */
export function motionMock(
  { reducedMotion = true }: { reducedMotion?: boolean | (() => boolean) } = {},
) {
  return {
    AnimatePresence: ({ children }: { children?: ReactNode }) => children,
    LayoutGroup: ({ children }: { children?: ReactNode }) => children,
    MotionConfig: ({ children }: { children?: ReactNode }) => children,
    m: porTag,
    motion: porTag,
    useReducedMotion: () =>
      typeof reducedMotion === "function" ? reducedMotion() : reducedMotion,
  };
}
