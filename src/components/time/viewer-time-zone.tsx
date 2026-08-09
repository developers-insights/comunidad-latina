"use client";

import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { DEFAULT_TIME_ZONE, formatDate, type FormatDateOptions } from "@/lib/utils";
import { browserTimeZone } from "@/lib/time/timezone";

/**
 * La zona horaria de quien mira, del lado del cliente.
 *
 * ── POR QUÉ NO SE RESUELVE EN EL PRIMER RENDER ───────────────────────────────
 * El servidor no puede saber en qué huso está el teléfono de nadie. Si el
 * primer render del cliente usara `Intl.DateTimeFormat().resolvedOptions()`, el
 * HTML del servidor diría "1 ago" y React re-renderizaría "31 jul": mismatch de
 * hidratación (#418) y, peor, una fecha que parpadea.
 *
 * ── POR QUÉ `useSyncExternalStore` Y NO UN `useEffect` ───────────────────────
 * La forma obvia sería `useState(null)` + un efecto que llame a `setState` con
 * la zona del navegador. Funciona, pero es exactamente el antipatrón que marca
 * `react-hooks/set-state-in-effect`: un render extra disparado a mano para
 * enterarse de algo que el entorno ya sabía.
 *
 * `useSyncExternalStore` es el mecanismo que React tiene para justamente esto —
 * un valor que existe en el cliente y no en el servidor. Devuelve
 * `getServerSnapshot()` durante el HTML y la hidratación (así que no hay
 * mismatch) y `getSnapshot()` de ahí en más. Sin efectos y sin setState.
 *
 * El `subscribe` es un no-op porque la zona del navegador no cambia sola
 * mientras la página está abierta: no hay evento al que suscribirse, y fabricar
 * uno con un `setInterval` sería costo por nada.
 *
 * ── PRECEDENCIA ─────────────────────────────────────────────────────────────
 *   1. `profiles.timezone` — lo que la persona eligió. Manda siempre, incluso
 *      si el navegador dice otra cosa: alguien de viaje quiere seguir viendo
 *      las fechas de su casa, que es justamente por qué el ajuste existe.
 *   2. La zona del navegador (post-hidratación).
 *   3. `DEFAULT_TIME_ZONE`.
 */

interface ViewerTimeZoneValue {
  /** La zona a usar HOY para formatear. Nunca es null. */
  zone: string;
  /** Lo que la persona eligió explícitamente, o null si nunca eligió. */
  preferred: string | null;
}

const ViewerTimeZoneContext = createContext<ViewerTimeZoneValue>({
  zone: DEFAULT_TIME_ZONE,
  preferred: null,
});

/** La zona del navegador nunca cambia sola: no hay a qué suscribirse. */
const subscribeNever = () => () => {};

/**
 * La zona del navegador, o `null` durante el HTML y la hidratación.
 *
 * `browserTimeZone()` devuelve siempre el mismo string, así que el snapshot es
 * estable y React no entra en el bucle de "getSnapshot devolvió algo distinto".
 */
export function useBrowserTimeZone(): string | null {
  return useSyncExternalStore(
    subscribeNever,
    browserTimeZone,
    () => null,
  );
}

/**
 * `true` recién después de hidratar. Sirve para lo que sólo el navegador sabe
 * —la hora que es, por ejemplo— sin romper la hidratación ni usar un efecto.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

export function ViewerTimeZoneProvider({
  preferred,
  children,
}: {
  /** `profiles.timezone` resuelto en el servidor (`getViewerTimeZone()`). */
  preferred: string | null;
  children: ReactNode;
}) {
  const detected = useBrowserTimeZone();
  const zone = preferred ?? detected ?? DEFAULT_TIME_ZONE;

  return (
    <ViewerTimeZoneContext.Provider value={{ zone, preferred }}>
      {children}
    </ViewerTimeZoneContext.Provider>
  );
}

/**
 * La zona con la que formatear en un client component.
 *
 * Sin provider arriba devuelve la zona de la comunidad, que es el mismo valor
 * que venía usando el repo antes de que la zona por usuario existiera: montar
 * un componente fuera del provider degrada al comportamiento anterior, nunca a
 * una fecha vacía.
 */
export function useViewerTimeZone(): string {
  return useContext(ViewerTimeZoneContext).zone;
}

/** ¿La persona eligió su zona, o estamos adivinando? Lo usa el aviso de Ajustes. */
export function useHasChosenTimeZone(): boolean {
  return useContext(ViewerTimeZoneContext).preferred !== null;
}

/**
 * Fecha ya formateada en la zona de quien mira. Es `formatDate` con la zona
 * puesta — existe para que en las pantallas no haya que acordarse de pasarla.
 */
export function useFormatDate(): (
  date: Date | string | number,
  options?: Omit<FormatDateOptions, "timeZone">,
) => string {
  const zone = useViewerTimeZone();
  return (date, options = {}) => formatDate(date, { ...options, timeZone: zone });
}
