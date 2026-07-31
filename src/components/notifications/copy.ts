/**
 * Textos del módulo NOTIFICACIONES. Español del repo: se le habla a la persona,
 * nunca al sistema. Ninguna cadena vive suelta en el JSX.
 */

import type { RecencyBucket } from "@/lib/notifications/recency";

export const COPY = {
  title: "Notificaciones",

  header: {
    /** Resumen bajo el título. Singular y plural, sin "(s)". */
    unread: (count: number) =>
      count === 1 ? "Tenés 1 aviso sin leer" : `Tenés ${count} avisos sin leer`,
    allRead: "Estás al día",
    settings: "Preferencias de notificaciones",
    markAll: "Marcar todas como leídas",
    markAllInCategory: (label: string) => `Marcar ${label} como leído`,
    markAllShort: "Marcar leídas",
    markAllDone: "Listo, quedaron marcadas como leídas",
    markAllError: "No pudimos marcarlas como leídas. Probá de nuevo.",
  },

  tabs: {
    label: "Categorías de notificaciones",
    all: "Todas",
    more: "Más",
    moreLabel: "Ver el resto de las categorías",
    moreSheetTitle: "Todas las categorías",
    /** Se suma al nombre accesible de la pestaña. */
    unreadSuffix: (count: number) =>
      count === 1 ? "1 sin leer" : `${count} sin leer`,
    panelLabel: "Lista de notificaciones",
  },

  filters: {
    label: "Filtrar notificaciones",
    all: "Todas",
    unread: "No leídas",
    important: "Importantes",
  },

  groups: {
    nuevas: "Nuevas",
    hoy: "Hoy",
    ayer: "Ayer",
    semana: "Esta semana",
    anteriores: "Anteriores",
  } satisfies Record<RecencyBucket, string>,

  critical: {
    /** Encabezado del bloque fijado arriba. Serio, no alarmista. */
    section: "Necesita tu atención",
    eyebrow: "Necesita tu atención",
  },

  row: {
    menuLabel: "Opciones del aviso",
    unread: "Sin leer",
    open: "Abrir",
    markRead: "Marcar como leída",
    markUnread: "Marcar como no leída",
    dismiss: "Quitar de la bandeja",
    dismissHint: "Sacamos el aviso. Lo que pasó sigue estando donde pasó.",
    mute: (label: string) => `Dejar de recibir avisos de ${label}`,
    muteHint: "Lo podés volver a prender en Preferencias.",
    muteDone: (label: string) => `Listo, no vas a recibir más avisos de ${label}`,
    undo: "Deshacer",
    dismissed: "Quitamos el aviso",
    error: "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo.",
  },

  /** Etiqueta del botón de acción, por kind. Sin entrada = la fila entera es la
   *  acción (se toca y navega), que es lo normal. */
  actionLabels: {
    contact_request: "Ver la solicitud",
    message: "Abrir el chat",
    job_application: "Ver la postulación",
    job_application_update: "Ver el aviso",
    identity: "Ver mi verificación",
    payment_failed: "Revisar el pago",
    security_alert: "Revisar mi cuenta",
    account_suspended: "Ver el detalle",
    dispute: "Ver la disputa",
    creator_proposal: "Ver la propuesta",
    listing_question: "Responder",
  } as Record<string, string | undefined>,

  empty: {
    allTitle: "Por ahora, todo tranquilo",
    allMessage:
      "Cuando alguien quiera contactarte o te escriba, el aviso te espera acá.",
    allCta: "Mirar propiedades",
    unreadTitle: "Estás al día",
    unreadMessage: "No te queda ningún aviso sin leer.",
    importantTitle: "Nada urgente",
    importantMessage:
      "Acá aparecen los avisos que piden una decisión tuya: solicitudes, postulaciones y todo lo de seguridad.",
    categoryTitle: (label: string) => `Todavía no hay nada en ${label}`,
    categoryMessage: "Cuando pase algo de esta categoría, lo vas a ver acá.",
    reset: "Ver todas",
  },
} as const;

/**
 * Textos de /ajustes/notificaciones. Viven acá y no en `ajustes/copy.ts` porque
 * la pantalla es del módulo NOTIFICACIONES; de ajustes sólo toma la puerta.
 */
export const PREFS_COPY = {
  title: "Preferencias de notificaciones",
  subtitle: "Elegí de qué te avisamos y por dónde. Podés cambiarlo cuando quieras.",
  back: "Volver a Ajustes",

  channels: {
    legend: "Cómo te avisamos",
    inApp: "En la app",
    inAppHint: "El aviso aparece en tu bandeja.",
    email: "Por correo",
    emailHint: "Te llega un mail cuando pasa.",
    push: "En el teléfono",
    pushSoon: "Muy pronto",
    pushHint: "Estamos terminando de configurar los avisos al teléfono.",
  },

  frequency: {
    label: "Cuándo",
    all: "Todas",
    important: "Sólo las importantes",
    digest: "Un resumen por correo",
    off: "Ninguna",
    digestNote:
      "Los avisos siguen apareciendo en la app; el resumen por correo llega cuando lo terminemos de configurar.",
  },

  alwaysOn: {
    badge: "Siempre activas",
    /** Sin interruptor y con la razón: un switch deshabilitado se lee como un bug. */
    reason:
      "Estos avisos no se pueden apagar: son los que protegen tu cuenta y tu plata.",
  },

  saved: "Guardado",
  error: "No pudimos guardar el cambio. Probá de nuevo.",

  /** Fila de acceso desde /ajustes. */
  row: {
    title: "Preferencias de notificaciones",
    description: "De qué te avisamos y por dónde.",
  },
} as const;
