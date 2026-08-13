/**
 * El prefijo "propio" de un path de Storage — `{tenant_id}/{user_id}/…` — y su
 * validación.
 *
 * ── POR QUÉ ESTE ARCHIVO EXISTE Y NO ES UN HELPER MÁS EN `actions.ts` ───────
 * `perfil/actions.ts` es `"use server"`: sólo puede exportar funciones async
 * (ver `src/test/use-server-exports.test.ts`). Un helper puro exportado de ahí
 * rompe la build entera con "Server Actions must be async functions", y ya
 * pasó dos veces en este repo (2026-07-27, 2026-08-08).
 *
 * ── POR QUÉ ES COMPARTIDO ENTRE PORTADA Y AVATAR ────────────────────────────
 * Las dos son la MISMA regla de seguridad: la persona sube directo al bucket
 * `avatars` desde el navegador (policy `avatars_insert`, 0012), y la server
 * action que guarda el path en `profiles` tiene que volver a validar que ese
 * path caiga DENTRO de su propia carpeta antes de creer lo que mandó el
 * cliente — la policy de Storage ya lo impidió al SUBIR, pero nada impediría
 * que alguien guardara en su perfil la ruta de la foto de OTRA persona (un
 * path que jamás subió, pero que puede adivinar si conoce el id ajeno). Antes
 * vivía duplicada inline en cada campo (`coverPath` primero, 0062); esta
 * versión la deja en un solo lugar, con un solo test que prueba las dos veces.
 */

/** El prefijo canónico de Storage para esta persona. Termina en `/`. */
export function ownStoragePrefix(tenantId: string, userId: string): string {
  return `${tenantId}/${userId}/`;
}

/**
 * `true` si `path` cae DENTRO de la carpeta propia — nunca en la de otra
 * persona ni en la de otro tenant. El chequeo de `..` es cinturón y tiradores:
 * con el prefijo exacto ya alcanzaría, pero un recorrido de directorios no
 * tiene ningún motivo legítimo para estar en un path que nosotros mismos
 * armamos con `Date.now()` como único componente variable.
 */
export function isWithinOwnStoragePrefix(
  path: string,
  tenantId: string,
  userId: string,
): boolean {
  const prefix = ownStoragePrefix(tenantId, userId);
  return path.startsWith(prefix) && !path.includes("..");
}
