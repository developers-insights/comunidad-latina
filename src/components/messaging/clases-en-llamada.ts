/**
 * El pie del hilo cuando vive en el panel de la llamada. Vive fuera de
 * `en-vuelo.tsx` porque lo importan Server Components: de un módulo
 * `use client` sólo pueden importar componentes.
 */
export const CLASE_PIE_EN_LLAMADA =
  "sticky bottom-0 z-10 border-t border-border-subtle bg-canvas/95 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-sm";
