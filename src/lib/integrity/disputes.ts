import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * =============================================================================
 * DISPUTAS DE CONTENIDO — tipos, contrato y copy compartido
 * =============================================================================
 *
 * Una disputa es lo que `content_matches` NO es: una AFIRMACIÓN HUMANA. El
 * pipeline mide distancias entre archivos; acá alguien dice "eso es mío", y eso
 * puede ser falso. Todo el copy de este módulo está escrito sobre esa
 * diferencia, igual que `declarations.ts`: nada de lo que decimos puede leerse
 * como que la plataforma verificó algo.
 *
 * TRES COSAS QUE EL COPY NO PUEDE SUAVIZAR (y por eso viven acá, en un solo
 * lugar, y no sueltas en cada JSX):
 *
 *   1. Abrir un reclamo NO baja el contenido. Lo congela (`en_investigacion`),
 *      que es sacarlo del circuito comercial, no borrarlo. Si abrir un reclamo
 *      tuviera efecto punitivo automático, tres reclamos falsos alcanzarían para
 *      hacer desaparecer el contenido de un competidor — es la DECISIÓN DE
 *      DISEÑO 1 de la migración 0086, escrita en la UI.
 *   2. Lo revisa una PERSONA. No hay resolución automática y no la va a haber.
 *   3. La huella digital no prueba autoría. Detecta que dos archivos son iguales
 *      o parecidos; de ahí a saber de quién es hay un salto que sólo lo da la
 *      evidencia.
 *
 * ⚠️ ESCAPE DE TIPOS — `database.types.ts` está generado hasta la 0076 y la
 * 0086 (que crea `content_disputes` y la RPC `abrir_disputa_de_contenido`) no
 * está reflejada ahí. Mientras tanto, esas dos superficies se tocan a través de
 * `untypedSupabase()` y de las interfaces de fila declaradas acá abajo, que son
 * transcripción literal de la migración. Cuando se regenere el archivo de tipos,
 * el escape se borra y las interfaces se reemplazan por `Tables<"content_disputes">`.
 */

/* ========================================================================== */
/* Dominio — espeja los CHECK de la migración 0086                            */
/* ========================================================================== */

/** `content_disputes.claim_kind` — CHECK de 0086. */
export const CLAIM_KINDS = [
  "autoria",
  "licencia",
  "marca",
  "suplantacion",
  "otro",
] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

