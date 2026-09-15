"use client";

import { m, useReducedMotion } from "motion/react";
import { useHydrated, useViewerTimeZone } from "@/components/time/viewer-time-zone";
import { firstNameOf } from "@/components/listings/helpers";
import { COPY } from "./copy";

export interface ComposerGreetingProps {
  /** Nombre de la PERSONA (no la cara activa: ver el docblock del feed). */
  viewerName: string;
}

/**
 * `hourCycle: "h23"` da 00–23; algunos motores igual devuelven "24" para la
 * medianoche (mismo caso ya resuelto en `lib/horarios/apertura.ts`), de ahí
 * el `% 24`. Exportada para el test: es la parte que evita el bug de fondo
 * (calcular la hora en el servidor, en UTC, en vez de en la del usuario).
 */
export function hourInZone(date: Date, timeZone: string): number | null {
  try {
    const part = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .find((p) => p.type === "hour")?.value;
    const hour = part === undefined ? NaN : Number(part);
    return Number.isInteger(hour) ? hour % 24 : null;
  } catch {
    return null;
  }
}

/**
 * Saludo de bienvenida arriba del feed. La hora es la de la ZONA DE QUIEN
 * MIRA (`useViewerTimeZone`: perfil elegido > navegador > default), nunca la
 * del servidor — Vercel corre en UTC y calcularla ahí le diría "buenas
 * noches" a alguien a las 3 de la tarde en Los Ángeles. Por eso este
 * componente es de cliente y no se resuelve nada antes de `useHydrated()`:
 * el servidor no puede saber en qué huso está el teléfono de nadie.
 */
export function ComposerGreeting({ viewerName }: ComposerGreetingProps) {
  const hydrated = useHydrated();
  const zone = useViewerTimeZone();
  const reduceMotion = useReducedMotion();

  if (!hydrated) return null;

  const hour = hourInZone(new Date(), zone);
  if (hour === null) return null;

  return (
    <m.p
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: "easeOut" }}
      className="px-1 font-display text-base font-semibold text-foreground"
    >
      {COPY.composer.greetingByHour(hour, firstNameOf(viewerName))}
    </m.p>
  );
}
