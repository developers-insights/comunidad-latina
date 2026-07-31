/**
 * Política de medios de la plataforma. Hoy: VIDEO.
 *
 * `video-policy` es puro (server y cliente lo importan igual); `measure-video`
 * toca el DOM y sólo tiene sentido en el navegador — por eso está separado y no
 * se re-exporta desde acá: un Server Component que importe el barril no puede
 * arrastrarse un módulo que crea elementos.
 */
export * from "./video-policy";
