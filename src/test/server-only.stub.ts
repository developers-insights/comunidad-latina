/**
 * Stub de `server-only` para Vitest (ver alias en vitest.config.ts).
 *
 * El paquete real lanza cuando se importa fuera de la condición `react-server`,
 * lo que impediría testear cualquier módulo marcado como server-only. En build
 * y en runtime sigue vigente el paquete real: este archivo NO se referencia
 * desde `src/` ni desde Next.
 */
export {};
