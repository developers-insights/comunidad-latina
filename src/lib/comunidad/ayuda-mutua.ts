import {
  HELP_DIRECTIONS,
  HELP_STATUSES,
  HELP_TOPICS,
  type HelpDirection,
  type HelpNotice,
  type HelpNoticeRow,
  type HelpStatus,
  type HelpTopic,
} from "./types";
import { timeAgo } from "@/lib/utils";

/**
 * =============================================================================
 * LÓGICA PURA DEL TABLÓN DE AYUDA MUTUA (migración 0120)
 * =============================================================================
 *
 * Sin React, sin Supabase, sin `server-only`: lo importan por igual el
 * formulario (cliente), las lecturas (servidor), las server actions y la cola
 * del panel. Se testea sin montar nada — ver `ayuda-mutua.test.ts`.
 *
 * Acá viven TRES cosas y ninguna de las tres es una copia de conveniencia:
 *
 *  1. LA MÁQUINA DE ESTADOS, espejo exacto del trigger
 *     `app.community_help_notices_guard()`. Existe del lado de la app para que
 *     la pantalla pueda mostrar sólo los botones que van a funcionar. La base
 *     sigue siendo la que manda: si estas dos tablas se separan, el usuario ve
 *     un botón que la base rechaza — feo, pero seguro. Al revés (que la app
 *     permita algo que la base no controla) es lo que no puede pasar, y no
 *     puede pasar porque la autorización no está acá.
 *
 *  2. EL DETECTOR DE DATOS DE CONTACTO. Es la pieza anti-honeypot de este
 *     módulo. La tabla no tiene columna de teléfono (§2 de la migración), así
 *     que el único lugar donde alguien puede filtrar el suyo es el texto
 *     libre. Un aviso con "llamame al 718-555-0142" convierte el tablón en
 *     exactamente el padrón que la migración se propuso no construir, y lo
 *     hace sin que ninguna policy se entere.
 *
 *     No es censura de la conversación: es que la conversación pasa por otro
 *     lado. La app tiene contacto protegido (`conversations`, §9.2) y lo dice
 *     en pantalla con esas palabras.
 *
 *  3. EL MAPEO FILA → VISTA, que descarta lo que no se puede mostrar con
 *     honestidad (tema o dirección desconocidos), igual que hace
 *     `toCommunityResource` con las fichas sin fuente.
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

// ---------------------------------------------------------------------------
// Máquina de estados
// ---------------------------------------------------------------------------

/** Quién intenta mover el aviso. No es un rol: es de qué lado del mostrador está. */
export type HelpActor = "autor" | "staff";

/**
 * Transiciones permitidas, transcriptas del trigger de la 0120.
 *
 * Lo que NO está acá vale la pena leerlo:
 *  · El autor no tiene ninguna flecha hacia `approved`. Ni una. Es la regla del
 *    cliente y está escrita tres veces (policy, trigger, esto).
 *  · De `archived` no sale ninguna flecha: un aviso dado de baja se vuelve a
 *    escribir, no se resucita. Resucitarlo publicaría de nuevo un texto que su
 *    autor decidió bajar, que es de los peores bugs posibles (mismo criterio
 *    que `attrs.paused_reason` en la 0118).
 *  · El staff puede ir de `rejected` a `approved` porque un moderador se puede
 *    equivocar y arreglarlo no debería costarle a la persona volver a escribir
 *    todo.
 */
