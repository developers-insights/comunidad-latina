"use client";

import type { IAgoraRTC } from "agora-rtc-sdk-ng";

/**
 * =============================================================================
 * EL SDK DE AGORA SE BAJA CUANDO ARRANCA LA LLAMADA, NUNCA ANTES
 * =============================================================================
 *
 * `agora-rtc-sdk-ng` pesa cerca de un megabyte sin comprimir. Importarlo arriba
 * de la pantalla de mensajes lo metería en el chunk de una ruta que abre todo el
 * mundo, todos los días, para leer texto — y lo pagarían en datos móviles
 * incluso los que nunca llaman a nadie.
 *
 * Por eso el `import()` vive DENTRO de una función y esa función se llama recién
 * en el gesto que inicia o atiende la llamada. El `import type` de arriba no
 * cuenta: TypeScript lo borra y no queda nada en el bundle.
 *
 * ⚠️ Si algún día alguien agrega `import AgoraRTC from "agora-rtc-sdk-ng"` en
 * cualquier módulo que la pantalla de mensajes alcance, esta garantía se cae en
 * silencio. Se verifica con `npm run build` y mirando qué chunk lo contiene.
 */

let cargando: Promise<IAgoraRTC> | null = null;

export function cargarAgora(): Promise<IAgoraRTC> {
  // Una sola descarga por sesión: entrar y salir de tres llamadas no baja el
  // SDK tres veces.
  cargando ??= import("agora-rtc-sdk-ng").then((mod) => {
    const sdk = mod.default;
    // El SDK grita en la consola por defecto. En producción eso es ruido que
    // tapa nuestros propios logs; en desarrollo sirve.
    sdk.setLogLevel(process.env.NODE_ENV === "production" ? 4 : 2);
    return sdk;
  });
  return cargando;
}

/**
 * ¿Este navegador puede capturar micrófono y cámara?
 *
 * Tres "no" distintos, porque la salida para la persona es distinta en cada uno:
 *
 * - `sin-contexto-seguro`: `getUserMedia` sólo existe bajo https (o localhost).
 *   Pasa en una red interna servida por http y en algún webview viejo. La
 *   persona no puede hacer nada salvo abrir el sitio por https.
 * - `sin-api`: el navegador no tiene `mediaDevices` en absoluto — webviews de
 *   apps (Instagram, Facebook) en iOS son el caso típico. La salida es abrir en
 *   Safari o Chrome.
 * - `ok`: se puede pedir permiso. Que lo den o no es otra pregunta, y se
 *   responde en el gesto.
 */
export type SoporteDeMedios = "ok" | "sin-contexto-seguro" | "sin-api";

export function soporteDeMedios(): SoporteDeMedios {
  if (typeof window === "undefined") return "ok";
  if (!window.isSecureContext) return "sin-contexto-seguro";
  if (!navigator.mediaDevices?.getUserMedia) return "sin-api";
  return "ok";
}

/**
 * Por qué el navegador dijo que no al micrófono o a la cámara.
 *
 * Agora envuelve el error del navegador en un `AgoraRTCError` cuyo `code` es un
 * string propio (`PERMISSION_DENIED`, `DEVICE_NOT_FOUND`, …) — pero cuando el
 * fallo viene del `getUserMedia` crudo llega un `DOMException` con `name`. Se
 * miran los dos: quedarse con uno solo deja la mitad de los casos en "algo salió
 * mal", que es el mensaje que no ayuda a nadie.
 */
export type MotivoSinMedios = "permiso" | "sin-dispositivo" | "ocupado" | "desconocido";

export function motivoSinMedios(error: unknown): MotivoSinMedios {
  const señal = new Set<string>();
  if (error && typeof error === "object") {
    const e = error as { code?: unknown; name?: unknown; message?: unknown };
    if (typeof e.code === "string") señal.add(e.code);
    if (typeof e.name === "string") señal.add(e.name);
    if (typeof e.message === "string") señal.add(e.message);
  }
  const texto = [...señal].join(" ");

  if (/PERMISSION_DENIED|NotAllowedError|SecurityError/i.test(texto)) return "permiso";
  if (/DEVICE_NOT_FOUND|NotFoundError|OverconstrainedError/i.test(texto)) return "sin-dispositivo";
  // El dispositivo existe pero otra app lo tiene tomado (Zoom abierto atrás,
  // otra pestaña con la cámara encendida). Windows lo reporta así casi siempre.
  if (/NotReadableError|TrackStartError|AbortError/i.test(texto)) return "ocupado";
  return "desconocido";
}
