/**
 * NOTIFICACIONES — el contrato del desplegable de la campana.
 *
 * Vive en `lib/` y no al lado del componente por el mismo motivo que
 * `href.ts`: lo comparten un módulo `"use server"` (la action que trae los
 * datos) y un módulo `"use client"` (el panel que los pinta). Un tipo declarado
 * adentro de cualquiera de los dos ataría un lado al otro a través de un límite
 * de React Server Components — que es exactamente el bug que ancla
 * `client-boundary.test.ts`.
 *
 * POR QUÉ UN VIAJE APARTE Y NO LOS DATOS EN EL HEADER. El header es un Server
 * Component que se renderiza en CADA navegación de la app. La campana ya le
 * cuesta una consulta (el contador del globito); sumarle la lista completa
 * sería pagar seis filas en cada pantalla para una gaveta que la mayoría de las
 * veces no se abre. El panel las pide cuando se abre, y las vuelve a pedir cada
 * vez que se abre: nunca muestra una lista de hace tres pantallas.
 */

/** Cuántos avisos entran en la gaveta. El resto está a un toque, en la bandeja. */
export const PANEL_LIMIT = 6;

/**
 * Una fila del desplegable. Deliberadamente más chica que `NotificationItemData`
 * (la fila de /notificaciones): acá no hay menú de ⋯ ni pastilla de acción, así
 * que `kind`, `priority` y `actionLabel` no tendrían quién los lea.
 */
export type NotificationPanelItem = {
  id: string;
  /** Ya validada contra el CHECK de la base; el fallback lo pone el servidor. */
  category: string;
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  /** ISO, para `<time dateTime>`. */
  createdAt: string;
  /** "hace 2 horas", formateado en el servidor (misma función que la bandeja). */
  timeLabel: string;
};

export type NotificationPanelData = {
  /** Sin leer EN TOTAL, no en esta página de seis: es lo que dice el globito. */
  unread: number;
  items: NotificationPanelItem[];
};

/**
 * Un fallo de lectura NO viaja como lista vacía. En esta bandeja viven las
 * alertas de seguridad y los pagos fallidos: "no pudimos cargar" y "no tenés
 * nada" tienen que poder distinguirse, igual que en /notificaciones.
 */
export type NotificationPanelResult =
  | { ok: true; data: NotificationPanelData }
  | { ok: false };
