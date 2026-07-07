"use client";

import { useCallback, useState } from "react";

/**
 * Controla una celebración one-shot (destello + check). Devuelve `celebrating` y `celebrate()`.
 * Emparejalo con <Celebration active={celebrating} onDone={reset} /> o dejalo que se auto-apague.
 *
 * @example
 * const { celebrating, celebrate } = useCelebration();
 * await publicarAviso(); celebrate();
 * return <Celebration active={celebrating} />;
 */
export function useCelebration(): {
  celebrating: boolean;
  celebrate: () => void;
  reset: () => void;
} {
  const [celebrating, setCelebrating] = useState(false);
  const celebrate = useCallback(() => {
    setCelebrating(false);
    requestAnimationFrame(() => setCelebrating(true));
  }, []);
  const reset = useCallback(() => setCelebrating(false), []);
  return { celebrating, celebrate, reset };
}
