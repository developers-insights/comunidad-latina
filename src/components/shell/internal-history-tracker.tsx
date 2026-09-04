"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { installHistoryStamping, markInternalNavigation } from "./internal-history";

/**
 * Sella cada entrada del historial con su profundidad dentro de la app, para
 * que "Volver" (`SectionTopBar`) sepa si detrás hay una pantalla nuestra o el
 * vacío (link externo, PWA recién abierta, recarga).
 *
 * DOS mecanismos, y los dos hacen falta:
 *
 *  1. El sello por cambio de `pathname` (efecto + `setTimeout(0)`). Cubre la
 *     carga inicial (profundidad 0) y las navegaciones que Next ya tiene en
 *     caché, donde el `pushState` ocurre antes del efecto.
 *
 *  2. El sello en el `pushState` mismo (`installHistoryStamping`). Es el que
 *     faltaba: en la PRIMERA visita a una sección, Next hace el `pushState`
 *     recién cuando terminó de traer los datos del servidor — bastante después
 *     del efecto y del `setTimeout(0)` — y la entrada nueva nacía sin sello.
 *     Se vio en vivo el 2026-09-04: feed → Empleos (primera vez) → "Volver"
 *     mandaba a `/buscar` (el fallback) en vez de al feed; la segunda vez,
 *     con la ruta cacheada, andaba. Envolviendo `window.history.pushState`
 *     (Next lo llama por el global, no por una referencia guardada) el sello
 *     se escribe en el instante exacto en que existe la entrada.
 *
 * Vive en `(app)/layout.tsx`, no en la barra: el feed no tiene barra y es de
 * donde viene casi todo el mundo; si solo se sellara donde hay barra, salir de
 * Empleos mandaría a `/buscar` en vez de al feed.
 */
export function InternalHistoryTracker() {
  const pathname = usePathname();

  useEffect(() => installHistoryStamping(), []);

  useEffect(() => {
    markInternalNavigation();
    // Los efectos corren de abajo hacia arriba: cuando corre este, el
    // `pushState` de Next (en el router, más arriba) puede no haber pasado
    // todavía. El segundo sello, un tick después, lo cubre en el caso cacheado.
    const id = window.setTimeout(markInternalNavigation, 0);
    return () => window.clearTimeout(id);
  }, [pathname]);

  return null;
}
