import {
  HELP_DIRECTIONS,
  HELP_REPLY_STATUSES,
  HELP_STATUSES,
  HELP_TOPICS,
  type HelpDirection,
  type HelpNotice,
  type HelpNoticeRow,
  type HelpReply,
  type HelpReplyRow,
  type HelpReplyStatus,
  type HelpStatus,
  type HelpTopic,
} from "./types";
import { timeAgo } from "@/lib/utils";

/**
 * =============================================================================
 * LÓGICA PURA DEL TABLÓN "PEDIR AYUDA" (migraciones 0120 + 0130)
 * =============================================================================
 *
 * Antes se llamaba `ayuda-mutua.ts`. El archivo cambió de nombre con el módulo:
 * el 2026-09-03 el cliente sacó los ofrecimientos («"necesito manos" para una
 * mudanza es responsabilidad legal de Comunidad Latina si alguien se lastima»)
 * y dejó un tablón donde la gente PIDE y otros le CONTESTAN.
 *
 * Sin React, sin Supabase, sin `server-only`: lo importan por igual el
 * formulario (cliente), las lecturas (servidor), las server actions y la cola
 * del panel. Se testea sin montar nada — ver `pedir-ayuda.test.ts`.
 *
 * Acá viven CUATRO cosas y ninguna es una copia de conveniencia:
 *
 *  1. LAS DOS MÁQUINAS DE ESTADOS —la del pedido y la de la respuesta—, espejo
 *     exacto de los triggers `app.community_help_notices_guard()` y
 *     `app.community_help_replies_guard()`. Existen del lado de la app para que
 *     la pantalla dibuje sólo los botones que van a funcionar. La base sigue
 *     siendo la que manda: si estas dos tablas se separan, el usuario ve un
 *     botón que la base rechaza — feo, pero seguro. Al revés (que la app permita
 *     algo que la base no controla) no puede pasar, porque la autorización no
 *     está acá.
 *
 *  2. EL DETECTOR DE DATOS DE CONTACTO, que corre SOBRE EL PEDIDO Y NO SOBRE LA
 *     RESPUESTA. La asimetría es deliberada y es la decisión de producto del
 *     módulo: el número que aparece en un pedido es EL TUYO (dato personal
 *     pegado a tu barrio y a tu necesidad — el padrón que §5.4 evita), y el que
 *     aparece en una respuesta es el de una oficina. Que alguien pueda pasar el
 *     teléfono del consulado ES el producto: es la historia que contó el cliente
 *     para pedir esta sección. Un detector sobre las respuestas bloquearía justo
 *     eso. Lo que cubre al vivo que contesta "llamame al mío" es el reporte y la
 *     moderación posterior, no un regex.
 *
 *  3. EL MAPEO FILA → VISTA, que descarta lo que no se puede mostrar con
 *     honestidad (tema o estado desconocidos), igual que `toCommunityResource`
 *     con las fichas sin fuente.
 *
 *  4. EL SANEADOR DE BÚSQUEDA, que convierte lo que alguien teclea en algo que
 *     se le puede pasar a PostgREST sin que se lleve puesta la consulta.
 * =============================================================================
 */

// ---------------------------------------------------------------------------
// Guardas de los valores cerrados
// ---------------------------------------------------------------------------

export function isHelpTopic(value: string | null | undefined): value is HelpTopic {
  if (!value) return false;
  return (HELP_TOPICS as readonly string[]).includes(value);
}

export function isHelpDirection(value: string | null | undefined): value is HelpDirection {
  if (!value) return false;
  return (HELP_DIRECTIONS as readonly string[]).includes(value);
}

export function isHelpStatus(value: string | null | undefined): value is HelpStatus {
  if (!value) return false;
  return (HELP_STATUSES as readonly string[]).includes(value);
}

