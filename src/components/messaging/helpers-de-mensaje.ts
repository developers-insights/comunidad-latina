import { ACCIONES_COPY } from "./copy-acciones";

/**
 * LOS HELPERS PUROS DEL MENSAJE, FUERA DEL LÍMITE `"use client"`.
 *
 * VIVEN ACÁ Y NO EN `reply-quote.tsx` PORQUE LOS LLAMAN SERVER COMPONENTS: las
 * dos pantallas de chat (`resumenDeMensaje`) y las dos burbujas
 * (`anclaDeMensaje`).
 *
 * `reply-quote.tsx` es `"use client"`. Una función exportada desde ahí no es una
 * función para un Server Component: es una referencia al cliente, y llamarla
 * revienta con «Attempted to call resumenDeMensaje() from the server but
 * resumenDeMensaje is on the client».
 *
 * Eso no se veía porque `citaDe()` sale antes por `if (!mensaje.reply_to)`, y
 * `reply_to` lo agrega la 0136 — la primera respuesta citada que exista en la
 * base rompía las dos pantallas.
 *
 * Este archivo no lleva directiva a propósito: lo importan el servidor y el
 * cliente. No le agregues estado, hooks ni `motion/react`; si necesitás algo de
 * eso, va en `reply-quote.tsx`.
 */

export const MAX_RESUMEN = 120;

export function resumenDeMensaje(kind: string, body: string, bajado = false): string {
  if (bajado) return ACCIONES_COPY.responder.resumenBajado;

  const texto = body.trim().replace(/\s+/g, " ");
  if (texto) {
    return texto.length > MAX_RESUMEN ? `${texto.slice(0, MAX_RESUMEN - 1)}…` : texto;
  }

  switch (kind) {
    case "imagen":
      return ACCIONES_COPY.responder.resumenFoto;
    case "video":
      return ACCIONES_COPY.responder.resumenVideo;
    case "audio":
      return ACCIONES_COPY.responder.resumenAudio;
    case "archivo":
      return ACCIONES_COPY.responder.resumenArchivo;
    case "ubicacion":
      return ACCIONES_COPY.responder.resumenUbicacion;
    case "perfil":
      return ACCIONES_COPY.responder.resumenPerfil;
    default:
      return ACCIONES_COPY.responder.resumenContenido;
  }
}

/**
 * El `id` del DOM de una burbuja. Lo pone la burbuja y lo busca la cita: es el
 * único acuerdo entre las dos, y por eso vive en una función y no escrito a
 * mano en los dos lados.
 */
export function anclaDeMensaje(mensajeId: string): string {
  return `mensaje-${mensajeId}`;
}
