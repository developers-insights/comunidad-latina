import "server-only";

import { headers } from "next/headers";

/**
 * Dominio desde el que se está cargando el archivo.
 *
 * Va a `content_assets.source_host`, que la 0061 guarda COMO TEXTO y congelado
 * al momento de la carga: si el dominio se archiva o se borra de
 * `tenant_domains`, la evidencia de "esto se subió desde X" no puede
 * evaporarse. Por eso acá se prefiere el host real del request antes que el
 * slug del tenant, y el slug queda sólo de red de contención.
 *
 * `x-forwarded-host` primero porque detrás del proxy de Vercel `host` puede ser
 * el interno. Vive en su propio archivo —y no dentro de `register.ts`— para que
 * el pipeline se pueda testear sin montar el contexto de request de Next.
 */
export async function currentSourceHost(fallback: string): Promise<string> {
  try {
    const headerList = await headers();
    const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
    return host?.trim() || fallback;
  } catch {
    // Fuera de un request (cron, script): el slug del tenant es lo más honesto
    // que se puede decir sin inventar un dominio.
    return fallback;
  }
}
