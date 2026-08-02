/**
 * REGISTRO DE TRAZADORES — la única fuente de verdad sobre qué guarda la app
 * en el dispositivo de la persona y qué manda a terceros.
 *
 * POR QUÉ ESTO ES UN MÓDULO DE CÓDIGO Y NO UN TEXTO EN LA PÁGINA LEGAL
 * -------------------------------------------------------------------
 * La divergencia entre "lo que dice la política" y "lo que hace el código" es
 * el defecto clásico de cumplimiento: alguien agrega una cookie y nadie
 * actualiza el documento. Acá la tabla de la política de cookies se RENDERIZA
 * desde este archivo, y el gate de consentimiento LEE este archivo. No pueden
 * separarse: son el mismo dato. Agregar un trazador sin declararlo acá lo deja
 * fuera del gate; declararlo acá lo publica automáticamente en /legal/cookies.
 *
 * CÓMO SE CLASIFICA (criterio, no default)
 * ----------------------------------------
 * El ePrivacy europeo (art. 5.3) exige consentimiento para guardar o leer algo
 * en el equipo del usuario SALVO que sea estrictamente necesario para el
 * servicio que la persona pidió. Las guías del EDPB y de la CNIL eximen
 * explícitamente: autenticación, sesión, seguridad, carrito, y la
 * PERSONALIZACIÓN DE INTERFAZ elegida por la persona (idioma, tema).
 *
 * Por eso hay tres políticas y no dos:
 *   · `siempre`            → sin esto la app no funciona. No se puede apagar.
 *   · `activa-por-defecto` → exenta de consentimiento (la elige la persona con
 *                            un clic, o es puramente cosmética, y NUNCA sale
 *                            del teléfono), pero se declara y se puede apagar.
 *   · `requiere-opt-in`    → apagada hasta que la persona diga que sí. Todo lo
 *                            que perfile, mida o mande datos a un tercero con
 *                            fines de análisis o publicidad entra acá.
 */

export const CONSENT_CATEGORIES = [
  "necesarias",
  "preferencias",
  "analitica",
  "marketing",
] as const;

export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];

export type ConsentPolicy = "siempre" | "activa-por-defecto" | "requiere-opt-in";

/** Categorías que la persona puede apagar (las necesarias no se negocian). */
export type GatedCategory = Exclude<ConsentCategory, "necesarias">;

export interface CategoryMeta {
  id: ConsentCategory;
  policy: ConsentPolicy;
  /** Título de cara al usuario. Sin jerga. */
  label: string;
  /** Una línea que explique el trato, no la ley. */
  summary: string;
}

export const CATEGORY_META: Readonly<Record<ConsentCategory, CategoryMeta>> = {
  necesarias: {
    id: "necesarias",
    policy: "siempre",
    label: "Imprescindibles",
    summary:
      "Mantienen tu sesión abierta y la app en pie. Sin esto no podrías entrar a tu cuenta.",
  },
  preferencias: {
    id: "preferencias",
    policy: "activa-por-defecto",
    label: "Tus preferencias",
    summary:
      "Recuerdan cómo te gusta usar la app. Se quedan en este teléfono y no viajan a ningún lado.",
  },
  analitica: {
    id: "analitica",
    policy: "requiere-opt-in",
    label: "Medición de uso",
    summary: "Servirían para contar cómo se usa la app. Hoy no usamos ninguna.",
  },
  marketing: {
    id: "marketing",
    policy: "requiere-opt-in",
    label: "Publicidad",
    summary: "Servirían para mostrarte anuncios. Hoy no usamos ninguna, y no está en los planes.",
  },
};

export type TrackerKind =
  | "cookie"
  | "localStorage"
  | "sessionStorage"
  | "cache"
  | "servicio";

export interface TrackerEntry {
  /** Nombre exacto tal como aparece en el navegador. */
  name: string;
  kind: TrackerKind;
  category: ConsentCategory;
  /** Quién lo pone. "Comunidad Latina" = propia. */
  owner: string;
  firstParty: boolean;
  /** Para qué sirve, en el idioma de la persona que lo lee. */
  purpose: string;
  duration: string;
  /**
   * Si HOY no llega a existir, por qué. Un trazador dormido se declara igual
   * (es honesto: la función puede encenderse), pero NO dispara el banner —
   * pedir permiso para algo que no ocurre entrena a la gente a aceptar sin
   * leer, que es justo lo que arruina el consentimiento.
   */
  dormant?: string;
}

/**
 * INVENTARIO REAL — verificado en vivo el 2026-08-02 contra `npm run dev`:
 * `document.cookie`, `localStorage` y `sessionStorage` leídos con y sin sesión,
 * y el panel de red confirmando que NINGUNA petición de la carga sale del
 * propio origen.
 *
 * Lo que el navegador mostró y NO está en esta tabla: `__next_debug_channel:*`
 * en sessionStorage, que es andamiaje del devtools de Turbopack y no existe en
 * la build de producción.
 */
