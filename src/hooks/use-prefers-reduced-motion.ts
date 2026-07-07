"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(QUERY);
  // Safari <14 usa addListener/removeListener
  if (mql.addEventListener) {
    mql.addEventListener("change", callback);
    return () => mql.removeEventListener("change", callback);
  }
  mql.addListener(callback);
  return () => mql.removeListener(callback);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

/** SSR-safe: en el server siempre asume "sin reduce" para no desincronizar la hidratación. */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * `true` cuando el usuario pidió menos movimiento a nivel de SO.
 * Todo primitivo de motion debe consultarlo y ofrecer un fallback sin animación.
 *
 * @example
 * const reduce = usePrefersReducedMotion();
 * <div style={{ transition: reduce ? "none" : "transform .2s" }} />
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
