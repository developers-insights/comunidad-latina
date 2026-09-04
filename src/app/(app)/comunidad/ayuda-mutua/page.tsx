import { permanentRedirect } from "next/navigation";

/**
 * =============================================================================
 * /comunidad/ayuda-mutua → /comunidad/pedir-ayuda
 * =============================================================================
 *
 * "Ayuda mutua" se sacó el 2026-09-03 y su motor pasó a ser el tablón "Pedir
 * ayuda" (§ del `docs/feedback/2026-09-03-feedback-cliente.md`, punto 8). Esta
 * carpeta se queda con tres archivos que sólo redirigen, y no es pereza:
 *
 *  · La app está instalada como PWA en teléfonos reales y el atajo de alguien
 *    puede apuntar acá. Un 404 en el atajo de la pantalla de inicio se lee como
 *    "la app se rompió", no como "esto se mudó".
 *  · La notificación vieja de un aviso aprobado tiene el href viejo guardado en
 *    `notifications.href`: esas filas no se reescriben, así que el link tiene
 *    que seguir llevando a algún lado.
 *
 * `permanentRedirect` (308) y no `redirect` (307): la mudanza es definitiva y
 * un 308 es lo que hace que los buscadores y los atajos se actualicen solos.
 *
 * Vive como página y no como regla en `next.config.ts` a propósito: la config
 * es un archivo compartido por todos los frentes y una regla ahí es un
 * conflicto de merge esperando; acá el redirect vive al lado de lo que redirige
 * y se borra el día que se borre la carpeta.
 */
export default function AyudaMutuaRedirect() {
  permanentRedirect("/comunidad/pedir-ayuda");
}
