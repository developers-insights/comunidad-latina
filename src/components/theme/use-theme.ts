"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { ResolvedTheme, Theme } from "./constants";
import {
  getServerSnapshot,
  getSnapshot,
  setTheme as setThemeInStore,
  subscribe,
  toggleTheme,
} from "./theme-store";

export interface UseThemeResult {
  /** Preferencia elegida: `light` | `dark` | `system`. Default `system`. */
  theme: Theme;
  /**
   * Tema efectivo. `null` en el server y en el render de hidratación — no hay
   * forma honesta de saberlo. Usalo como señal de "ya montó":
   * `const mounted = resolvedTheme !== null`.
   */
  resolvedTheme: ResolvedTheme | null;
  /** Fija una preferencia explícita. `system` vuelve a seguir al SO en vivo. */
  setTheme: (theme: Theme) => void;
  /** Alterna claro↔oscuro (deja de seguir al SO). */
  toggle: () => void;
}

export function useTheme(): UseThemeResult {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((next: Theme) => setThemeInStore(next), []);
  const toggle = useCallback(() => toggleTheme(), []);

  return {
    theme: snapshot.theme,
    resolvedTheme: snapshot.resolvedTheme,
    setTheme,
    toggle,
  };
}
