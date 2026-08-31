"use client";

import type { ReactNode } from "react";
import { LikeBurst } from "@/components/motion";
import { cn } from "@/lib/utils";

/**
 * =============================================================================
 * LA BARRA DE ACCIONES, EN UN SOLO LUGAR
 * =============================================================================
 *
 * Feedback cliente 2026-08-31, dos pedidos que resultaron ser el mismo archivo:
 *
 *   1. «agregar un poco más de color a los post» (mandó de referencia la barra
 *      de reacciones de Facebook, a color);
 *   2. la barra COMPLETA —me gusta · comentar · compartir · guardar— también en
 *      las tarjetas de ficha, que hasta hoy sólo tenían "Ver detalles".
 *
 * Antes de este archivo la barra vivía entera adentro de `post-actions.tsx`, o
 * sea que darle la misma barra a las fichas era copiarla. Acá quedan las tres
 * cosas que las dos barras tienen que compartir o se van a separar solas: la
 * GEOMETRÍA del botón, las cuatro TINTAS y cómo se dibuja el estado activo.
 *
 * ── POR QUÉ NO SON REACCIONES MÚLTIPLES ────────────────────────────────────
 * La referencia que mandó el cliente es la barra de Facebook, pero el pedido
 * fue «más color», no «cambiar el modelo de reacciones». Así que el modelo no
 * se toca: un me gusta, una vez, como hasta ahora.
 *
 * Lo que sí queda abierto es la puerta: los 60 emojis propios de la comunidad
 * que el cliente pidió aparte entran por `ActionTone` (una tinta más en
 * globals.css + una fila en TONE) y por `ActionToggle`, que ya sabe dibujar
 * "activo" para cualquier tono. Nada de esto está atado a los cuatro de hoy.
 *
 * ── EL COLOR NUNCA ES LA ÚNICA SEÑAL (WCAG 1.4.1) ──────────────────────────
 * Con la barra gris, "activo" se leía por el color y listo. Ahora que los
 * cuatro botones nacen con tinta, el estado tiene que decirse de otra forma o
 * se pierde. Se dice de tres:
 *
 *   · el PESO del glifo — Phosphor `regular` (línea de pelo) → `fill` (masa
 *     sólida). Es el salto más grande de los tres y se ve sin color;
 *   · un LAVADO del mismo tono detrás del botón (12%), que en reposo no está;
 *   · `aria-pressed`, que es lo que escucha un lector de pantalla.
 *
 * Y las tintas son alias de la familia `-ink` (ver globals.css): AA sobre las
 * cinco superficies, en los dos temas, medido por test y no por comentario.
 */

/** Íconos 22px / área táctil 44px (§3.2, §4). Lo comparten las dos barras. */
export const ACTION_ICON = 22;

/**
 * Las cuatro acciones sociales. Es el tipo que hay que ampliar el día que
 * entren los emojis de la comunidad — y el compilador va a pedir su tinta.
 */
export type ActionTone = "like" | "comment" | "share" | "save";

interface ToneStyles {
  /** La tinta del glifo y del número. Siempre puesta: también en reposo. */
  ink: string;
  /** Fondo en reposo — transparente; el tono aparece recién al pasar por arriba. */
  rest: string;
  /** Fondo activo: el mismo tono, lavado, para que el botón se sienta encendido. */
  active: string;
  /** Color de las partículas del burst (decorativo). */
  particle: string;
}

/**
 * Las clases se escriben ENTERAS y literales: Tailwind escanea el archivo y una
 * clase armada por concatenación (`text-action-${tone}`) no existiría en el CSS
 * final. Es la razón de que esta tabla sea repetitiva a propósito.
 */
const TONE: Record<ActionTone, ToneStyles> = {
  like: {
    ink: "text-action-like",
    rest: "hover:bg-action-like/8",
    active: "bg-action-like/12 hover:bg-action-like/18",
    particle: "var(--color-action-like)",
  },
  comment: {
    ink: "text-action-comment",
    rest: "hover:bg-action-comment/8",
    active: "bg-action-comment/12 hover:bg-action-comment/18",
    particle: "var(--color-action-comment)",
  },
  share: {
    ink: "text-action-share",
    rest: "hover:bg-action-share/8",
    active: "bg-action-share/12 hover:bg-action-share/18",
    particle: "var(--color-action-share)",
  },
  save: {
    ink: "text-action-save",
    rest: "hover:bg-action-save/8",
    active: "bg-action-save/12 hover:bg-action-save/18",
    particle: "var(--color-action-save)",
  },
};

/**
 * Geometría del botón. `min-w-11` + `min-h-11` = los 44px de §3.2 aunque el
 * contenido sea un solo ícono, y `px-2.5` chico para que las cuatro acciones
 * entren en 375px sin scroll horizontal (con el CTA de la ficha debajo).
 */
