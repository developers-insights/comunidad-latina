import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_TIME_ZONE, formatDate, type FormatDateOptions } from "@/lib/utils";

/**
 * QUIEN MIRA, leído UNA sola vez por request.
 *
 * ── LA REGLA ─────────────────────────────────────────────────────────────────
 * Una fecha se muestra en la zona de quien LEE, no en la de quien escribió. Un
 * post publicado a las 22:00 en Los Ángeles y leído en Nueva York son el mismo
 * instante contado con dos relojes, y cada persona tiene que ver el suyo.
 *
 * ── POR QUÉ ESTO DEVUELVE MÁS QUE LA ZONA ────────────────────────────────────
 * La zona vive en `profiles`, y el layout de `(app)` ya leía esa MISMA fila para
 * el gate de sanciones (`account_status`, `suspended_until`). Eran dos
 * `auth.getUser()` y dos `select` sobre la misma fila, en el camino más caliente
 * de la app, para dos datos que viajan juntos. Ahora es una sola lectura: la
 * fila entera de "quien mira" sale de acá y cada consumidor toma su columna.
 *
 * No es una capa de sesión de propósito general —no la conviertas en eso—: son
 * las tres columnas que el shell necesita SIEMPRE, en toda pantalla, antes de
 * pintar nada. Cualquier otra columna que se agregue acá se paga en cada request.
 *
 * ── QUÉ TIRA Y QUÉ NO ────────────────────────────────────────────────────────
 * `getViewerAccount()` propaga los errores, igual que hacía el layout cuando
 * leía la fila él mismo: si la sesión no se puede resolver, el gate de sanciones
 * NO puede seguir de largo como si la cuenta estuviera sana.
 * `getViewerTimeZone()` sí los traga y cae a `null`: formatear una fecha nunca
 * puede tirar una pantalla abajo.
 *
 * ── MEMOIZADO POR REQUEST ────────────────────────────────────────────────────
 * `cache()` de React: el layout y todas las pantallas que formatean una fecha
 * piden lo mismo y la DB se consulta una sola vez, igual que `getShellContext`.
 */

export interface ViewerAccount {
  id: string;
  /** `profiles.timezone` (0067) — IANA, o `null` si nunca eligió. */
  timezone: string | null;
  /** `profiles.account_status` — lo consume el gate de sanciones (0021). */
  accountStatus: string | null;
  suspendedUntil: string | null;
}

export const getViewerAccount = cache(async (): Promise<ViewerAccount | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Lista explícita de columnas: `profiles` es pública y `select("*")` acá
  // arrastraría rol, verificación de identidad y datos de contacto para pintar
  // el shell.
  const { data } = await supabase
    .from("profiles")
    .select("timezone, account_status, suspended_until")
    .eq("id", user.id)
    .maybeSingle();

  return {
    id: user.id,
    timezone: data?.timezone ?? null,
    accountStatus: data?.account_status ?? null,
    suspendedUntil: data?.suspended_until ?? null,
  };
});

/**
 * La zona horaria de quien mira, resuelta en el servidor.
 *
 * ── LA CADENA DE CAÍDA ───────────────────────────────────────────────────────
 *   1. `profiles.timezone` — lo que la persona eligió en Ajustes (0067).
 *   2. `null` — no eligió nada (o no tiene sesión). Acá se devuelve `null` a
 *      propósito y NO `DEFAULT_TIME_ZONE`: quien llama decide si cae a la zona
 *      de la comunidad (servidor) o a la del navegador (cliente). Devolver ya
 *      resuelto el default haría imposible distinguir "eligió Nueva York" de
 *      "no eligió nada", que son dos cosas distintas.
 *
 * El paso 3 —la zona del navegador— sólo puede resolverse en el cliente, y lo
 * hace `useViewerTimeZone()` (components/time/viewer-time-zone.tsx). No se
 * guarda en una cookie a propósito: sería un dato de geolocalización gruesa
 * viajando en cada request, y habría que declararlo en el inventario de
 * `lib/consent`. La ganancia no lo paga.
 */
export async function getViewerTimeZone(): Promise<string | null> {
  try {
    return (await getViewerAccount())?.timezone ?? null;
  } catch {
    // Formatear una fecha nunca puede tirar una pantalla abajo.
    return null;
  }
}

/**
 * `formatDate` con la zona de quien mira ya puesta — el espejo servidor de
 * `useFormatDate()` (components/time/viewer-time-zone.tsx).
 *
 * Existe para que en las pantallas no haya que acordarse de pasar la zona, que
 * es exactamente la clase de cosa que se olvida en el archivo número once. Un
 * Server Component no puede saber la zona del navegador, así que sin elección
 * explícita cae a la de la comunidad; los componentes de cliente que ya viven
 * bajo `<ViewerTimeZoneProvider>` sí llegan al paso 3 con `useFormatDate()`.
 */
export async function getViewerFormatDate(): Promise<
  (date: Date | string | number, options?: Omit<FormatDateOptions, "timeZone">) => string
> {
  const timeZone = (await getViewerTimeZone()) ?? DEFAULT_TIME_ZONE;
  return (date, options = {}) => formatDate(date, { ...options, timeZone });
}