/** `content_disputes.status` — CHECK de 0086. */
export const DISPUTE_STATUSES = [
  "abierta",
  "en_revision",
  "resuelta_a_favor_reclamante",
  "resuelta_a_favor_uploader",
  "descartada",
  "apelada",
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/**
 * Los estados VIVOS: los mismos tres del índice único parcial
 * `content_disputes_una_viva_por_reclamante_idx`. Si esta lista se desincroniza
 * de la migración, la app deja pasar un reclamo que la base rechaza con un
 * 23505 crudo — por eso se declara una sola vez.
 */
export const LIVE_DISPUTE_STATUSES = ["abierta", "en_revision", "apelada"] as const;

/** Tope de `evidence_urls` — CHECK `array_length(evidence_urls, 1) <= 10`. */
export const MAX_EVIDENCE_URLS = 10;

/** La base no acota `claim_text`; la app sí, para que la cola sea legible. */
export const CLAIM_TEXT_MIN = 20;
export const CLAIM_TEXT_MAX = 2000;

/** Tope de cada link. Espeja el criterio de `license_url` en declarations.ts. */
export const EVIDENCE_URL_MAX_LENGTH = 500;

/** Nota de resolución del staff — `content_disputes.resolution_note`. */
export const RESOLUTION_NOTE_MAX = 1000;

/* ========================================================================== */
/* Filas — transcripción literal de la 0086 (ver el escape de tipos arriba)    */
/* ========================================================================== */

export interface ContentDisputeRow {
  id: string;
  tenant_id: string;
  asset_id: string;
  claimant_id: string;
  respondent_id: string | null;
  claim_kind: string;
  claim_text: string;
  evidence_urls: string[] | null;
  status: string;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Cliente sin el genérico `Database`, para las superficies de la 0086 que
 * todavía no están en `database.types.ts`. Es un cast acotado y con fecha de
 * vencimiento, NO una puerta general: cada uso va acompañado de la interfaz de
 * fila que corresponde, así que el tipado se pierde en el borde y se recupera
 * en la línea siguiente.
 */
export function untypedSupabase(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

/* ========================================================================== */
/* Validación de evidencia                                                    */
/* ========================================================================== */

/**
 * Un link de evidencia sólo puede ser http o https.
 *
 * NO alcanza con `z.url()`: en zod v4 `z.url()` acepta `javascript:alert(1)` y
 * `data:text/html,…` porque son URLs perfectamente válidas según la WHATWG.
 * Esos strings terminan en un `href` del panel de moderación, o sea en un click
 * de alguien con permisos de staff — el peor lugar posible para un esquema
 * ejecutable. Por eso se valida el PROTOCOLO, que es lo que realmente importa,
 * y no la forma.
 */
export function isSafeHttpUrl(raw: string): boolean {
  const value = raw.trim();
  if (!value || value.length > EVIDENCE_URL_MAX_LENGTH) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    // Un string que ni siquiera parsea como URL (un path relativo, texto suelto)
    // no es un link de evidencia. Se rechaza con nombre, no en silencio: quien
    // llama arma el mensaje con la línea exacta que falló.
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

export type EvidenceParseResult =
  | { ok: true; urls: string[] }
  | { ok: false; reason: "invalid"; offending: string }
  | { ok: false; reason: "too_many"; count: number };

/**
 * Convierte el textarea de evidencia (un link por línea) en el `text[]` que
 * espera la RPC. Deduplica preservando el orden: pegar dos veces el mismo link
 * no es más evidencia, y gasta uno de los 10 cupos del CHECK.
 */
export function parseEvidenceUrls(raw: string | null | undefined): EvidenceParseResult {
  const lines = (raw ?? "")
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const seen = new Set<string>();
  const urls: string[] = [];
  for (const line of lines) {
    if (!isSafeHttpUrl(line)) return { ok: false, reason: "invalid", offending: line };
    if (seen.has(line)) continue;
    seen.add(line);
    urls.push(line);
  }

  if (urls.length > MAX_EVIDENCE_URLS) {
    return { ok: false, reason: "too_many", count: urls.length };
  }
  return { ok: true, urls };
}

/* ========================================================================== */
/* Esquemas del borde                                                         */
/* ========================================================================== */

/**
 * Lo que llega del formulario de reclamo. `evidence` viaja como texto crudo y se
 * parsea aparte (`parseEvidenceUrls`) para poder nombrar la línea que falló en
 * vez de devolver "campo inválido".
 */
export const claimFormSchema = z.object({
  assetId: z.uuid(),
  claimKind: z.enum(CLAIM_KINDS),
  claimText: z.string().trim().min(CLAIM_TEXT_MIN).max(CLAIM_TEXT_MAX),
  evidence: z.string().max(EVIDENCE_URL_MAX_LENGTH * (MAX_EVIDENCE_URLS + 2)).nullish(),
});

/**
 * La confirmación explícita del reclamo. Queda FUERA del esquema a propósito:
 * un checkbox sin tildar viaja como campo AUSENTE, y mezclarlo con el resto
 * haría que "no lo marqué" y "el formulario llegó roto" den el mismo error.
 * Mismo criterio que `declarationSchema` con `originalityDeclared`: nunca
 * `z.coerce.boolean()`, que convierte la cadena "false" en `true`.
 */
const CONFIRM_TRUTHY = new Set(["true", "on", "1", "si", "sí", "yes"]);

export function isClaimConfirmed(raw: FormDataEntryValue | null | undefined): boolean {
  return typeof raw === "string" && CONFIRM_TRUTHY.has(raw.trim().toLowerCase());
}

export const resolutionSchema = z.object({
  disputeId: z.uuid(),
  decision: z.enum(["revisar", "a_favor_reclamante", "a_favor_uploader", "descartar"]),
  note: z.string().trim().max(RESOLUTION_NOTE_MAX).optional(),
});

export type DisputeDecision = z.infer<typeof resolutionSchema>["decision"];

/* ========================================================================== */
/* Presentación                                                               */
/* ========================================================================== */

export interface ClaimKindOption {
  value: ClaimKind;
  /** Primera persona, como habla quien reclama. */
  label: string;
  hint: string;
}

/**
 * El orden no es alfabético: primero el caso abrumadoramente más frecuente
 * (autoría), último "otra cosa", que tiene que ser una salida y no un cajón.
 */
export const CLAIM_KIND_OPTIONS: readonly ClaimKindOption[] = [
  { value: "autoria", label: "Lo hice yo", hint: "Es material mío y lo publicó otra persona" },
  {
    value: "licencia",
    label: "La licencia no cubre este uso",
    hint: "Tiene permiso para algo, pero no para lo que está haciendo",
  },
  { value: "marca", label: "Usa mi marca", hint: "Mi nombre comercial, mi logo o mi marca registrada" },
  {
    value: "suplantacion",
    label: "Se hace pasar por mí",
    hint: "Presenta mi trabajo o mi identidad como si fueran suyos",
  },
  { value: "otro", label: "Es otra cosa", hint: "Contámelo abajo con tus palabras" },
] as const;

export function claimKindLabel(kind: string | null | undefined): string {
  return CLAIM_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? "Sin clasificar";
}

export interface DisputeStatusMeta {
  label: string;
  /** Variante de `<Badge>`. Nunca sólo color: la etiqueta siempre dice qué es. */
  badge: "neutral" | "warning" | "info" | "success" | "danger";
  /** Qué significa para quien lo lee. Va debajo del badge, no en un tooltip. */
  meaning: string;
}

export const DISPUTE_STATUS_META: Record<DisputeStatus, DisputeStatusMeta> = {
  abierta: {
    label: "Abierta",
    badge: "warning",
    meaning: "Entró a la cola y todavía nadie del equipo la tomó.",
  },
  en_revision: {
    label: "En revisión",
    badge: "info",
    meaning: "Alguien del equipo la está mirando.",
  },
  resuelta_a_favor_reclamante: {
    label: "A favor de quien reclamó",
    badge: "danger",
    meaning: "Se le dio la razón al reclamo: el archivo quedó bloqueado.",
  },
  resuelta_a_favor_uploader: {
    label: "A favor de quien lo subió",
    badge: "success",
    meaning: "Se miró el caso y quien lo subió tenía razón. El archivo volvió a estar disponible.",
  },
  descartada: {
    label: "Descartada",
    badge: "neutral",
    meaning: "El reclamo no tenía sustancia. No es lo mismo que darle la razón a la otra parte.",
  },
  apelada: {
    label: "Apelada",
    badge: "warning",
    meaning: "Se pidió revisar de nuevo una decisión ya tomada.",
  },
};

export function disputeStatusMeta(status: string | null | undefined): DisputeStatusMeta {
  if (status && status in DISPUTE_STATUS_META) {
    return DISPUTE_STATUS_META[status as DisputeStatus];
  }
  return { label: "Sin estado", badge: "neutral", meaning: "Estado desconocido." };
}

/** Estado del asset, para que el panel diga en qué situación quedó el archivo. */
export const ASSET_REVIEW_LABELS: Record<string, string> = {
  pendiente: "Pendiente de revisión",
  aprobado: "Aprobado",
  bloqueado: "Bloqueado",
  en_investigacion: "En pausa por esta revisión",
  apto_comercial: "Habilitado para uso comercial",
};

export function assetReviewLabel(status: string | null | undefined): string {
  return ASSET_REVIEW_LABELS[status ?? ""] ?? "Sin estado";
}

/* ========================================================================== */
/* Tabla de decisiones del staff                                              */
/* ========================================================================== */

export interface DisputeDecisionSpec {
  /** A qué estado va la DISPUTA. Espeja el CHECK de `content_disputes.status`. */
  disputeStatus: DisputeStatus;
  /**
   * A qué estado va el ASSET, o null si la decisión no lo mueve.
   *
   * Ojo con la asimetría, que es deliberada: bloquear se aplica siempre, pero
   * devolver a `aprobado` sólo se aplica si el archivo sigue congelado por esta
   * revisión (`restoreOnlyFromFrozen`). Un archivo que un moderador bloqueó por
   * otro motivo NO se desbloquea porque un reclamo distinto se haya caído.
   */
  assetStatus: "bloqueado" | "aprobado" | null;
  restoreOnlyFromFrozen: boolean;
  /** Bajar la publicación que usa el archivo. Sólo cuando se bloquea. */
  takesDownSubject: boolean;
  /** Resolver sin dejar dicho por qué no es resolver: es archivar. */
  requiresNote: boolean;
  /** Sufijo de `logAdminAction` — `dispute.<action>`. */
  auditAction: string;
  label: string;
  hint: string;
}

export const DISPUTE_DECISIONS: Record<DisputeDecision, DisputeDecisionSpec> = {
  revisar: {
    disputeStatus: "en_revision",
    assetStatus: null,
    restoreOnlyFromFrozen: false,
    takesDownSubject: false,
    requiresNote: false,
    auditAction: "revisar",
    label: "Tomar el caso",
    hint: "Lo marca como en revisión. No cambia nada del archivo.",
  },
  a_favor_reclamante: {
    disputeStatus: "resuelta_a_favor_reclamante",
    assetStatus: "bloqueado",
    restoreOnlyFromFrozen: false,
    takesDownSubject: true,
    requiresNote: true,
    auditAction: "a_favor_reclamante",
    label: "A favor de quien reclamó",
    hint: "Bloquea el archivo y da de baja la publicación que lo usa.",
  },
  a_favor_uploader: {
    disputeStatus: "resuelta_a_favor_uploader",
    assetStatus: "aprobado",
    restoreOnlyFromFrozen: true,
    takesDownSubject: false,
    requiresNote: true,
    auditAction: "a_favor_uploader",
    label: "A favor de quien lo subió",
    hint: "Se miró el caso y tenía razón. El archivo sale de la pausa.",
  },
  descartar: {
    disputeStatus: "descartada",
    assetStatus: "aprobado",
    restoreOnlyFromFrozen: true,
    takesDownSubject: false,
    requiresNote: true,
    auditAction: "descartar",
    label: "Descartar el reclamo",
    hint: "El reclamo no tenía sustancia. Distinto de darle la razón a la otra parte.",
  },
};

/* ========================================================================== */
/* Copy — lado usuario                                                        */
/* ========================================================================== */

export const RECLAMO_COPY = {
  back: "Volver",
  title: "Reclamar este contenido",
  lead: "Si esto es tuyo y lo publicó otra persona, contanos. Abrís un caso que revisa alguien del equipo.",

  /** Los tres puntos que no se pueden suavizar. Ver la cabecera del módulo. */
  howTitle: "Antes de empezar, tres cosas claras",
  how: [
    {
      title: "Abrir un reclamo no baja el contenido",
      body: "Mientras lo revisamos queda en pausa: nadie puede venderlo ni licenciarlo. Pero sigue publicado hasta que haya una decisión, porque si reclamar bastara para hacer desaparecer algo, sería un arma.",
    },
    {
      title: "Lo revisa una persona",
      body: "Nadie automático resuelve esto. Miramos lo que nos cuentes, lo que aporte la otra parte, y recién ahí se decide.",
    },
    {
      title: "Nuestra huella digital no prueba quién es el autor",
      body: "Sirve para detectar que dos archivos son iguales o parecidos. De ahí a saber de quién es hay un salto que sólo lo da la evidencia que traigas vos.",
    },
  ],

  kindLegend: "¿De qué se trata tu reclamo?",
  claimTextLabel: "Contanos por qué es tuyo",
  claimTextHelp:
    "Cuanto más concreto, más rápido se resuelve: cuándo lo hiciste, dónde lo publicaste antes, qué te identifica en el material.",
  claimTextPlaceholder:
    "Ej.: la foto la saqué yo en marzo de 2026 y la publiqué en mi perfil el 12 de abril. Tengo el original sin recortar.",

  evidenceLabel: "Links que respalden lo que decís",
  evidenceHelp: `Un link por línea, hasta ${MAX_EVIDENCE_URLS}. Sirve un registro de obra, una publicación anterior con fecha, un contrato. Sólo direcciones que empiecen con http o https — acá no se pueden adjuntar archivos.`,
  evidencePlaceholder: "https://",

  /**
   * La confirmación es un checkbox y no un párrafo por el mismo motivo que la
   * declaración de originalidad no es un modal (ver declarations.ts): una
   * afirmación que la persona tiene que marcar se lee; una que sólo está
   * escrita al lado del botón, no. Y se valida en el servidor, así que no es
   * decorativa.
   */
  confirmLabel: "Confirmo que lo que cuento es verdad y que tengo derecho sobre este contenido",
  consequenceTitle: "Un reclamo falso no es gratis",
  consequenceBody:
    "Tu reclamo queda registrado con tu nombre, igual que la decisión del equipo. Reclamar contenido que no es tuyo —y más si se repite— es motivo para limitar la cuenta.",

  submit: "Abrir el reclamo",

  successTitle: "Tu reclamo quedó abierto",
  successBody:
    "El contenido quedó en pausa y el caso ya está en la cola del equipo. Volvé a esta página cuando quieras para ver en qué estado está.",

  ownTitle: "Este contenido ya es tuyo",
  ownBody:
    "Lo subiste vos, así que no hay nada que reclamar. Si alguien más lo está usando en otra publicación, buscá esa publicación y reclamá desde ahí.",

  existingTitle: "Ya tenés un reclamo abierto sobre esto",
  existingBody:
    "Está en la cola del equipo. Abrir otro no lo acelera. Si aparece evidencia nueva, guardala: quien revise el caso puede pedírtela.",
  existingOpened: (fecha: string) => `Lo abriste el ${fecha}.`,

  reference: (short: string) => `Referencia del caso: contenido ${short}`,
} as const;

/** Errores de la action del reclamo. Cálidos, y siempre con salida. */
export const RECLAMO_ERRORS = {
  invalidKind: "Elegí de qué se trata tu reclamo — nos dice a qué cola va.",
  invalidText: `Contanos un poco más. Con dos líneas alcanza, pero necesitamos entender por qué es tuyo (mínimo ${CLAIM_TEXT_MIN} caracteres).`,
  textTooLong: `Se pasó de largo. Resumilo en ${CLAIM_TEXT_MAX} caracteres — lo importante entra.`,
  invalidEvidence: (offending: string) =>
    `No podemos usar este link: “${offending}”. Pegá la dirección completa, empezando con https://`,
  tooManyEvidence: `Hasta ${MAX_EVIDENCE_URLS} links. Elegí los que mejor respalden lo que contás.`,
  notConfirmed: "Marcá la confirmación antes de enviar: es lo que hace que el reclamo tenga peso.",
  unauthenticated: "Necesitás una cuenta para reclamar contenido. Entrá y volvé a intentarlo.",
  own: "Este contenido lo subiste vos, así que no hay nada que reclamar.",
  notFound:
    "No encontramos ese contenido en tu comunidad. Revisá que el link sea de esta app y esté completo.",
  duplicate:
    "Ya tenés un reclamo abierto sobre este contenido. Está en la cola del equipo — mandar otro no lo acelera.",
  tooMany:
    "Abriste varios reclamos hoy. Para que el equipo pueda revisarlos bien, esperá hasta mañana para abrir otro.",
  generic:
    "No pudimos abrir el reclamo en este momento — no es tu culpa. Probá de nuevo en unos minutos.",
} as const;

/* ========================================================================== */
/* Copy — panel del staff                                                     */
/* ========================================================================== */

export const DISPUTAS_ADMIN_COPY = {
  title: "Reclamos de contenido",
  intro:
    "Cuando una persona dice que un contenido es suyo, el caso aterriza acá. El archivo queda en pausa hasta que alguien decida.",
  /**
   * El aviso hermano del de `alert-card.tsx`, invertido: allá el riesgo es leer
   * una medición como una prueba; acá es leer una acusación como un hecho.
   */
  disclaimer:
    "Un reclamo es una afirmación, no una medición. A diferencia de una coincidencia de huella, acá no hay nada verificado: hay alguien diciendo algo, y alguien del otro lado que puede tener razón.",
  backToIntegrity: "Volver a integridad de contenido",
  filterLabel: "Filtrar reclamos por estado",
  openLabel: (n: number) => (n === 1 ? "1 reclamo" : `${n} reclamos`),

  claimant: "Reclama",
  respondent: "Subió el contenido",
  deletedAccount: "una cuenta borrada",
  claimTextTitle: "Lo que dice quien reclama",
  evidenceTitle: "Evidencia que aportó",
  evidenceEmpty: "No aportó links. No lo invalida, pero deja el caso apoyado sólo en el relato.",
  declarationTitle: "Lo que declaró quien lo subió",
  declarationDisclaimer: "Es una afirmación suya. La plataforma no la verificó.",
  declaredOriginal: "Declaró que es material propio o con permiso.",
  noDeclaration: "No declaró originalidad.",
  assetTitle: "El archivo",
  resolutionTitle: "Cómo se resolvió",
  resolvedAt: "Resuelto el",
  noteLabel: "Nota de la resolución",
  noteHelp: "Obligatoria al resolver. Es lo que las dos partes van a leer si preguntan por qué.",
  notePlaceholder: "Ej.: el reclamante aportó el original con metadatos de 2024; el uploader no respondió.",

  emptyAllTitle: "Sin reclamos",
  emptyAllMessage:
    "Nadie reclamó contenido en esta comunidad. Cuando alguien lo haga, el caso aparece acá y el archivo queda en pausa solo.",
  emptyOpenTitle: "Nada pendiente",
  emptyOpenMessage:
    "No hay reclamos esperando decisión. Los ya resueltos siguen disponibles en el filtro “Resueltos”.",
  emptyClosedTitle: "Todavía no se resolvió ninguno",
  emptyClosedMessage:
    "Acá van a quedar los casos cerrados, con su nota y quién los decidió. Es el rastro que vas a necesitar si alguien pregunta.",
} as const;

export const DISPUTAS_ADMIN_ERRORS = {
  notStaff: "Tu sesión no tiene permisos de moderación. Entrá de nuevo e intentá otra vez.",
  invalid: "No pudimos leer la decisión — recargá la página e intentá de nuevo.",
  noteRequired: "Escribí una nota antes de resolver: es lo que las dos partes van a leer.",
  alreadyResolved: "Este reclamo ya lo resolvió otra persona del equipo — la lista se actualizó.",
  generic: "No pudimos guardar la resolución — no es tu culpa. Probá de nuevo en un momento.",
} as const;

/** Filtros de la cola. `abiertos` es el default: es el trabajo pendiente. */
export const DISPUTE_FILTERS = [
  { id: "abiertos", label: "Abiertos", statuses: [...LIVE_DISPUTE_STATUSES] },
  { id: "resueltos", label: "Resueltos", statuses: [
    "resuelta_a_favor_reclamante",
    "resuelta_a_favor_uploader",
    "descartada",
  ] },
  { id: "todos", label: "Todos", statuses: [...DISPUTE_STATUSES] },
] as const;

export type DisputeFilterId = (typeof DISPUTE_FILTERS)[number]["id"];

export function resolveDisputeFilter(raw: string | string[] | undefined): DisputeFilterId {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const match = DISPUTE_FILTERS.find((filter) => filter.id === value);
  return match?.id ?? "abiertos";
}

export function disputeFilterStatuses(id: DisputeFilterId): string[] {
  const match = DISPUTE_FILTERS.find((filter) => filter.id === id);
  return [...(match?.statuses ?? LIVE_DISPUTE_STATUSES)];
}
