/**
 * NOTIFICACIONES — el contrato de la gaveta de la campana CON CATEGORÍAS.
 *
 * Vive en `lib/` por el mismo motivo que `panel.ts` y `href.ts`: lo comparten un
 * módulo `"use server"` (la action que trae los datos) y uno `"use client"` (el
 * panel que los pinta). Un tipo declarado adentro de cualquiera de los dos ataría
 * un lado al otro a través de un límite de React Server Components — el bug que
 * ancla `client-boundary.test.ts`.
 */

import type { NotificationCategory } from "./categories";
import type { InboxTab } from "./href";
import type { NotificationPanelItem } from "./panel";

export type PanelDeCampana = {
  /** La pestaña que efectivamente se resolvió (la basura cae en "todas"). */
  tab: InboxTab;
  /**
   * Sin leer EN TOTAL, no en esta página de seis ni en esta pestaña: es lo que
   * dice el globito de la campana. Si dijera lo segundo, abrir la gaveta parada
   * en "Mensajes" bajaría el globito de 12 a 3 sin que se leyera nada.
   */
  unread: number;
  /**
   * No leídas POR CATEGORÍA, para el contador de cada pestaña. La ausencia de
   * una clave ES cero (así lo devuelve `notification_counts()`, 0045).
   *
   * Se calcula en el servidor, en una sola consulta agrupada. Traer las
   * notificaciones al cliente para contarlas sería bajar cientos de filas para
   * mostrar seis y catorce números.
   */
  counts: Partial<Record<NotificationCategory, number>>;
  /** Ya filtradas por `tab`. */
  items: NotificationPanelItem[];
};

/**
 * Un fallo de lectura NO viaja como lista vacía. En esta bandeja viven las
 * alertas de seguridad y los pagos fallidos: "no pudimos cargar" y "no tenés
 * nada" tienen que poder distinguirse.
 */
export type PanelDeCampanaResult = { ok: true; data: PanelDeCampana } | { ok: false };
