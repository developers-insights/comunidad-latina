/**
 * =============================================================================
 * NOTIFICACIONES — de qué entidad habla el aviso (0151)
 * =============================================================================
 *
 * `category` agrupa GRUESO para las pestañas y `kind` etiqueta FINO el evento.
 * Ninguno de los dos dice de QUÉ COSA se está hablando, y ese era exactamente el
 * reclamo: catorce avisos de vencimiento con el mismo reloj y el mismo destino.
 * Este tercer eje —la entidad— es el que da la miniatura, el ícono del módulo y
 * un destino propio por fila.
 *
 * NO lleva "server-only": lo consumen el panel de la campana (client) y la
 * bandeja (server). Acá no hay secretos, son etiquetas y una ruta.
 */

/** Espeja el CHECK `notifications_entity_type_check` (0151). */
export const NOTIFICATION_ENTITY_TYPES = [
  "listing",
  "post",
  "profile",
  "conversation",
  "job_application",
] as const;

export type NotificationEntityType = (typeof NOTIFICATION_ENTITY_TYPES)[number];

export function isNotificationEntityType(value: unknown): value is NotificationEntityType {
  return (
    typeof value === "string" &&
    (NOTIFICATION_ENTITY_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Misma forma que el CHECK `notifications_entity_kind_check`. La columna es
 * `text` libre a propósito (su vocabulario depende de `entity_type`), así que la
 * UI valida forma antes de usarlo como clave de un mapa de íconos.
 */
const ENTITY_KIND_RE = /^[a-z][a-z0-9_]{0,31}$/;

export function parseEntityKind(value: unknown): string | null {
  return typeof value === "string" && ENTITY_KIND_RE.test(value) ? value : null;
}

export type NotificationEntity = {
  type: NotificationEntityType;
  /** Sub-tipo: para `listing`, el vertical (`property`, `job`, `event`…). */
  kind: string | null;
  /**
   * Miniatura TAL COMO SE GUARDÓ: path del bucket `listing-photos` o URL
   * absoluta de seed. La resolución a URL pública es de la app
   * (`listingPhotoUrl`), no de la base — ese valor cambia entre entornos.
   */
  imageUrl: string | null;
};

/** El parámetro que destaca una publicación en /publicaciones. */
export const AVISO_PARAM = "aviso";

/**
 * Destino de un aviso sobre una publicación PROPIA.
 *
 * Mis publicaciones y no el detalle público, por dos razones que se refuerzan:
 * lo que hay que hacer con estos avisos es renovar (y el botón vive sólo acá), y
 * el detalle público de una publicación vencida no se muestra. El parámetro deja
 * la fila primera y destacada, que es lo que faltaba para saber de cuál de las
 * veinte publicaciones está hablando el aviso.
 */
export function listingAvisoHref(listingId: string): string {
  return `/publicaciones?${AVISO_PARAM}=${encodeURIComponent(listingId)}`;
}
