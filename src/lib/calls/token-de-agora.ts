import "server-only";

import { RtcRole, RtcTokenBuilder } from "agora-token";

/**
 * =============================================================================
 * EL TOKEN DE AGORA SE FIRMA ACÁ Y EN NINGÚN OTRO LADO
 * =============================================================================
 *
 * `AGORA_APP_CERTIFICATE` es la llave con la que se firma la entrada a
 * CUALQUIER canal del proyecto. Quien la tenga puede fabricarse un token para
 * la llamada de cualquier persona, y ni el canal aleatorio de la 0139 ni la RLS
 * lo frenarían: Agora sólo mira la firma. Por eso este archivo lleva
 * `server-only` —importarlo desde un client component rompe el build, que es
 * exactamente lo que queremos— y por eso el certificado no tiene prefijo
 * `NEXT_PUBLIC_`.
 *
 * El App ID SÍ es público (viaja en el `join()` del navegador) y por eso sí lo
 * lleva. Que los dos nombres se parezcan es la trampa de este módulo.
 *
 * ── POR QUÉ EL VENCIMIENTO ES DE MINUTOS ────────────────────────────────────
 * Un token robado —de un log, del historial de red de una máquina compartida,
 * de una extensión— es una silla adentro de una llamada ajena hasta que vence.
 * Con una hora de TTL eso es una hora de escucha; con cinco minutos es una
 * ventana que además exige que la llamada siga viva. El costo es una renovación
 * cada cuatro minutos y medio, que el SDK avisa solo
 * (`token-privilege-will-expire`) y el motor resuelve sin que se corte nada.
 */

/** Cinco minutos. Ver arriba por qué no son sesenta. */
export const TOKEN_TTL_SEGUNDOS = 300;

/**
 * Cuánto antes del vencimiento se pide uno nuevo. Agora dispara su propio aviso
 * 30 s antes; este margen es el nuestro, por si el evento no llega (pestaña
 * dormida, red lenta) y hay que renovar por reloj.
 */
export const MARGEN_DE_RENOVACION_SEGUNDOS = 45;

export function agoraEstaConfigurado(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_AGORA_APP_ID && process.env.AGORA_APP_CERTIFICATE);
}

export interface TokenEmitido {
  token: string;
  appId: string;
  /** Epoch en milisegundos. El cliente compara contra su propio reloj. */
  expiraEn: number;
}

/**
 * Firma la entrada de UNA persona a UN canal.
 *
 * `uid` es siempre el id de perfil de quien pide, puesto por el servidor: el
 * cliente no elige con qué identidad entra. Es lo que permite que el resto de la
 * sala sepa quién es cada mosaico sin creerle nada al navegador.
 *
 * Rol `PUBLISHER` porque en una llamada todos hablan; no hay audiencia.
 */
export function emitirTokenRtc(params: { canal: string; uid: string }): TokenEmitido {
  const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
  const appCertificate = process.env.AGORA_APP_CERTIFICATE;

  if (!appId || !appCertificate) {
    throw new Error(
      "Agora no está configurado: faltan NEXT_PUBLIC_AGORA_APP_ID y/o AGORA_APP_CERTIFICATE.",
    );
  }

  const token = RtcTokenBuilder.buildTokenWithUserAccount(
    appId,
    appCertificate,
    params.canal,
    params.uid,
    RtcRole.PUBLISHER,
    // Los dos son SEGUNDOS DESDE AHORA, no epoch. El primero vence el token
    // entero; el segundo, el privilegio de publicar. Separarlos no aportaría
    // nada acá: un token sin privilegio de publicar es alguien mudo adentro de
    // la llamada, que no es un estado que la UI sepa contar.
    TOKEN_TTL_SEGUNDOS,
    TOKEN_TTL_SEGUNDOS,
  );

  return {
    token,
    appId,
    expiraEn: Date.now() + TOKEN_TTL_SEGUNDOS * 1000,
  };
}