export const TRACKERS: readonly TrackerEntry[] = [
  // ── Imprescindibles ────────────────────────────────────────────────────
  {
    name: "sb-<proyecto>-auth-token",
    kind: "cookie",
    category: "necesarias",
    owner: "Comunidad Latina (con Supabase)",
    firstParty: true,
    purpose:
      "Te mantiene con la sesión abierta para que no tengas que escribir tu contraseña en cada pantalla.",
    duration: "1 hora, y se renueva sola mientras uses la app",
  },
  {
    name: "cl-tenant",
    kind: "cookie",
    category: "necesarias",
    owner: "Comunidad Latina",
    firstParty: true,
    purpose: "Recuerda en qué comunidad estás para mostrarte el contenido correcto.",
    duration: "30 días",
  },
  {
    name: "cl-asst",
    kind: "cookie",
    category: "necesarias",
    owner: "Comunidad Latina",
    firstParty: true,
    purpose:
      "Lleva la cuenta de las preguntas de cortesía al asistente cuando todavía no tenés cuenta.",
    duration: "24 horas",
    dormant: "El asistente está apagado: la app responde 503 y la cookie no llega a crearse.",
  },
  {
    name: "cl-identity-session",
    kind: "cookie",
    category: "necesarias",
    owner: "Comunidad Latina (con Stripe Identity)",
    firstParty: true,
    purpose:
      "Guarda el número de trámite mientras verificás tu identidad, para poder mostrarte el resultado al volver. No contiene tu documento.",
    duration: "1 hora",
    dormant: "La verificación de identidad todavía no está habilitada.",
  },
  {
    name: "supabase-storage",
    kind: "cache",
    category: "necesarias",
    owner: "Comunidad Latina",
    firstParty: true,
    purpose:
      "Guarda copias de las fotos que ya viste para que la app cargue rápido y funcione con poca señal.",
    duration: "Hasta que se libere espacio o borres los datos del sitio",
  },
  {
    name: "cl-consent",
    kind: "localStorage",
    category: "necesarias",
    owner: "Comunidad Latina",
    firstParty: true,
    purpose:
      "Guarda tu decisión sobre esta misma pantalla —qué aceptaste y cuándo— para no volver a preguntarte.",
    duration: "12 meses",
  },
  {
    name: "cl-splashed",
    kind: "sessionStorage",
    category: "necesarias",
    owner: "Comunidad Latina",
    firstParty: true,
    purpose: "Evita repetir la animación de bienvenida en cada pantalla que abrís.",
    duration: "Se borra al cerrar la pestaña",
  },

  // ── Preferencias (exentas: las elegís vos y no salen del teléfono) ──────
  {
    name: "cl-theme",
    kind: "localStorage",
    category: "preferencias",
    owner: "Comunidad Latina",
    firstParty: true,
    purpose: "Recuerda si elegiste el modo claro o el oscuro.",
    duration: "Hasta que la borres",
  },
  {
    name: "cl:buscar:historial:…",
    kind: "localStorage",
    category: "preferencias",
    owner: "Comunidad Latina",
    firstParty: true,
    purpose:
      "Guarda tus últimas 8 búsquedas para que no tengas que reescribirlas. Cada persona tiene la suya y nunca sale de este teléfono.",
    duration: "Hasta que la borres",
  },
  {
    name: "cl-guias-offline",
    kind: "localStorage",
    category: "preferencias",
    owner: "Comunidad Latina",
    firstParty: true,
    purpose: "Guarda las guías que marcaste para leer sin conexión.",
    duration: "Hasta que la borres",
  },
  {
    name: "cl-pwa-visits · cl-pwa-install-dismissed · cl-pwa-installed",
    kind: "localStorage",
    category: "preferencias",
    owner: "Comunidad Latina",
    firstParty: true,
    purpose:
      "Recuerdan si ya te ofrecimos instalar la app y si dijiste que no, para no repetírtelo.",
    duration: "Hasta que la borres",
  },
  {
    name: "cl-pwa-visit-counted",
    kind: "sessionStorage",
    category: "preferencias",
    owner: "Comunidad Latina",
    firstParty: true,
    purpose: "Evita contar dos veces la misma visita al ofrecerte instalar la app.",
    duration: "Se borra al cerrar la pestaña",
  },

  // ── Medición / publicidad ──────────────────────────────────────────────
  // Vacías A PROPÓSITO. Si algún día entra Google Analytics, Meta Pixel o
  // similar, su fila va acá y el banner aparece SOLO en ese momento.
];

/** Trazadores de una categoría, en el orden en que se declararon. */
export function trackersOf(category: ConsentCategory): readonly TrackerEntry[] {
  return TRACKERS.filter((t) => t.category === category);
}

/** Un trazador cuenta como "vivo" si no está marcado como dormido. */
export function isActive(tracker: TrackerEntry): boolean {
  return tracker.dormant === undefined;
}

/** Las categorías que la persona puede encender o apagar. */
export const GATED_CATEGORIES: readonly GatedCategory[] = CONSENT_CATEGORIES.filter(
  (c): c is GatedCategory => c !== "necesarias",
);

/** Categorías que exigen un "sí" explícito antes de activarse. */
export const OPT_IN_CATEGORIES: readonly GatedCategory[] = GATED_CATEGORIES.filter(
  (c) => CATEGORY_META[c].policy === "requiere-opt-in",
);

/**
 * Categorías de opt-in que HOY tienen al menos un trazador vivo.
 *
 * Este es el interruptor del banner, y por eso se deriva de datos en vez de
 * ser una constante: mientras devuelva una lista vacía, no hay nada que
 * consentir y mostrar un banner sería mentir. En cuanto alguien agregue una
 * fila de analítica o marketing a `TRACKERS`, el banner aparece solo.
 */
export function categoriesNeedingConsent(): readonly GatedCategory[] {
  return OPT_IN_CATEGORIES.filter((c) => trackersOf(c).some(isActive));
}

/**
 * Versión del inventario. SUBIRLA invalida el consentimiento guardado y vuelve
 * a preguntar — se sube cuando entra un trazador nuevo de opt-in o cambia el
 * propósito de uno existente, no por corregir una falta de ortografía.
 */
export const CONSENT_VERSION = 1;