/**
 * LA ACCIÓN ES UNA COLUMNA, NO UNA FILA — pedido del cliente (2026-08-31, con
 * captura): el ícono con su número arriba, y debajo la palabra.
 *
 * No es sólo estética. La versión en fila obligaba a esconder las palabras
 * (`hidden sm:inline`) porque cuatro acciones con texto al lado del ícono no
 * entran en 375 px, y un ícono solo es una adivinanza: el de compartir y el de
 * guardar se confunden, y quien no usa redes no tiene por qué saberlos. En
 * columna la palabra entra SIEMPRE, en los cuatro y en cualquier ancho, porque
 * cada acción ocupa un cuarto del ancho en vez de la suma de ícono + texto.
 *
 * `flex-1` reparte el ancho en cuatro partes iguales: así los divisores caen
 * parejos y la fila se lee como una sola pieza, no como cuatro botones sueltos
 * que se acomodaron donde entraron.
 */
const ACTION_BASE = cn(
  "flex min-h-14 flex-1 select-none flex-col items-center justify-center gap-1 rounded-md px-1 py-2 text-sm font-medium",
  "transition-[transform,color,background-color] duration-(--duration-fast) ease-(--ease-spring)",
  "active:scale-[0.94]",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
);

/** Clases de un botón de la barra, con su tinta y su estado. */
export function actionClass(tone: ActionTone, active = false, extra?: string): string {
  const styles = TONE[tone];
  return cn(ACTION_BASE, styles.ink, active ? styles.active : styles.rest, extra);
}

/** Color de las partículas del `LikeBurst` de ese tono. */
export function actionParticleColor(tone: ActionTone): string {
  return TONE[tone].particle;
}

/** Contenedor de la fila. Existe para que las dos barras tengan el mismo ritmo. */
export function ActionRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // `divide-x` y no `gap`: el divisor sólo existe ENTRE acciones, así que
        // se dibuja solo y no hay que saber cuál es la última. Con gap habría
        // que elegir entre aire o línea; acá van las dos.
        "flex items-stretch divide-x divide-border-subtle",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * El renglón de arriba de una acción: el ícono y, si lo hay, su número.
 *
 * Va aparte del label para que el número quede pegado al ícono —son el mismo
 * dato: "24 me gusta"— y no flotando al lado de la palabra.
 */
export function ActionGlyph({ children }: { children: ReactNode }) {
  return <span className="flex items-center gap-1.5 leading-none">{children}</span>;
}

/**
 * La palabra debajo del ícono.
 *
 * Más chica que el número a propósito: lo que cambia entre publicaciones es el
 * contador, no la etiqueta. Si las dos pesaran igual, el ojo tendría que
 * releer "Me gusta" en cada tarjeta del feed para llegar al número.
 */
export function ActionLabel({ children }: { children: ReactNode }) {
  return <span className="text-[11px] leading-none tracking-tight">{children}</span>;
}

/**
 * Acción SIN estado (comentar, compartir): un botón normal, con tinta.
 *
 * `label` es el nombre accesible y `children` lo visible. Cuando el botón es
 * sólo ícono los dos no coinciden y está bien (WCAG 2.5.3 pide que coincidan
 * cuando HAY texto visible; acá no lo hay).
 */
export function ActionButton({
  tone,
  label,
  onClick,
  className,
  children,
}: {
  tone: ActionTone;
  label: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={actionClass(tone, false, className)}
    >
      {children}
    </button>
  );
}

/**
 * Acción CON estado (me gusta, guardar): el mismo botón, más la
 * micro-celebración que ya usaba el corazón.
 *
 * `LikeBurst` pone el `<button>`, el `aria-pressed` y el burst; acá sólo se le
 * pasa la tinta. Que las dos reacciones salgan del MISMO primitivo es lo que
 * hace que se sientan de la misma familia — y es también lo que va a hacer que
 * un emoji de la comunidad se sienta parte de ella sin escribir nada nuevo.
 */
export function ActionToggle({
  tone,
  active,
  onToggle,
  label,
  className,
  children,
}: {
  tone: ActionTone;
  active: boolean;
  onToggle: (next: boolean) => void;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <LikeBurst
      active={active}
      onToggle={onToggle}
      label={label}
      particleColor={actionParticleColor(tone)}
      className={actionClass(tone, active, className)}
      // El envoltorio interno de LikeBurst es `inline-flex` y los children son
      // hijos SUYOS, no del botón: sin esto el `flex-col` del botón no los
      // alcanza y la palabra queda al costado del ícono partida en dos
      // renglones, mientras las acciones sin burst (comentar, compartir) sí
      // apilan. Las cuatro tienen que verse iguales.
      contentClassName="flex-col items-center gap-1"
    >
      {children}
    </LikeBurst>
  );
}
