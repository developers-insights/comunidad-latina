"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui";
import { useConsent } from "@/lib/consent";
import { useFocusTrap, useMounted } from "@/lib/design/use-overlay";
import { ConsentPreferences } from "./consent-preferences";
import { CONSENT_COPY as COPY } from "./consent-copy";

/**
 * Banner de consentimiento.
 *
 * NO SE MUESTRA HOY, Y ESO ES EL COMPORTAMIENTO CORRECTO
 * -----------------------------------------------------
 * `mustDecide` sale de `categoriesNeedingConsent()`, que recorre el registro de
 * trazadores y devuelve las categorías de opt-in CON ALGO VIVO adentro. Hoy la
 * app no tiene un solo trazador de analítica ni de publicidad —verificado en
 * vivo: ninguna petición de la carga sale del propio origen— así que la lista
 * es vacía y este componente devuelve `null`.
 *
 * Un banner con categorías vacías sería una mentira educada: le pide permiso a
 * la persona para algo que no ocurre, la entrena a aceptar sin leer, y arruina
 * el valor del consentimiento el día que sí haga falta. En cambio, el día que
 * alguien agregue una fila de analítica al registro, este banner aparece solo,
 * sin que nadie tenga que acordarse de encenderlo.
 *
 * SIN SALTO DE LAYOUT
 * -------------------
 * Va en un portal a <body> y es `fixed`, así que no empuja ni un píxel del
 * contenido: el CLS que aporta es 0. Y se levanta por encima de la barra
 * inferior de la PWA midiéndola en vivo, para no taparle las pestañas a nadie.
 */
export function ConsentBanner() {
  const mounted = useMounted();
  const reduceMotion = useReducedMotion();
  const { mustDecide, acceptAll, rejectAll } = useConsent();
  const [showPreferences, setShowPreferences] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const bottomOffset = useBottomNavOffset(mustDecide);

  const open = mustDecide && !showPreferences;

  // Escape = RECHAZAR, nunca aceptar. Cerrar un aviso jamás puede interpretarse
  // como un "sí": el silencio no es consentimiento, y esa es exactamente la
  // práctica que sancionan las autoridades europeas.
  useFocusTrap(panelRef, open, rejectAll);

  if (!mounted) return null;

  return (
    <>
      {createPortal(
        <AnimatePresence>
          {open && (
            <m.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label={COPY.banner.ariaLabel}
              tabIndex={-1}
              className="fixed inset-x-0 z-50 mx-auto w-full max-w-lg px-3"
              style={{ bottom: `calc(${bottomOffset}px + env(safe-area-inset-bottom))` }}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={{
                opacity: 0,
                ...(reduceMotion ? {} : { y: 16 }),
                transition: { duration: 0.2, ease: [0.4, 0, 1, 1] },
              }}
              transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
            >
              {/* Doble bisel: cáscara con hairline + núcleo con luz interior,
                  el mismo lenguaje de `BezelCard` que usa toda la app. Se
                  escribe a mano y no con BezelCard porque acá el núcleo lleva
                  blur y opacidad propios (flota sobre contenido, no sobre
                  lienzo). */}
              <div className="rounded-2xl border border-border-subtle bg-surface-subtle/80 p-1.5 shadow-xl backdrop-blur-md">
                <div className="rounded-[calc(1rem-0.375rem)] bg-surface p-4 shadow-[inset_0_1px_0_var(--cl-bezel-highlight)]">
                  <h2 className="font-display text-base font-bold text-foreground">
                    {COPY.banner.title}
                  </h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-foreground-secondary">
                    {COPY.banner.body}
                  </p>

                  {/* Aceptar y rechazar: mismo tamaño, mismo peso, mismo lugar,
                      un solo toque cada uno. `grid-cols-2` lo hace estructural
                      —no se puede desbalancear por accidente— y `sm:flex-none`
                      no existe a propósito: nunca uno más ancho que el otro. */}
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button variant="outline" onClick={rejectAll} className="w-full">
                      {COPY.banner.rejectAll}
                    </Button>
                    <Button variant="primary" onClick={acceptAll} className="w-full">
                      {COPY.banner.acceptAll}
                    </Button>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <button
                      type="button"
                      onClick={() => setShowPreferences(true)}
                      className="inline-flex min-h-11 items-center text-sm font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
                    >
                      {COPY.banner.customize}
                    </button>
                    <Link
                      href="/legal/cookies"
                      className="inline-flex min-h-11 items-center text-sm text-foreground-muted underline decoration-border underline-offset-2 hover:text-foreground-secondary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
                    >
                      {COPY.banner.readPolicy}
                    </Link>
                  </div>
                </div>
              </div>
            </m.div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      <ConsentPreferences
        open={showPreferences}
        onClose={() => setShowPreferences(false)}
      />
    </>
  );
}

/**
 * Alto de la barra inferior de la PWA, medido en vivo.
 *
 * Se mide en lugar de hardcodear un número porque la barra sólo existe en las
 * rutas de `(app)` —en las páginas públicas no está— y su alto cambia con el
 * safe-area del dispositivo. Un `bottom-20` fijo taparía las pestañas en el
 * teléfono e iría flotando en el aire en la web.
 *
 * La detección es semántica (un `<nav>` en `position: fixed` pegado al borde
 * inferior) y no por clase de Tailwind: renombrar una clase no debe romper
 * esto.
 */
function useBottomNavOffset(enabled: boolean): number {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    const measure = () => {
      let found = 0;
      for (const nav of document.querySelectorAll("nav")) {
        const style = window.getComputedStyle(nav);
        if (style.position !== "fixed") continue;
        const rect = nav.getBoundingClientRect();
        // Pegado al borde inferior (2px de tolerancia por redondeos).
        if (Math.abs(rect.bottom - window.innerHeight) > 2) continue;
        found = Math.max(found, rect.height);
      }
      setOffset(found);
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [enabled]);

  return offset;
}
