/**
 * Aparte de `page.tsx` a propósito: un route file de App Router SOLO puede
 * exportar el contrato que Next.js reconoce (`default`, `metadata`,
 * `generateMetadata`, etc.) — el validador de tipos generado en
 * `.next/types/app/**` rechaza cualquier otro named export con un error de
 * compilación (`Property '...' is incompatible with index signature`), no
 * sólo un lint. Esta lógica necesitaba vivir en un módulo propio para poder
 * importarse desde un test.
 */

/** Estados que ofrecen "Marcar como…" (0117) — mismo subconjunto que valida
 *  `cerrarPublicacion` en `actions.ts`; mantenerlos sincronizados es lo que
 *  evita que la pantalla ofrezca un botón que la action va a rechazar. */
const CERRABLES = new Set(["published", "paused", "expired"]);

/**
 * ¿Se ofrece "Cerrar / Marcar como…" para esta publicación? Mismo
 * subconjunto que `CERRABLES` MENOS `pausadaPorReportes`: un aviso pausado
 * por denuncias (0118) no lo cierra su dueño — el trigger
 * `app.listings_guard_cierre()` (migración 0117) rechaza con excepción
 * cualquier transición a `closed` que salga de una pausa por reportes ("un
 * aviso bajo revisión no se cierra, se resuelve"). La action lo va a
 * rechazar igual (defensa en profundidad), pero acá se corta antes: no se
 * ofrece un botón que va a fallar siempre.
 */
export function puedeCerrarPublicacion(status: string, pausadaPorReportes: boolean): boolean {
  return CERRABLES.has(status) && !pausadaPorReportes;
}
