"use client";

import { useEffect, useRef, useState } from "react";
import {
  checkUsernameAvailabilityAction,
  type UsernameAvailability,
} from "@/app/(auth)/username-actions";
import { normalizeUsername, usernameProblem, type UsernameProblem } from "@/lib/profile/username";

export type UsernameLiveStatus = "idle" | "checking" | "available" | "invalid" | "taken" | "unknown";

export interface UsernameLiveState {
  status: UsernameLiveStatus;
  message: string | null;
}

/** Desde la última tecla, no desde que se abrió el campo. */
export const USERNAME_CHECK_DEBOUNCE_MS = 350;

/** Mismo texto que `registerAction` para cada problema (ver username-actions.ts). */
const PROBLEM_COPY: Record<UsernameProblem, string> = {
  vacio: "Elegí tu nombre de usuario.",
  corto: "Necesita al menos 3 caracteres.",
  largo: "El máximo son 30 caracteres.",
  formato: "Solo letras sin acento, números, punto y guion bajo.",
  bordes: "No puede empezar ni terminar con punto o guion bajo.",
};

const IDLE: UsernameLiveState = { status: "idle", message: null };

/** Lo que devolvió el último chequeo RESUELTO, con el handle al que corresponde. */
interface Settled {
  key: string;
  result: UsernameAvailability;
}

/**
 * Disponibilidad del handle mientras se escribe.
 *
 * El formato se resuelve LOCAL (usernameProblem) y nunca toca el server: es la
 * misma regla que ya corre en el insert, así que no hace falta una vuelta de
 * red para saber que "rosa martinez" tiene un espacio.
 *
 * POR QUÉ EL ESTADO SE DERIVA Y NO SE GUARDA (mismo criterio que
 * useGlobalSearch): lo único que vive en `useState` es la respuesta del último
 * chequeo RESUELTO, con el handle al que corresponde. `status` sale de comparar
 * esa clave contra `rawValue` en cada render — nunca de un `setState` síncrono
 * dentro del efecto (eso dispara un render en cascada por cada tecla, que es
 * justo lo que marca `react-hooks/set-state-in-effect`).
 *
 * La respuesta del server puede llegar DESPUÉS de que la persona ya escribió
 * otra cosa — acá no hay un `fetch` que abortar (es una server action), así
 * que la respuesta vieja se descarta con un guard por `requestId`: si cambió
 * el valor mientras la petición estaba en vuelo, se ignora.
 */
export function useUsernameAvailability(rawValue: string): UsernameLiveState {
  const problem = usernameProblem(rawValue);
  const normalized = normalizeUsername(rawValue);
  const checkable = problem === null && normalized !== null;

  const [settled, setSettled] = useState<Settled | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!checkable) {
      requestIdRef.current += 1; // invalida cualquier chequeo en vuelo
      return;
    }

    const key = normalized as string;
    const requestId = ++requestIdRef.current;

    const timer = setTimeout(async () => {
      try {
        const result = await checkUsernameAvailabilityAction(rawValue);
        if (requestIdRef.current !== requestId) return; // llegó tarde: se descarta
        setSettled({ key, result });
      } catch {
        if (requestIdRef.current !== requestId) return;
        setSettled({ key, result: { status: "unknown" } });
      }
    }, USERNAME_CHECK_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [rawValue, checkable, normalized]);

  if (problem) return { status: "invalid", message: PROBLEM_COPY[problem] };
  if (!checkable) return IDLE;

  const fresh = settled && settled.key === normalized ? settled.result : null;
  if (!fresh) return { status: "checking", message: null };
  if (fresh.status === "available") return { status: "available", message: null };
  if (fresh.status === "taken") return { status: "taken", message: fresh.message };
  if (fresh.status === "invalid") return { status: "invalid", message: fresh.message };
  return { status: "unknown", message: null };
}