const TRANSICIONES: Record<HelpActor, Partial<Record<HelpStatus, readonly HelpStatus[]>>> = {
  autor: {
    draft: ["pending"],
    pending: ["draft", "archived"],
    rejected: ["draft"],
    approved: ["archived"],
  },
  staff: {
    pending: ["approved", "rejected"],
    approved: ["rejected", "archived"],
    rejected: ["approved"],
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

/** Los estados a los que ESTE actor puede llevar el aviso desde donde está. */
export function transicionesPosibles(desde: HelpStatus, actor: HelpActor): HelpStatus[] {
  return [...(TRANSICIONES[actor][desde] ?? [])];
}

/**
 * Estados que cuentan para el cupo de 5 por persona (`HELP_MAX_OPEN`).
 *
 * Es "lo que todavía no se resolvió", no "lo que se ve": un borrador no lo ve
 * nadie y ocupa lugar igual, porque el cupo existe para que no se pueda armar
 * el flood ANTES de mandarlo todo junto.
 */
export const HELP_OPEN_STATUSES: readonly HelpStatus[] = ["draft", "pending"];

export function esAvisoAbierto(status: HelpStatus): boolean {
  return HELP_OPEN_STATUSES.includes(status);
}

/** El contenido sólo se edita mientras es borrador — anti bait-and-switch. */
export function puedeEditarContenido(status: HelpStatus): boolean {
  return status === "draft";
}

// ---------------------------------------------------------------------------
// Detector de datos de contacto en el texto libre
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
  " ", " ", "-", "‐", "‑", "‒", "–", "—",
  "(", ")", ".", "+", "/",
]);

/** Siete dígitos seguidos ya es un número local de EE. UU. */
const DIGITOS_DE_TELEFONO = 7;

const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

/**
 * Enlaces. Incluye los acortadores de mensajería (`wa.me`, `t.me`) porque son
 * el caso real: nadie pega un `https://` completo, pega "wa.me/1718…". Un
 * enlace a un grupo es un canal de contacto igual que un teléfono, y además se
 * lleva la conversación afuera de la app, donde no se puede reportar nada
 * (§9.2).
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
 * Fila cruda → aviso listo para render, o `null` si no se puede mostrar con
 * honestidad. Se descarta cuando el tema, la dirección o el estado no son de
 * los conocidos: una fila así iría a una sección sin título o pintaría un
 * estado que la pantalla no sabe dibujar.
 *
 * `reviewNote` sólo viaja hacia su AUTOR. La RLS ya hace que un tercero no
 * pueda leer la fila rechazada, pero el staff sí puede: mostrarle el reproche
 * de un moderador a alguien que no es el destinatario no tiene por qué pasar
 * por un descuido de la pantalla.
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
    orgName: row.direction === "need" ? limpiar(row.org_name) : null,
    languages: (row.languages ?? []).map((item) => item.trim()).filter(Boolean),
    resource: row.resource_id && nombreFicha ? { id: row.resource_id, name: nombreFicha } : null,
    publisherId: row.created_by,
    publisherName:
      limpiar(ctx.nombrePorAutor.get(row.created_by)) ?? "Alguien de la comunidad",
    publishedAtLabel: timeAgo(row.created_at, ctx.now ?? new Date()),
    reviewNote: isOwner ? limpiar(row.review_note) : null,
    isOwner,
  };
}

function limpiar(valor: string | null | undefined): string | null {
  const texto = (valor ?? "").trim();
  return texto.length > 0 ? texto : null;
}

/**
 * Orden del tablón: primero los lugares que PIDEN manos, después quienes se
 * ofrecen.
 *
 * No es una preferencia estética. Un pedido tiene fecha y cupo —"necesitamos
 * cuatro personas el sábado"— y quien lo lee puede resolverlo hoy. Un
 * ofrecimiento está disponible y sigue estándolo mañana. Poner lo perecedero
 * arriba es lo mismo que hace `sortCasesOpenFirst` en Perdido y encontrado, y
 * por el mismo motivo.
 *
 * Función pura sobre el arreglo YA paginado: no reordena la base, que necesita
 * su orden estable por (created_at, id) para que el keyset no repita filas.
 */
export function sortNeedsFirst<T extends { direction: HelpDirection }>(
  avisos: readonly T[],
): T[] {
  return [
    ...avisos.filter((aviso) => aviso.direction === "need"),
    ...avisos.filter((aviso) => aviso.direction === "offer"),
  ];
}
