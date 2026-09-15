/**
 * ¿PUEDO PONERLE PLATA A ESTO AHORA? — la regla, en un solo lugar.
 *
 * Vivía dentro de `app/(app)/impulsar/impulsar-items.ts`, que es el modelo de
 * UNA pantalla. Se mudó acá cuando las pantallas de éxito de los wizards de
 * publicación (`/publicar`, `/marketplace/publicar`, `/empleos/publicar`,
 * `/creadores/publicar`) empezaron a ofrecer el impulso al terminar: son
 * componentes de cliente y no pueden depender de un módulo de una ruta del App
 * Router. `impulsar-items.ts` lo reexporta, así que nada de lo que ya importaba
 * de ahí se entera del cambio.
 *
 * Que la regla esté una sola vez no es prolijidad: es lo que impide que un
 * wizard ofrezca "Impulsar" sobre un aviso que el destino va a rechazar.
 */

/**
 * En qué punto está algo propio RESPECTO DE PODER PROMOCIONARSE.
 *
 * No es `listings.status` renombrado: junta el estado de la fila con el de su
 * promoción vigente, que viven en dos tablas y contestan una sola pregunta —
 * "¿puedo ponerle plata a esto ahora?".
 *
 * Los estados no promocionables van SEPARADOS porque cada uno se resuelve de
 * una forma distinta: un borrador se termina, un vencido se renueva, uno en
 * revisión sólo se espera. Hasta el 2026-09-07 los seis se pintaban como
 * "Todavía en revisión" y encima con el botón "Promocionar" en primario, que
 * llevaba a `/impulsar/[listingId]` sólo para leer que no se podía (las dos
 * pantallas de destino exigen `status = 'published'`). De los seis, el texto
 * era cierto en uno.
 *
 * El catálogo de `listings.status` es el CHECK de la migración 0117
 * (draft · pending_review · published · paused · removed · expired · closed);
 * `posts.status` (0007) sólo tiene published · removed · pending_review, así
 * que un post nunca alcanza los estados de aviso. `removed` no llega acá: lo
 * descarta la query del índice.
 */
export type EstadoPromocion =
  | "activa"
  | "lista"
  | "en_revision"
  | "sin_terminar"
  | "pausada"
  | "vencida"
  | "cerrada"
  | "no_disponible";

/**
 * Un `status` que no conocemos NUNCA cae en "lista": el destino lo iba a
 * rechazar igual, y un botón que promete lo que el servidor niega es
 * exactamente el bug que esta función existe para cerrar.
 */
export function estadoDePromocion(
  status: string,
  promocionVigente: boolean,
): EstadoPromocion {
  if (status === "published") return promocionVigente ? "activa" : "lista";

  switch (status) {
    case "pending_review":
      return "en_revision";
    case "draft":
      return "sin_terminar";
    case "paused":
      return "pausada";
    case "expired":
      return "vencida";
    case "closed":
      return "cerrada";
    default:
      return "no_disponible";
  }
}

/** Los dos únicos estados en los que "Promocionar" lleva a algún lado. */
export function puedePromocionarse(estado: EstadoPromocion): boolean {
  return estado === "lista" || estado === "activa";
}
