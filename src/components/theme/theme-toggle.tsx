"use client";

import { useId, useRef } from "react";
import { flushSync } from "react-dom";
import { Monitor } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { useTheme } from "./use-theme";

const COPY = {
  /**
   * El NOMBRE accesible es la ACCIÓN, no el estado. Antes de montar no sabemos
   * el tema, así que el nombre no puede prometer un destino: "Cambiar el tema"
   * es verdad en los tres casos.
   */
  toggleUnknown: "Cambiar el tema",
  toDark: "Cambiar a tema oscuro",
  toLight: "Cambiar a tema claro",
  /**
   * La DESCRIPCIÓN dice en qué tema estás y —lo que `aria-pressed` no podía
   * decir— quién lo eligió. Es lo único que hace audible el tercer estado.
   */
  stateSystemDark: "Ahora seguís el tema oscuro del sistema.",
  stateSystemLight: "Ahora seguís el tema claro del sistema.",
  stateDark: "Elegiste el tema oscuro.",
  stateLight: "Elegiste el tema claro.",
  system: "Seguir al sistema",
} as const;

/** Los dos botones son gemelos: 44×44 (§3.2) y el mismo tratamiento de foco. */
const BUTTON_CLASS = cn(
  "flex size-11 shrink-0 items-center justify-center rounded-full",
  "text-foreground-secondary transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
  "hover:bg-surface-hover hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
);

/* ── Geometría del sol (8 rayos a 45°, radio 8.2 → 10.6, centro 12,12) ── */
const RAYS: ReadonlyArray<readonly [number, number, number, number]> = [
  [20.2, 12, 22.6, 12],
  [17.8, 17.8, 19.5, 19.5],
  [12, 20.2, 12, 22.6],
  [6.2, 17.8, 4.5, 19.5],
  [3.8, 12, 1.4, 12],
  [6.2, 6.2, 4.5, 4.5],
  [12, 3.8, 12, 1.4],
  [17.8, 6.2, 19.5, 4.5],
];

