/**
 * =============================================================================
 * EL RADIO EN MILLAS — la segunda mitad de "Tu zona"
 * =============================================================================
 *
 * MÓDULO PURO, igual que `./cookie`: lo importan el Server Component que lo
 * lee, la action que lo escribe, el control del navegador y los tests.
 *
 * Pedido textual del cliente: «un botón al lado donde se puede filtrar por la
 * cantidad de millas a la redonda que la persona le gustaría ver — como
 * standard ponemos un mínimo de 25 millas a la redonda».
 *
 * ── POR QUÉ 25 ESTÁ PRESELECCIONADO Y NO PRENDIDO ───────────────────────────
 * Esta es LA decisión de producto de la feature, así que queda escrita.
 *
 * Un default implícito de 25 millas —radio activo aunque nadie lo haya tocado—
 * le cambiaría de golpe lo que ve TODA la gente que hoy tiene una zona elegida:
 * quien puso "Corona" para ver Corona pasaría a ver medio estado sin haber
 * pedido nada y sin entender por qué. Ese es exactamente el modo de falla que
 * `ZonaVacia` documenta al revés — que la app parezca otra cosa de la que es.
 *
 * Así que el radio se aplica SÓLO cuando la persona lo eligió (hay cookie), y
 * 25 es la opción que aparece marcada como recomendada la primera vez que abre
 * el control. Se cumple lo que pidió el cliente —25 es el estándar— sin
 * reescribirle la vista a nadie por la espalda.
 *
 * Si algún día se decide prenderlo para todos, el cambio es UNA línea en
 * `readRadioCookie`: que la ausencia de cookie devuelva `RADIO_DEFAULT` en vez
 * de `null`. El centinela `RADIO_SOLO_ZONA` ya existe justamente para que ese
 * día la gente que eligió "solo mi zona" no quede pisada.
 *
 * ── POR QUÉ UNA COOKIE PROPIA Y NO ADENTRO DE `cl-zona` ─────────────────────
 * Porque son dos preferencias con vidas distintas: se puede cambiar de barrio
 * quince veces conservando "25 millas", y se puede cambiar el radio sin tocar
 * el barrio. Meterlas en un solo valor obligaría a reescribir el saneo de
 * `cl-zona` —que ya está testeado y del que dependen siete pantallas— para
 * ganar una cookie menos. Mismos atributos, misma vida útil, misma puerta.
 */

/** Nombre de la cookie. Prefijo `cl-` = de la plataforma, igual que `cl-zona`. */
export const RADIO_COOKIE = "cl-radio";

/**
 * Los radios que se pueden elegir, en millas.
 *
 * Escalones y no un deslizador: en un teléfono, apuntar a "37 millas" es un
 * ejercicio de puntería que además no significa nada distinto de 35 ó 40. Cinco
 * opciones entran en una fila y se tocan sin errar.
 *
 * 5 y 10 son "mi barrio y los de al lado"; 25 es el estándar que pidió el
 * cliente; 50 y 100 cubren el área metropolitana entera para quien busca
 * trabajo o vivienda y se puede mover.
 */
export const RADIOS_MILLAS = [5, 10, 25, 50, 100] as const;

export type RadioMillas = (typeof RADIOS_MILLAS)[number];

/** El estándar que pidió el cliente. Es lo que aparece marcado al abrir. */
export const RADIO_DEFAULT: RadioMillas = 25;

/**
 * Valor que significa "SOLO mi zona, y lo elegí yo".
 *
 * Existe por el mismo motivo que `ZONA_TODAS`: apagar el radio borrando la
 * cookie funciona hoy —sin cookie no hay radio— pero dejaría de funcionar el
 * día que el default pase a ser 25. Guardar la decisión de apagarlo la hace
 * sobrevivir a ese cambio. Empieza con `__` para que ningún número pueda
 * chocarlo.
 */
export const RADIO_SOLO_ZONA = "__solo";

/** 180 días, igual que `cl-zona`: es una preferencia de uso diario. */
export const RADIO_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

/**
 * El radio ELEGIDO por una persona, o `null` si no es uno de los cinco.
 *
 * Rechaza en vez de adivinar, igual que `parseBoostScope`: un radio que llega
 * roto no puede convertirse en "mostrale 100 millas". Acepta número o string
 * porque el valor viaja como texto en la cookie y como número desde el control.
 */
export function sanitizeRadio(raw: unknown): RadioMillas | null {
  const valor = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof valor !== "number" || !Number.isFinite(valor)) return null;
  return (RADIOS_MILLAS as readonly number[]).includes(valor)
    ? (valor as RadioMillas)
    : null;
}

/** Lo que la cookie puede querer decir. `null` = no dice nada usable. */
export type RadioCookie = { modo: "solo" } | { modo: "radio"; millas: RadioMillas };

/** El valor que se guarda. `null` ⇒ "solo mi zona" (el centinela). */
export function encodeRadioCookie(millas: RadioMillas | null): string {
  return millas === null ? RADIO_SOLO_ZONA : String(millas);
}

/**
 * El valor crudo de la cookie → intención, ya saneada.
 *
 * `null` (cookie ausente o ilegible) significa hoy "sin radio", que es lo mismo
 * que `{ modo: "solo" }` a efectos del filtro. Se devuelven distinto igual
 * porque la UI SÍ los distingue: ausente = nunca lo tocó (se le ofrece 25
 * marcado), centinela = lo apagó a propósito (se respeta).
 */
export function readRadioCookie(raw: string | null | undefined): RadioCookie | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (raw === RADIO_SOLO_ZONA) return { modo: "solo" };
  const millas = sanitizeRadio(raw);
  return millas === null ? null : { modo: "radio", millas };
}

/**
 * Las millas que hay que aplicar al filtro, o `null` para no aplicar ninguna.
 *
 * ÚNICO lugar donde se decide si el radio está prendido. Que la ausencia de
 * cookie caiga a `null` es la decisión de producto documentada arriba, y está
 * acá sola para que cambiarla sea cambiar una línea y no salir a buscar
 * condiciones repartidas por el código.
 */
export function radioAplicado(cookie: RadioCookie | null): RadioMillas | null {
  return cookie?.modo === "radio" ? cookie.millas : null;
}
