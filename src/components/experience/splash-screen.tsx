"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

/**
 * SPLASH DE ENTRADA PREMIUM (§ polish premium — módulo SPLASH + TRANSICIONES).
 *
 * Overlay `fixed` que se muestra UNA sola vez por sesión (flag en
 * sessionStorage) sobre el contenido ya hidratado. NO es un gate de render:
 * el contenido real vive detrás y su LCP no depende de este componente —
 * el splash simplemente se desvanece encima.
 *
 * - Monograma de marca (inicial del tenant) que hace fade+scale con
 *   --ease-spring, un halo de marca que respira y el nombre revelándose.
 * - Auto-dismiss ~1.1s; skippable con tap, click o cualquier tecla.
 * - prefers-reduced-motion: no aparece (retorno instantáneo, cero motion).
 * - aria-hidden + role presentacional: invisible para lectores de pantalla,
 *   no atrapa foco (nada focuseable dentro, pointer-events se liberan al irse).
 *
 * Tema: el overlay es `bg-canvas`, así que en dark arranca oscuro y NUNCA hay
 * flash blanco al abrir la app. El acento sale de `var(--color-brand)` —el tono
 * de marca del TEMA ACTIVO, ya validado por el brand pipeline— y no del hex
 * crudo: en dark el monograma iba a quedar sobre el fill claro con un
 * `text-brand-foreground` calculado para el fill oscuro. `brandHex` queda como
 * fallback del var(), que es lo único que puede fallar acá.
 *
 * Recibe brandHex + name por props desde el layout: NO fetchea nada.
 */

const SESSION_FLAG = "cl-splashed";
const VISIBLE_MS = 1100;

/** Inicial visible del tenant para el monograma (mayúscula, a prueba de vacío). */
function monogram(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "•";
  // Primer code point real (soporta acentos/emoji sin romper).
  return [...trimmed][0]!.toUpperCase();
}

export function SplashScreen({
  brandHex,
  name,
}: {
  brandHex: string;
  name: string;
}) {
  const reduceMotion = useReducedMotion();

  // Estado inicial resuelto sincrónicamente en el cliente: si ya hubo splash
  // en esta sesión (o reduce-motion), arrancamos ya cerrado → jamás parpadea.
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    setVisible(false);
  }, []);

  useEffect(() => {
    // Sólo primera carga de la sesión y sólo si el usuario tolera motion.
    if (reduceMotion) {
      try {
        sessionStorage.setItem(SESSION_FLAG, "1");
      } catch {
        /* sessionStorage puede fallar en modo restringido — ignorar */
      }
      return;
    }

    let already = false;
    try {
      already = sessionStorage.getItem(SESSION_FLAG) === "1";
      sessionStorage.setItem(SESSION_FLAG, "1");
    } catch {
      // Sin sessionStorage tratamos como "ya visto": no arriesgamos molestar
      // en cada navegación dura de un entorno que no persiste la sesión.
      already = true;
    }

    if (already) return;

    // Diferimos el setState al próximo frame: evita el render en cascada dentro
    // del efecto (regla react-hooks/set-state-in-effect) sin cambiar la UX —
    // el splash sigue apareciendo apenas monta, ya sobre el contenido hidratado.
    const raf = requestAnimationFrame(() => {
      setVisible(true);
      timerRef.current = window.setTimeout(dismiss, VISIBLE_MS);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [reduceMotion, dismiss]);

  // Skip con teclado mientras está visible (sin atrapar foco: escucha global).
  useEffect(() => {
    if (!visible) return;
    const onKey = () => dismiss();
    window.addEventListener("keydown", onKey, { once: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, dismiss]);

  const initial = monogram(name);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          aria-hidden="true"
          // Presentacional puro: no participa del árbol de accesibilidad ni
          // recibe foco. pointer-events se cortan al empezar a salir.
          onPointerDown={dismiss}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-canvas"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          initial={{ opacity: 1 }}
          // Al empezar a salir liberamos el puntero: el tap que lo descartó (o
          // el siguiente) llega al contenido de abajo sin esperar el fade.
          exit={{
            opacity: 0,
            pointerEvents: "none",
            transition: { duration: 0.4, ease: [0.32, 0.72, 0, 1] },
          }}
        >
          {/* Monograma con halo de marca que respira */}
          <div className="relative flex items-center justify-center">
            <motion.span
              aria-hidden="true"
              className="absolute rounded-full"
              style={{
                width: 132,
                height: 132,
                // color-mix reemplaza al viejo `${brandHex}33` (alpha 0x33 = 20%):
                // el hex crudo no se puede componer con una custom property.
                background: `radial-gradient(circle, color-mix(in oklab, var(--color-brand, ${brandHex}) 20%, transparent) 0%, transparent 70%)`,
              }}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: [0, 1, 0.7], scale: [0.6, 1.15, 1] }}
              transition={{ duration: 1, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.div
              className="relative flex items-center justify-center rounded-[28px] shadow-lg"
              style={{
                width: 84,
                height: 84,
                background: `var(--color-brand, ${brandHex})`,
              }}
              initial={{ opacity: 0, scale: 0.7, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.55, ease: [0.34, 1.56, 0.64, 1] }}
            >
              <span
                className="font-display font-bold leading-none text-brand-foreground"
                style={{ fontSize: 40 }}
              >
                {initial}
              </span>
              {/* Shimmer de marca que barre el escudo una vez.
                  El blanco NO es un color de UI: es un reflejo especular sobre el
                  fill de marca (misma familia que el gloss del <BrandMark />). Una
                  luz no se oscurece porque el usuario prendió el tema dark, así que
                  es constante a propósito y no le corresponde token semántico. */}
              <motion.span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]"
              >
                <motion.span
                  className="absolute inset-y-0 w-1/2 -skew-x-12"
                  style={{
                    background:
                      "linear-gradient(100deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%)",
                  }}
                  initial={{ x: "-160%" }}
                  animate={{ x: "260%" }}
                  transition={{ duration: 0.9, delay: 0.25, ease: [0.32, 0.72, 0, 1] }}
                />
              </motion.span>
            </motion.div>
          </div>

          {/* Nombre del tenant revelándose */}
          <motion.p
            className="font-display text-lg font-semibold tracking-tight text-foreground"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.18, ease: [0.32, 0.72, 0, 1] }}
          >
            {name}
          </motion.p>

          {/* Barra de progreso fina que se llena mientras dura el splash */}
          <motion.span
            aria-hidden="true"
            className="absolute bottom-16 h-[3px] overflow-hidden rounded-full bg-border-subtle"
            style={{ width: 96 }}
          >
            <motion.span
              className="block h-full rounded-full"
              style={{ background: `var(--color-brand, ${brandHex})` }}
              initial={{ width: "0%" }}
              animate={{ width: "100%" }}
              transition={{ duration: VISIBLE_MS / 1000, ease: "linear" }}
            />
          </motion.span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