export function isHelpReplyStatus(
  value: string | null | undefined,
): value is HelpReplyStatus {
  if (!value) return false;
  return (HELP_REPLY_STATUSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Máquina de estados del PEDIDO
// ---------------------------------------------------------------------------

/** Quién intenta mover el pedido. No es un rol: es de qué lado del mostrador está. */
export type HelpActor = "autor" | "staff";

/**
 * Transiciones permitidas, transcriptas del trigger re-creado por la 0130.
 *
 * Lo que NO está acá vale la pena leerlo:
 *  · El autor no tiene ninguna flecha hacia `approved` NI hacia `rejected`. Un
 *    pedido nace publicado; que su autor pudiera devolverlo a `approved` sería
 *    darle la vuelta a lo que el equipo ocultó.
 *  · De `archived` no sale ninguna flecha: un pedido resuelto se vuelve a
 *    escribir, no se resucita. Resucitarlo republicaría un texto que su autor
 *    decidió bajar (mismo criterio que `attrs.paused_reason` en la 0118).
 *  · El staff puede ir de `rejected` a `approved` porque un moderador se puede
 *    equivocar y arreglarlo no debería costarle a la persona volver a escribir
 *    todo.
 *  · `draft` y `pending` son LEGADO de la cola previa (0120): ya no se crean,
 *    pero las filas que quedaron se tienen que poder cerrar.
 */
const TRANSICIONES: Record<HelpActor, Partial<Record<HelpStatus, readonly HelpStatus[]>>> = {
  autor: {
    approved: ["archived"],
    draft: ["archived"],
    pending: ["draft", "archived"],
    rejected: ["archived"],
  },
  staff: {
    approved: ["rejected", "archived"],
    rejected: ["approved"],
    pending: ["approved", "rejected"],
  },
};

export function puedeTransicionar(
  desde: HelpStatus,
  hasta: HelpStatus,
  actor: HelpActor,
): boolean {
  if (desde === hasta) return false;
  return (TRANSICIONES[actor][desde] ?? []).includes(hasta);
}

/** Los estados a los que ESTE actor puede llevar el pedido desde donde está. */
export function transicionesPosibles(desde: HelpStatus, actor: HelpActor): HelpStatus[] {
  return [...(TRANSICIONES[actor][desde] ?? [])];
}

/**
 * Estados que cuentan para el cupo de 5 por persona (`HELP_MAX_OPEN`).
 *
 * Es "lo que todavía no se cerró". Incluye `approved` —al revés que en la
 * 0120— y ese cambio es load-bearing: en el flujo nuevo un pedido nace
 * publicado, así que si el cupo siguiera contando sólo borradores y pendientes
 * sería decorativo desde el primer día. Los dos legados se quedan porque
 * ocupan lugar igual.
 */
export const HELP_OPEN_STATUSES: readonly HelpStatus[] = ["draft", "pending", "approved"];

export function esPedidoAbierto(status: HelpStatus): boolean {
  return HELP_OPEN_STATUSES.includes(status);
}

/** El contenido de un pedido publicado no se edita — anti bait-and-switch. */
export function puedeEditarContenido(status: HelpStatus): boolean {
  return status === "draft";
}

// ---------------------------------------------------------------------------
// Máquina de estados de la RESPUESTA
// ---------------------------------------------------------------------------

/**
 * Mucho más chica que la del pedido, y a propósito: el autor sólo borra la
 * suya, el equipo sólo oculta y restaura. De `deleted` no sale nada — lo que
 * alguien borró no lo resucita el equipo.
 */
const TRANSICIONES_RESPUESTA: Record<
  HelpActor,
  Partial<Record<HelpReplyStatus, readonly HelpReplyStatus[]>>
> = {
  autor: { visible: ["deleted"] },
  staff: { visible: ["hidden"], hidden: ["visible"] },
};

export function puedeTransicionarRespuesta(
  desde: HelpReplyStatus,
  hasta: HelpReplyStatus,
  actor: HelpActor,
): boolean {
  if (desde === hasta) return false;
  return (TRANSICIONES_RESPUESTA[actor][desde] ?? []).includes(hasta);
}

// ---------------------------------------------------------------------------
// Detector de datos de contacto en el texto libre DEL PEDIDO
// ---------------------------------------------------------------------------

export type DatoDeContacto = "telefono" | "email" | "enlace";

/** Fechas escritas como 7/5/2026, 2026-08-26 o 26-08-26: NO son teléfonos. */
const FECHAS = /\b\d{1,4}[/-]\d{1,2}[/-]\d{1,4}\b/g;

/**
 * Caracteres que la gente mete ADENTRO de un teléfono y que no lo cortan.
 * El espacio está a propósito: "9 5 5 5 0 1 4 2" es el primer intento de
 * cualquiera que quiere esquivar un detector.
 */
const SEPARADORES_DE_NUMERO = new Set([
  " ", " ", "-", "‐", "‑", "‒", "–", "—",
  "(", ")", ".", "+", "/",
]);

/** Siete dígitos seguidos ya es un número local de EE. UU. */
const DIGITOS_DE_TELEFONO = 7;

const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

/**
 * Enlaces. Incluye los acortadores de mensajería (`wa.me`, `t.me`) porque son
 * el caso real: nadie pega un `https://` completo, pega "wa.me/1718…". Un
 * enlace a un grupo es un canal de contacto igual que un teléfono, y además se
 * lleva la conversación afuera de la app, donde no se puede reportar nada.
 */
const ENLACE = /(https?:\/\/|www\.|\b[a-z0-9][a-z0-9-]*\.(?:com|org|net|me|ly|gl|io|app|link|info)\b)/i;

function corridasDeDigitos(texto: string): number[] {
  const corridas: number[] = [];
  let actual = 0;
  for (const caracter of texto) {
    if (caracter >= "0" && caracter <= "9") {
      actual += 1;
      continue;
    }
    if (SEPARADORES_DE_NUMERO.has(caracter)) continue;
    if (actual > 0) corridas.push(actual);
    actual = 0;
  }
  if (actual > 0) corridas.push(actual);
  return corridas;
}

/**
 * ¿Este texto trae un dato de contacto? Devuelve cuál, o null.
 *
 * SÓLO SE LLAMA SOBRE EL TEXTO DE UN PEDIDO. Ver el punto 2 de la cabecera:
 * en una respuesta, un teléfono suele ser el de una oficina y publicarlo es el
 * producto.
 *
 * El orden importa: un email contiene un punto y una terminación tipo dominio,
 * así que si se preguntara primero por enlace, todo email se reportaría como
 * enlace y el mensaje de error diría lo que no es.
 *
 * Es DELIBERADAMENTE conservador con los falsos positivos —primero se sacan las
 * fechas, y hacen falta siete dígitos en una misma corrida—, porque el costo de
 * los dos errores no es el mismo: un falso positivo es una persona que reescribe
 * una frase con un mensaje que le explica por qué; un falso negativo es un
 * teléfono publicado para siempre.
 */
export function detectarDatoDeContacto(texto: string | null | undefined): DatoDeContacto | null {
  const valor = (texto ?? "").trim();
  if (!valor) return null;

  if (EMAIL.test(valor)) return "email";

  const sinFechas = valor.replace(FECHAS, " ");
  if (corridasDeDigitos(sinFechas).some((largo) => largo >= DIGITOS_DE_TELEFONO)) {
    return "telefono";
  }

  if (ENLACE.test(valor)) return "enlace";
  return null;
}

/** Lo mismo sobre varios campos: devuelve el primer problema que aparece. */
export function primerDatoDeContacto(
  ...textos: (string | null | undefined)[]
): DatoDeContacto | null {
  for (const texto of textos) {
    const encontrado = detectarDatoDeContacto(texto);
    if (encontrado) return encontrado;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Búsqueda
// ---------------------------------------------------------------------------

/**
 * Lo que alguien teclea en "Buscar" → un fragmento seguro para un `ilike`
 * dentro de un `.or(...)` de PostgREST.
 *
 * Dos capas, y las dos hacen falta:
 *
 *  1. LOS COMODINES DE LIKE. `%` y `_` sin escapar convierten "buscar" en
 *     "traer todo" (misma razón y misma técnica que `sanitizeAreaFilter`).
 *  2. LA GRAMÁTICA DE `.or()`. PostgREST separa las condiciones con COMAS y las
 *     agrupa con PARÉNTESIS: una coma en el texto de búsqueda parte la
 *     expresión en dos condiciones y el filtro pasa a decir cualquier cosa. Por
 *     eso `,`, `(`, `)`, `"` y `\` se van directamente en vez de escaparse —
 *     ninguno de los cinco aporta nada a una búsqueda de dos palabras, y
 *     sacarlos es una regla que se entiende de un vistazo.
 *
 * Devuelve "" cuando no queda nada útil: el caller NO debe filtrar en ese caso
 * (filtrar por "" traería todo y parecería que la búsqueda no anduvo).
 */
export function sanitizeSearchFilter(raw: string | null | undefined): string {
  const value = (raw ?? "")
    .trim()
    .slice(0, 60)
    .replace(/[(),"\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (value.length < 2) return "";
  return value.replace(/[%_]/g, (char) => `\\${char}`);
}

// ---------------------------------------------------------------------------
// Fila → vista
// ---------------------------------------------------------------------------

export interface HelpNoticeContext {
  /** Quién está mirando. null = sin sesión (no debería llegar: la RLS pide cuenta). */
  viewerId: string | null;
  /** `display_name` de los autores, ya resuelto por lote. */
  nombrePorAutor: ReadonlyMap<string, string | null>;
  /** Nombre de las fichas apuntadas, ya resuelto por lote. */
  nombrePorFicha: ReadonlyMap<string, string>;
  now?: Date;
}

/**
 * Fila cruda → pedido listo para render, o `null` si no se puede mostrar con
 * honestidad. Se descarta cuando el tema, la dirección o el estado no son de
 * los conocidos: una fila así iría a una sección sin título o pintaría un
 * estado que la pantalla no sabe dibujar.
 *
 * `reviewNote` sólo viaja hacia su AUTOR. La RLS ya hace que un tercero no
 * pueda leer la fila oculta, pero el staff sí puede: mostrarle el motivo de una
 * moderación a alguien que no es el destinatario no tiene por qué pasar por un
 * descuido de la pantalla.
 */
export function toHelpNotice(row: HelpNoticeRow, ctx: HelpNoticeContext): HelpNotice | null {
  if (!isHelpTopic(row.topic)) return null;
  if (!isHelpDirection(row.direction)) return null;
  if (!isHelpStatus(row.status)) return null;

  const title = row.title.trim();
  const body = row.body.trim();
  const areaLabel = row.area_label.trim();
  if (!title || !body || !areaLabel) return null;

  const isOwner = Boolean(ctx.viewerId && row.created_by === ctx.viewerId);
  const nombreFicha = row.resource_id ? ctx.nombrePorFicha.get(row.resource_id) : undefined;

  return {
    id: row.id,
    direction: row.direction,
    topic: row.topic,
    status: row.status,
    title,
    body,
    areaLabel,
    availability: limpiar(row.availability),
    orgName: limpiar(row.org_name),
    languages: (row.languages ?? []).map((item) => item.trim()).filter(Boolean),
    resource: row.resource_id && nombreFicha ? { id: row.resource_id, name: nombreFicha } : null,
    publisherId: row.created_by,
    publisherName:
      limpiar(ctx.nombrePorAutor.get(row.created_by)) ?? "Alguien de la comunidad",
    publishedAtLabel: timeAgo(row.created_at, ctx.now ?? new Date()),
    reviewNote: isOwner ? limpiar(row.review_note) : null,
    // Un contador negativo o ausente se lee como cero: la tarjeta prefiere no
    // decir nada antes que anunciar respuestas que no están.
    replyCount: typeof row.reply_count === "number" && row.reply_count > 0 ? row.reply_count : 0,
    isOwner,
  };
}

export interface HelpReplyContext {
  viewerId: string | null;
  nombrePorAutor: ReadonlyMap<string, string | null>;
  now?: Date;
}

/**
 * Fila cruda → respuesta lista para render, o `null`.
 *
 * Devuelve `null` para lo que el lector no tiene por qué ver: una respuesta
 * `hidden` que no es suya (la RLS se la deja leer al staff, y esta función la
 * usan también las pantallas públicas) y una `deleted` ajena. La propia sí
 * vuelve, en cualquiera de los dos estados: ver la propia respuesta borrada es
 * lo que hace que "borrar" se entienda como que funcionó.
 */
export function toHelpReply(row: HelpReplyRow, ctx: HelpReplyContext): HelpReply | null {
  if (!isHelpReplyStatus(row.status)) return null;

  const body = row.body.trim();
  if (!body) return null;

  const isOwner = Boolean(ctx.viewerId && row.created_by === ctx.viewerId);
  if (row.status !== "visible" && !isOwner) return null;

  return {
    id: row.id,
    noticeId: row.notice_id,
    body,
    status: row.status,
    authorId: row.created_by,
    authorName: limpiar(ctx.nombrePorAutor.get(row.created_by)) ?? "Alguien de la comunidad",
    createdAtLabel: timeAgo(row.created_at, ctx.now ?? new Date()),
    isOwner,
  };
}

function limpiar(valor: string | null | undefined): string | null {
  const texto = (valor ?? "").trim();
  return texto.length > 0 ? texto : null;
}
