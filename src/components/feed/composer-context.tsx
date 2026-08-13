"use client";

import { createContext, useContext } from "react";

/**
 * Puente entre CUALQUIER disparador de "publicar" (la tarjeta del feed, el
 * "+" del bottom nav) y el `PostComposerHost` que de verdad tiene el estado
 * y los inputs de archivo — ver el docblock de `post-composer.tsx`.
 */
export interface ComposerMenuValue {
  open: boolean;
  openMenu: () => void;
}

/**
 * Sin provider (tests que montan `BottomNav` solo, una pantalla sin
 * `PostComposerHost` arriba) degrada a "no hay nada que abrir" en vez de
 * reventar — mismo criterio que el resto de los contextos del shell.
 */
const NOOP: ComposerMenuValue = { open: false, openMenu: () => {} };

const ComposerMenuContext = createContext<ComposerMenuValue | null>(null);

export const ComposerMenuProvider = ComposerMenuContext.Provider;

export function useComposerMenu(): ComposerMenuValue {
  return useContext(ComposerMenuContext) ?? NOOP;
}
