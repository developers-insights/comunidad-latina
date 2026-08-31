"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTenant } from "@/lib/tenant/resolve";
import { barrioMasCercano } from "./centroides";
import {
  encodeZonaCookie,
  sanitizeZona,
  ZONA_COOKIE,
  ZONA_COOKIE_MAX_AGE,
  ZONA_MAX_LEN,
} from "./cookie";
import { ZONA_COPY } from "./copy";
import {
  encodeRadioCookie,
  RADIO_COOKIE,
  RADIO_COOKIE_MAX_AGE,
  sanitizeRadio,
  type RadioMillas,
} from "./radio";
import { getRadioActivo, listarZonasDelTenant } from "./server";

/**
 * =============================================================================
 * ELEGIR ZONA — la única puerta que escribe `cl-zona` y `cl-radio`
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
 * listados más el feed. Revalidar sólo la pantalla donde se tocó el botón
 * dejaría el header mostrando la zona vieja — el peor bug posible acá, porque
 * el header es la promesa de "esto es lo que estás viendo".
 *
 * ── QUÉ NO HACE, Y ES DELIBERADO ────────────────────────────────────────────
 * NO toca `profiles.area_label`. Elegir qué mirar no es mudarse: ver Jackson
 * Heights porque te estás por mudar no puede reescribir de dónde sos. Y "usar
 * mi ubicación" tampoco lo toca, por el mismo motivo y con más razón: el GPS
 * dice dónde estoy PARADO ahora, no de dónde soy.
 */

const elegirSchema = z.object({
  /** `null` = toda la comunidad. Texto libre: `area_label` también lo es. */
  zona: z.string().max(ZONA_MAX_LEN * 2).nullable(),
});

export type ElegirZonaResult =
  | { ok: true; zona: string | null }
  | { ok: false; mensaje: string };

/**
 * Escribe `cl-zona`. Devuelve `false` si el store de cookies no está
 * disponible (fuera de un request), que es la única falla posible acá.
 *
 * Vive aparte porque tiene DOS llamadores —`elegirZona` y `usarMiUbicacion`— y
 * los atributos de la cookie (httpOnly, sameSite, maxAge) no pueden divergir
 * entre ellos: una de las dos puertas escribiendo una cookie con otra vida útil
 * sería un bug imposible de ver hasta que alguien pierde su zona a los 30 días.
 */
async function escribirZona(zona: string | null): Promise<boolean> {
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
    return true;
  } catch {
    return false;
  }
}

export async function elegirZona(input: unknown): Promise<ElegirZonaResult> {
  const parsed = elegirSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, mensaje: ZONA_COPY.toast.error };
  }

  // `null` explícito ⇒ toda la comunidad. Un texto que no sobrevive al saneo
  // (vacío, un solo carácter, puro símbolo) también: pedir "ver ''" no es una
  // zona, y quedarse en la anterior sin decir nada sería peor que ampliar.
  const zona = parsed.data.zona === null ? null : sanitizeZona(parsed.data.zona);

  if (!(await escribirZona(zona))) {
    return { ok: false, mensaje: ZONA_COPY.toast.error };
  }

  revalidatePath("/", "layout");
  return { ok: true, zona };
}

/**
 * =============================================================================
 * USAR MI UBICACIÓN — de una coordenada a un barrio, y nada más
 * =============================================================================
 *
 * Esta action es el único punto de toda la plataforma que recibe la ubicación
 * real de una persona, y existe para DESTRUIRLA: entra un par lat/lng, sale el
 * nombre del barrio más cercano, y lo que se guarda es exactamente lo mismo que
 * habría quedado si la persona lo elegía a mano de la lista.
 *
 * ── LAS TRES REGLAS QUE NO SE NEGOCIAN ──────────────────────────────────────
 *  1. La coordenada NO se persiste. No hay columna donde ponerla y no se va a
 *     crear: la 0004 prohíbe geo exacta en columnas públicas y el diseño
 *     anti-honeypot de esta app depende de que eso siga siendo cierto.
 *  2. La coordenada NO se loguea. Ni en un `console.warn` de diagnóstico, ni
 *     dentro del mensaje de un error. Un log es una base de datos con peor
 *     control de acceso.
 *  3. La coordenada NO vuelve al cliente. El valor de retorno es una etiqueta
 *     de barrio; ni la distancia se devuelve, porque "estás a 0.4 millas de
 *     Corona" es un dato más fino que el barrio y no aporta nada al producto.
 *
 * ── POR QUÉ EL CÁLCULO ES DEL SERVIDOR ──────────────────────────────────────
 * Podría hacerse en el navegador y mandar sólo la etiqueta, y sería igual de
 * privado. Pero entonces el barrio lo elegiría el cliente, y ya sabemos qué
 * pasa cuando la distribución la decide el cliente: es un campo para elegir en
 * qué barrio aparecer (la 0115 lo explica para `posts.area_label`). El servidor
 * resuelve, el cliente informa. Ante la duda, el servidor.
 *
 * ── EL TECHO DE 60 MILLAS ───────────────────────────────────────────────────
 * Ver `SNAP_MAX_MILLAS`. Alguien mirando desde Santo Domingo NO es de Queens, y
 * contestarle que sí sería cambiarle la vista con una mentira. Se le dice que
 * no encontramos nada cerca y la lista queda abierta.
 */

const ubicacionSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});

export type UsarMiUbicacionResult =
  | { ok: true; zona: string }
  | { ok: false; mensaje: string };

export async function usarMiUbicacion(input: unknown): Promise<UsarMiUbicacionResult> {
  const parsed = ubicacionSchema.safeParse(input);
  if (!parsed.success) {
    // A propósito NO se dice qué venía mal ni se toca `parsed.error`: el error
    // de zod trae el valor recibido adentro, y el valor recibido es una
    // coordenada. Un mensaje de diagnóstico prolijo sería una filtración.
    return { ok: false, mensaje: ZONA_COPY.ubicacion.error.generico };
  }

  const cercano = barrioMasCercano({ lat: parsed.data.lat, lng: parsed.data.lng });
  if (!cercano) {
    return { ok: false, mensaje: ZONA_COPY.ubicacion.error.lejos };
  }

  const zona = sanitizeZona(cercano.centroide.label);
  if (!zona || !(await escribirZona(zona))) {
    return { ok: false, mensaje: ZONA_COPY.ubicacion.error.generico };
  }

  revalidatePath("/", "layout");
  return { ok: true, zona };
}

/**
 * =============================================================================
 * ELEGIR EL RADIO — cuántas millas a la redonda
 * =============================================================================
 *
 * `null` = "solo mi zona", y se GUARDA (centinela `__solo`), no se borra la
 * cookie. Ver el encabezado de `./radio`: apagar borrando funciona hoy y
 * dejaría de funcionar el día que el default pase a ser 25 millas.
 */

const radioSchema = z.object({
  /** `null` = solo mi zona. Cualquier otro valor tiene que ser de la lista. */
  millas: z.union([z.number(), z.string()]).nullable(),
});

export type ElegirRadioResult =
  | { ok: true; millas: RadioMillas | null }
  | { ok: false; mensaje: string };

export async function elegirRadio(input: unknown): Promise<ElegirRadioResult> {
  const parsed = radioSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, mensaje: ZONA_COPY.toast.radioError };
  }

  // Un radio que no está en la lista NO cae al default: cae a "solo mi zona".
  // Adivinar hacia arriba mostraría contenido de más lejos que lo que nadie
  // pidió, y esta feature existe para acercar, no para ampliar por accidente.
  const millas = parsed.data.millas === null ? null : sanitizeRadio(parsed.data.millas);

  try {
    const store = await cookies();
    store.set(RADIO_COOKIE, encodeRadioCookie(millas), {
      path: "/",
      maxAge: RADIO_COOKIE_MAX_AGE,
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });
  } catch {
    return { ok: false, mensaje: ZONA_COPY.toast.radioError };
  }

  revalidatePath("/", "layout");
  return { ok: true, millas };
}

/** Lo que la hoja del selector necesita para pintarse, en un solo round-trip. */
export interface HojaDeZona {
  /** Las zonas publicadas en esta comunidad (muestra de 200 filas). */
  zonas: string[];
  /** El radio guardado, o `null` si nunca lo tocó / lo apagó. */
  radio: RadioMillas | null;
}

/**
 * Lo de la hoja del selector, pedido RECIÉN al abrirla.
 *
 * No viaja con cada render del header a propósito: el header vive en el layout
 * de toda la app, así que precargarlo sería un escaneo de `listings` en cada
 * navegación de cada pantalla para una lista que casi nunca se abre. La
 * escalabilidad de esta feature depende de esta decisión.
 *
 * El radio viene en la MISMA respuesta y no en una action aparte: son dos datos
 * de la misma hoja y dos POST secuenciales para abrirla se notan en un teléfono
 * con señal mala. Además así el control de millas es autosuficiente — no
 * necesita que nadie le pase el valor como prop desde el layout.
 */
export async function cargarHojaDeZona(): Promise<HojaDeZona> {
  const tenant = await getTenant();
  const [zonas, radio] = await Promise.all([
    listarZonasDelTenant(tenant.id),
    getRadioActivo(),
  ]);
  return { zonas, radio };
}
