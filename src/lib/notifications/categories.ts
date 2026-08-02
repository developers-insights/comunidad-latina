/**
 * =============================================================================
 * NOTIFICACIONES — categorías, prioridad y el mapa kind → categoría
 * =============================================================================
 *
 * Fuente de verdad de la APP para los 13 valores que la base ya tiene con CHECK
 * (migración 0045). Si estos arrays y el CHECK se separan, la base gana y el
 * insert falla: por eso están escritos en el mismo orden y con los mismos
 * literales, y hay un test que los cuenta.
 *
 * NO lleva "server-only": lo consumen las pestañas y la pantalla de
 * preferencias, que son client components. Acá no hay secretos — son etiquetas.
 *
 * `kind` vs `category` (0045): `kind` es la etiqueta FINA del evento y la clave
 * de `dedupeUnread`; `category` es la agrupación GRUESA de la UI. Dos ejes. El
 * emisor manda las dos, y este archivo es el que traduce del primero al segundo
 * para que ningún call site quede sin categoría y se caiga al default.
 */

export const NOTIFICATION_CATEGORIES = [
  "social",
  "mensajes",
  "trabajos",
  "creator",
  "marketplace",
  "propiedades",
  "eventos",
  "negocios",
  "publicidad",
  "pagos",
  "seguridad",
  "cuenta",
  "plataforma",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export function isNotificationCategory(value: unknown): value is NotificationCategory {
  return (
    typeof value === "string" &&
    (NOTIFICATION_CATEGORIES as readonly string[]).includes(value)
  );
}

export const NOTIFICATION_PRIORITIES = ["low", "normal", "high", "critical"] as const;

export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

export function isNotificationPriority(value: unknown): value is NotificationPriority {
  return (
    typeof value === "string" &&
    (NOTIFICATION_PRIORITIES as readonly string[]).includes(value)
  );
}

/**
 * Las tres que NO se pueden silenciar. No es una decisión de UI: la impone el
 * CHECK `notification_prefs_critical_always_on` (0045). Acá vive para que la
 * pantalla no dibuje un interruptor que la base va a rechazar, y para que el
 * emisor ni siquiera consulte preferencias en estas categorías.
 */
export const ALWAYS_ON_CATEGORIES = ["seguridad", "pagos", "cuenta"] as const;

export type AlwaysOnCategory = (typeof ALWAYS_ON_CATEGORIES)[number];

export function isAlwaysOnCategory(
  category: NotificationCategory,
): category is AlwaysOnCategory {
  return (ALWAYS_ON_CATEGORIES as readonly string[]).includes(category);
}

/**
 * Pestañas visibles de entrada. El resto vive detrás de "Más" — son las
 * categorías de baja frecuencia, no las de baja importancia (seguridad y pagos
 * están ahí y aun así aparecen arriba de todo cuando son críticas).
 */
export const PRIMARY_TAB_CATEGORIES = [
  "social",
  "mensajes",
  "trabajos",
  "marketplace",
  "propiedades",
] as const satisfies readonly NotificationCategory[];

/**
 * Las que despliega "Más".
 *
 * DESVÍO CONSCIENTE de la spec: el feedback lista siete (Creator, Eventos,
 * Negocios, Publicidad, Pagos, Seguridad, Comunidad Latina) y se olvida de
 * `cuenta`. Dejarla afuera la volvía la única categoría sin pestaña: sus avisos
 * (verificación de identidad, estado de la cuenta) se verían en "Todas" y en
 * ningún otro lado. Se incluye.
 */
export const MORE_TAB_CATEGORIES = [
  "creator",
  "eventos",
  "negocios",
  "publicidad",
  "pagos",
  "seguridad",
  "cuenta",
  "plataforma",
] as const satisfies readonly NotificationCategory[];

/** Metadatos de presentación. `icon` es una CLAVE, no un componente: este
 *  módulo no importa React ni Phosphor (lo consumen tests en entorno node). */
export type CategoryMeta = {
  /** Etiqueta corta de la pestaña. */
  label: string;
  /** Una línea en /ajustes/notificaciones: qué cae en esta categoría. */
  description: string;
  icon: string;
};

export const CATEGORY_META: Record<NotificationCategory, CategoryMeta> = {
  social: {
    label: "Social",
    description: "Me gusta, comentarios, menciones y gente que te empieza a seguir.",
    icon: "social",
  },
  mensajes: {
    label: "Mensajes",
    description: "Conversaciones nuevas y solicitudes para contactarte.",
    icon: "mensajes",
  },
  trabajos: {
    // La CLAVE `trabajos` es un valor persistido (notifications.category y las
    // preferencias por categoría): no se toca. La etiqueta visible sí, porque
    // decía "Trabajos" mientras la navegación principal del módulo dice
    // "Empleos" — dos nombres para el mismo lugar.
    label: "Empleos",
    description: "Postulaciones a tus avisos y novedades de las tuyas.",
    icon: "trabajos",
  },
  creator: {
    label: "Colaboraciones",
    description: "Propuestas de marcas, entregas y acuerdos.",
    icon: "creator",
  },
  marketplace: {
    label: "Marketplace",
    description: "Tu tienda, tus productos y quién pregunta por ellos.",
    icon: "marketplace",
  },
  propiedades: {
    // Mismo caso que `trabajos`: la clave persistida se queda, la etiqueta pasa
    // a "Vivienda", que es como se llama el módulo en la navegación principal.
    label: "Vivienda",
    description: "Consultas por lo que publicaste y avisos de lo que seguís.",
    icon: "propiedades",
  },
  eventos: {
    label: "Eventos",
    description: "Recordatorios, cambios de fecha y entradas.",
    icon: "eventos",
  },
  negocios: {
    label: "Negocios",
    description: "Tu negocio, sus reseñas y su presencia en la comunidad.",
    icon: "negocios",
  },
  publicidad: {
    label: "Publicidad",
    description: "Cómo van tus impulsos y tus campañas.",
    icon: "publicidad",
  },
  pagos: {
    label: "Pagos",
    description: "Cobros, comprobantes y estado de tus suscripciones.",
    icon: "pagos",
  },
  seguridad: {
    label: "Seguridad",
    description: "Ingresos nuevos, cambios de contraseña y alertas de tu cuenta.",
    icon: "seguridad",
  },
  cuenta: {
    label: "Tu cuenta",
    description: "Verificación de identidad y estado de tu cuenta.",
    icon: "cuenta",
  },
  plataforma: {
    label: "Comunidad Latina",
    description: "Novedades y avisos del equipo.",
    icon: "plataforma",
  },
};

/**
 * kind → categoría.
 *
 * Los siete primeros son los emisores REALES del repo y espejan letra por letra
 * el backfill de 0045: si acá dijeran otra cosa, una notificación vieja y una
 * nueva del mismo evento caerían en pestañas distintas. Los que siguen son los
 * kinds que este frente habilita (seguidores) o que ya tienen nombre reservado
 * en el resto del sistema.
 *
 * Lo que NO esté acá cae en `social`. Eso es una red de seguridad, no un
 * destino: agregar un emisor sin agregar su kind lo manda a la pestaña
 * equivocada, y el test `categories.test.ts` existe para que se note.
 */
export const KIND_CATEGORY: Record<string, NotificationCategory> = {
  // Emisores existentes (0045)
  message: "mensajes",
  contact_request: "mensajes",
  job_application: "trabajos",
  job_application_update: "trabajos",
  job_application_sent: "trabajos",
  job_application_withdrawn: "trabajos",
  post_promotion: "publicidad",
  boost: "publicidad",
  identity: "cuenta",

  // Social
  follow: "social",
  reaction: "social",
  comment: "social",
  mention: "social",

  // Reservados por módulo
  creator_proposal: "creator",
  creator_deliverable: "creator",
  store_membership: "marketplace",
  listing_question: "propiedades",
  event_reminder: "eventos",
  business_review: "negocios",
  payment: "pagos",
  payment_failed: "pagos",
  security_alert: "seguridad",
  account_suspended: "seguridad",
  dispute: "seguridad",
  broadcast: "plataforma",
};

export function categoryForKind(kind: string): NotificationCategory {
  return KIND_CATEGORY[kind] ?? "social";
}

/**
 * kind → prioridad.
 *
 * Criterio: `high` es lo que pide una DECISIÓN de la persona (te postularon,
 * te contestaron una postulación, alguien quiere contactarte, te falta un paso
 * de verificación). `critical` es lo que afecta el acceso o la plata. Todo lo
 * demás es `normal` — inflar prioridades vacía de sentido el filtro
 * "Importantes", que es exactamente el problema que viene a resolver.
 */
export const KIND_PRIORITY: Record<string, NotificationPriority> = {
  contact_request: "high",
  job_application: "high",
  job_application_update: "high",
  identity: "high",
  creator_proposal: "high",
  listing_question: "high",
  payment_failed: "critical",
  security_alert: "critical",
  account_suspended: "critical",
  dispute: "critical",
};

export function priorityForKind(kind: string): NotificationPriority {
  return KIND_PRIORITY[kind] ?? "normal";
}

/** El filtro "Importantes" y `frequency = 'important'` miran lo mismo. */
export function isImportant(priority: NotificationPriority): boolean {
  return priority === "high" || priority === "critical";
}