/**
 * Control de tema. Sol↔luna con un tap; "Seguir al sistema" al lado, sólo cuando
 * hay algo que devolver.
 *
 * ── Por qué NO es un toggle button ─────────────────────────────────────────
 * `aria-pressed` describe el estado binario PROPIO del control. La preferencia
 * de tema es ternaria (`light | dark | system`), así que `aria-pressed={isDark}`
 * mentía: con `system` y el SO en oscuro, el lector cantaba "Tema oscuro,
 * activado" sobre una elección que el usuario nunca hizo. `aria-pressed="mixed"`
 * tampoco sirve: la spec lo define como "parcialmente presionado" y `system` no
 * es medio oscuro — sería la misma mentira con otro acento.
 *
 * Un botón sin estado binario propio es un botón a secas. Entonces:
 *   · NOMBRE      = la acción ("Cambiar a tema claro"). Cambia al activarlo, y
 *                   los lectores anuncian el nombre nuevo del control enfocado:
 *                   es el reemplazo canónico de `aria-pressed`, sin live region
 *                   (una live region acá anunciaría de más en cada carga).
 *   · DESCRIPCIÓN = de dónde viene el tema ("Ahora seguís el tema oscuro del
 *                   sistema." / "Elegiste el tema oscuro."). `aria-describedby`
 *                   sobre un <span class="sr-only">, no `title`: el title no
 *                   existe en touch y lo pisa cualquier descripción real.
 * Nada se afirma antes de montar: en el HTML del server no hay ni estado ni
 * promesa de destino (`resolvedTheme === null` ⇒ nombre neutro, sin descripción).
 *
 * ── Cómo se vuelve a `system` ──────────────────────────────────────────────
 * Un segundo botón real, montado sólo mientras hay una preferencia explícita.
 * Descartadas, con motivo:
 *   · Ciclo de 3 estados: uno de cada tres taps no cambia NADA en pantalla
 *     (volver a `system` cuando el SO ya está en el tema que elegiste), y el
 *     ícono no puede mostrar el tercer estado en el primer paint — ver abajo.
 *   · Long-press: invisible, sin equivalente de teclado y fuera del alcance de
 *     un lector de pantalla. Tapar una mentira de accesibilidad con un gesto
 *     inaccesible es peor que la mentira.
 *   · Menú al tocar: rompe el tap único para lo común, que es alternar.
 * El botón va a la IZQUIERDA del sol/luna a propósito: el sol/luna no se mueve
 * cuando aparece, así que el dedo que acaba de tocarlo puede volver a tocarlo.
 * Y su ausencia no es un vacío: es la señal visible de que ya seguís al sistema.
 *
 * ── El traspaso de foco (2.4.3), que no es opcional ────────────────────────
 * Ese botón se DESMONTA con el click que lo activa: al volver a `system` deja de
 * haber preferencia que soltar. Un control que desaparece bajo el foco lo manda
 * al <body>, y el siguiente Tab reinicia desde el principio de la página. Por eso
 * `backToSystem()` le devuelve el foco al sol/luna —el vecino que nunca se
 * desmonta ni se mueve— dentro del mismo handler.
 *
 * Y por eso el cambio de estado se commitea ANTES de mover el foco (`flushSync`):
 * el lector lee nombre + rol + descripción en el evento `focus`, y la descripción
 * es lo único que anuncia la entrada al tercer estado. Si React commiteara
 * después, el foco aterrizaría sobre la descripción vieja ("Elegiste el tema
 * claro.") y el usuario nunca se enteraría de que ahora sigue al sistema — que es
 * el caso MÁS común: SO claro + preferencia `light`, donde ni el tema ni el
 * nombre del control cambian y el único testigo es esa descripción.
 *
 * Con el anuncio viajando en el cambio de foco, 4.1.3 (Status Messages) queda
 * fuera de alcance por definición: el SC cubre justamente los cambios de estado
 * que NO reciben el foco. Nada de `role="status"`, que además duplicaría el
 * anuncio y —si el nodo se monta al hidratar— hablaría en cada carga.
 *
 * ── El morph, sin React ────────────────────────────────────────────────────
 * Todo el morph se deriva de `--cl-theme-dark` (0 = sol, 1 = luna), la variable
 * que globals.css voltea junto con la paleta y que el script pre-paint deja en
 * su valor correcto antes del primer paint. Por eso el ícono nunca "salta" al
 * hidratar, ni siquiera sin JS.
 *
 * COMPROMISO ACEPTADO: el ícono muestra el tema que VES, nunca de dónde salió.
 * No hay forma de que muestre `system` en el primer paint: el script pre-paint
 * estampa `.light`/`.dark` en <html> y nada más, así que ningún selector CSS
 * puede distinguir "system" de "explícito" antes de hidratar. Está bien que sea
 * así: el ícono contesta "¿qué pasa si toco?", y eso depende sólo del tema
 * resuelto. El origen del tema lo cuentan el botón de al lado y la descripción.
 *
 * El morph: los rayos se retraen (escalan a 0.55 y rotan -75°) mientras el disco
 * crece 22% y una máscara circular entra desde arriba-derecha y le muerde el
 * borde hasta dejar una luna creciente. Todo con `calc()` sobre esa única
 * variable, interpolada por `@property` (globals.css).
 *
 * `prefers-reduced-motion` ya está cubierto globalmente (globals.css fuerza
 * `transition-duration: 0.01ms !important`): el ícono cambia sin animar.
 *
 * No usa @phosphor-icons para el sol/luna a propósito: Sun y Moon son dos paths
 * distintos, no morphean; cross-fadearlos se ve barato. El monitor sí, que no
 * morphea nada y así habla el mismo idioma que el resto de los íconos.
 *
 * `className` va al contenedor: los call sites sólo le pasan posicionamiento.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, resolvedTheme, setTheme, toggle } = useTheme();
  const rawId = useId();
  // useId mete caracteres que no son válidos en un id de SVG referenciado por url().
  const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const maskId = `cl-moon-${safeId}`;
  const stateId = `cl-theme-state-${safeId}`;

  /** El sol/luna nunca se desmonta: es el destino del foco cuando el otro se va. */
  const toggleRef = useRef<HTMLButtonElement>(null);

  // `null` = todavía no montó: el server no puede saber el tema del usuario.
  const mounted = resolvedTheme !== null;
  const isDark = resolvedTheme === "dark";
  const followsSystem = theme === "system";

  const action = !mounted ? COPY.toggleUnknown : isDark ? COPY.toLight : COPY.toDark;

  let stateText: string | null = null;
  if (mounted) {
    if (followsSystem) stateText = isDark ? COPY.stateSystemDark : COPY.stateSystemLight;
    else stateText = isDark ? COPY.stateDark : COPY.stateLight;
  }

  /**
   * Soltar la preferencia explícita. El botón que dispara esto se desmonta acá
   * mismo, así que el orden es sagrado: commitear primero, enfocar después.
   *
   *  1. `flushSync` fuerza el commit: cuando corra la línea 2, el sol/luna ya
   *     tiene su descripción nueva ("Ahora seguís el tema … del sistema.").
   *     Sin esto React commitea al final del evento, el `focus` dispara antes y
   *     el lector canta la descripción vieja.
   *  2. El foco vuelve al sol/luna. Incondicional a propósito: si el navegador
   *     no enfocó el botón al clickearlo (Safari no lo hace), el foco estaba en
   *     el <body> y moverlo al vecino sólo mejora el orden de tabulación. Y como
   *     el último gesto fue de puntero, `:focus-visible` no matchea: el usuario
   *     de mouse no ve aparecer ningún anillo.
   */
  function backToSystem(): void {
    flushSync(() => setTheme("system"));
    toggleRef.current?.focus();
  }

  return (
    <div className={cn("flex shrink-0 items-center", className)}>
      {/* Sólo mientras haya una preferencia explícita que soltar. Antes de montar
          no se renderiza: el server no sabe si hay algo que devolver. */}
      {mounted && !followsSystem ? (
        <button
          type="button"
          onClick={backToSystem}
          aria-label={COPY.system}
          /* Acá `mounted` es true, así que `stateText` existe y la descripción
             accesible es "Elegiste el tema …" — la preferencia que este botón
             suelta. No es cosmético: sin `aria-describedby`, un `title` igual al
             `aria-label` PASA A SER la descripción (accname §4.3.2) y NVDA/JAWS
             leen "Seguir al sistema, botón, Seguir al sistema". */
          aria-describedby={stateId}
          title={COPY.system}
          className={BUTTON_CLASS}
        >
          <Monitor size={20} aria-hidden="true" />
        </button>
      ) : null}

      <button
        ref={toggleRef}
        type="button"
        onClick={toggle}
        aria-label={action}
        // `title` idéntico al nombre: si difirieran, el lector diría una cosa y
        // el tooltip mostraría otra. La descripción real va por `aria-describedby`,
        // que además le gana al title cuando los dos están presentes — y por eso
        // el title sólo se monta cuando hay `aria-describedby` que lo suprima. En
        // el HTML del server no hay descripción todavía: ahí el title se repetiría
        // como descripción, y un tooltip sobre un botón sin JS no le sirve a nadie.
        title={stateText === null ? undefined : action}
        aria-describedby={stateText === null ? undefined : stateId}
        className={BUTTON_CLASS}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          focusable="false"
          // La transición vive sobre la variable: los hijos heredan el valor ya
          // interpolado y sus calc() se recalculan solos, frame a frame.
          style={{ transition: "--cl-theme-dark var(--duration-base) var(--ease-spring)" }}
        >
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
            {/* blanco = se ve, negro = se recorta (luminancia, no theming) */}
            <rect x="0" y="0" width="24" height="24" fill="white" />
            <circle
              cx="25.5"
              cy="3"
              r="8.5"
              fill="black"
              style={{
                transform:
                  "translate(calc(var(--cl-theme-dark) * -8.7px), calc(var(--cl-theme-dark) * 4.2px))",
              }}
            />
          </mask>

          <circle
            cx="12"
            cy="12"
            r="5"
            fill="currentColor"
            mask={`url(#${maskId})`}
            style={{
              transformOrigin: "12px 12px",
              transform: "scale(calc(1 + 0.22 * var(--cl-theme-dark)))",
            }}
          />

          <g
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            style={{
              transformOrigin: "12px 12px",
              transform:
                "rotate(calc(var(--cl-theme-dark) * -75deg)) scale(calc(1 - 0.45 * var(--cl-theme-dark)))",
              opacity: "calc(1 - var(--cl-theme-dark))",
            }}
          >
            {RAYS.map(([x1, y1, x2, y2]) => (
              <line key={`${x1}-${y1}`} x1={x1} y1={y1} x2={x2} y2={y2} />
            ))}
          </g>
        </svg>
      </button>

      {stateText === null ? null : (
        <span id={stateId} className="sr-only">
          {stateText}
        </span>
      )}
    </div>
  );
}
