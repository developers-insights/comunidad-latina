"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTenant } from "@/lib/tenant/resolve";
import {
  encodeZonaCookie,
  sanitizeZona,
  ZONA_COOKIE,
  ZONA_COOKIE_MAX_AGE,
  ZONA_MAX_LEN,
} from "./cookie";
import { ZONA_COPY } from "./copy";
import { listarZonasDelTenant } from "./server";

/**
 * =============================================================================
 * ELEGIR ZONA — la única puerta que escribe `cl-zona`
 * =============================================================================
 *
 * ── POR QUÉ UNA ACTION Y NO UN LINK CON `?zona=` ────────────────────────────
 * Porque la preferencia tiene que sobrevivir a la navegación: si fuera un
 * parámetro, cambiar de módulo la perdería y habría que arrastrarla en cada
 * enlace de la app. Y porque `cookies().set()` sólo se puede llamar desde una
 * Server Function o un Route Handler (Next 16): un Server Component no puede
 * escribir cookies.
 *
 * ── POR QUÉ SE REVALIDA TODO ────────────────────────────────────────────────
 * `revalidatePath("/", "layout")`, igual que `cambiarIdentidad`: la zona se
 * pinta en el HEADER, que es layout de la app entera, y filtra los seis
 * listados. Revalidar sólo la pantalla donde se tocó el botón dejaría el header
 * mostrando la zona vieja — el peor bug posible acá, porque el header es la
 * promesa de "esto es lo que estás viendo".
 *
 * ── QUÉ NO HACE, Y ES DELIBERADO ────────────────────────────────────────────
 * NO toca `profiles.area_label`. Elegir qué mirar no es mudarse: ver Jackson
 * Heights porque te estás por mudar no puede reescribir de dónde sos.
 */

const elegirSchema = z.object({
  /** `null` = toda la comunidad. Texto libre: `area_label` también lo es. */
  zona: z.string().max(ZONA_MAX_LEN * 2).nullable(),
});

export type ElegirZonaResult =
  | { ok: true; zona: string | null }
  | { ok: false; mensaje: string };

export async function elegirZona(input: unknown): Promise<ElegirZonaResult> {
  const parsed = elegirSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, mensaje: ZONA_COPY.toast.error };
  }

  // `null` explícito ⇒ toda la comunidad. Un texto que no sobrevive al saneo
  // (vacío, un solo carácter, puro símbolo) también: pedir "ver ''" no es una
  // zona, y quedarse en la anterior sin decir nada sería peor que ampliar.
  const zona = parsed.data.zona === null ? null : sanitizeZona(parsed.data.zona);

  try {
    const store = await cookies();
    store.set(ZONA_COOKIE, encodeZonaCookie(zona), {
      path: "/",
      maxAge: ZONA_COOKIE_MAX_AGE,
      sameSite: "lax",
      // El servidor es el único que la lee (el primer render sale ya filtrado).
      // Nada en el navegador la necesita, así que no se la damos a nadie más.
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });
  } catch {
    return { ok: false, mensaje: ZONA_COPY.toast.error };
  }

  revalidatePath("/", "layout");
  return { ok: true, zona };
}

/**
 * Las zonas para la hoja del selector, pedidas RECIÉN al abrirla.
 *
 * No viajan con cada render del header a propósito: el header vive en el layout
 * de toda la app, así que precargarlas sería un escaneo de `listings` en cada
 * navegación de cada pantalla para una lista que casi nunca se abre. La
 * escalabilidad de esta feature depende de esta decisión.
 */
export async function listarZonasDisponibles(): Promise<string[]> {
  const tenant = await getTenant();
  return listarZonasDelTenant(tenant.id);
}
