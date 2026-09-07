/**
 * =============================================================================
 * LA BANDEJA — lo que se puede decidir sin la base
 * =============================================================================
 *
 * Módulo PURO: sin Supabase, sin React, sin DOM. Vive acá para que el resumen
 * de cada fila, el conteo de no leídos y el filtro de amigos se puedan testear
 * sin levantar una base, que es exactamente lo que hace `bandeja.test.ts`.
 *
 * Importa `copy.ts` a propósito: el texto visible de una fila ("Nota de voz ·
 * 0:24") ES el resultado de esta lógica, no una decoración que agrega la
 * pantalla. Partirlo en dos archivos dejaría el string fuera del test.
 */

import { COPY } from "@/components/messaging/copy";

/* ========================================================================== */
/* Filtros de la pestaña Personas — el estado vive en la URL                  */
/* ========================================================================== */

export const FILTROS_DE_PERSONAS = ["todos", "amigos", "no-leidos"] as const;

export type FiltroDePersonas = (typeof FILTROS_DE_PERSONAS)[number];

export function esFiltroDePersonas(value: unknown): value is FiltroDePersonas {
  return (
    typeof value === "string" &&
    (FILTROS_DE_PERSONAS as readonly string[]).includes(value)
  );
}

/** Cualquier basura en `?filtro=` cae en "todos": la bandeja nunca rompe. */
export function parseFiltroDePersonas(
  value: string | string[] | undefined,
): FiltroDePersonas {
  const crudo = (Array.isArray(value) ? value[0] : value) ?? "";
  return esFiltroDePersonas(crudo) ? crudo : "todos";
}

/** URL canónica: el default NO se escribe, así no hay dos direcciones para la
 *  misma pantalla (y el prefetch de Next cachea una sola). */
export function hrefDeFiltro(filtro: FiltroDePersonas): string {
  return filtro === "todos" ? "/mensajes" : `/mensajes?filtro=${filtro}`;
}

/* ========================================================================== */
/* Qué pasó en el último mensaje                                              */
/* ========================================================================== */

/**
 * Los tipos de mensaje del contrato de la 0136. `texto` es el único que existe
 * hoy en la base (0006 sólo tiene `body`), así que TODO lo que llegue sin
 * `kind` se lee como texto: un deploy de esta pantalla contra una base sin la
 * migración muestra la bandeja de siempre, no una lista de "Archivo".
 */
export const KINDS_DE_MENSAJE = [
  "texto",
  "imagen",
  "video",
  "audio",
  "archivo",
  "ubicacion",
  "perfil",
  "contenido",
] as const;

export type KindDeMensaje = (typeof KINDS_DE_MENSAJE)[number];

export function esKindDeMensaje(value: unknown): value is KindDeMensaje {
  return (
    typeof value === "string" && (KINDS_DE_MENSAJE as readonly string[]).includes(value)
  );
}

/** Clave del ícono, no el componente: este módulo no importa Phosphor (lo
 *  consume un test en entorno node). La pantalla la traduce a un `<Icon />`. */
export type IconoDeResumen =
  | "imagen"
  | "video"
  | "audio"
  | "archivo"
  | "ubicacion"
  | "perfil"
  | "contenido";

export type ResumenDeActividad = {
  /** `null` en un mensaje de texto: la fila muestra el texto y nada más. */
  icono: IconoDeResumen | null;
  texto: string;
};

export type MensajeDeBandeja = {
  conversation_id: string;
  sender_id: string;
  body: string | null;
  created_at: string;
  /** Ausente hasta que exista la columna (0136). */
  kind?: string | null;
  /** `jsonb`; hoy sólo se lee `duracion_ms`. */
  adjunto?: unknown;
};

/**
 * "0:24", "1:05" o "1:02:03". Redondea hacia abajo: un audio de 24,9 s dice
 * 0:24 y no 0:25, que es lo que el reproductor va a mostrar al abrirlo.
 */
export function formatearDuracion(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const segundos = total % 60;
  const minutos = Math.floor(total / 60) % 60;
  const horas = Math.floor(total / 3600);
  const mm = String(segundos).padStart(2, "0");
  return horas > 0
    ? `${horas}:${String(minutos).padStart(2, "0")}:${mm}`
    : `${minutos}:${mm}`;
}

/** `adjunto->>'duracion_ms'` sin confiar en la forma del jsonb. */
export function duracionDeAdjunto(adjunto: unknown): number | null {
  if (typeof adjunto !== "object" || adjunto === null) return null;
  const valor = (adjunto as Record<string, unknown>).duracion_ms;
  const numero = typeof valor === "string" ? Number(valor) : valor;
  return typeof numero === "number" && Number.isFinite(numero) && numero >= 0
    ? numero
    : null;
}

/**
 * Qué decir de un mensaje en una sola línea.
 *
 * El cuerpo de un adjunto NO se muestra aunque venga con texto: en un audio o
 * una ubicación, `body` es el nombre del archivo o unas coordenadas, y ninguna
 * de las dos cosas es lo que la persona quiere leer de reojo en la bandeja.
 */
export function resumirMensaje(mensaje: MensajeDeBandeja): ResumenDeActividad {
  const kind = esKindDeMensaje(mensaje.kind) ? mensaje.kind : "texto";

  switch (kind) {
    case "imagen":
      return { icono: "imagen", texto: COPY.inbox.resumen.foto };
    case "video":
      return { icono: "video", texto: COPY.inbox.resumen.video };
    case "audio": {
      const ms = duracionDeAdjunto(mensaje.adjunto);
      return {
        icono: "audio",
        texto:
          ms === null
            ? COPY.inbox.resumen.audio
            : COPY.inbox.resumen.audioConDuracion(formatearDuracion(ms)),
      };
    }
    case "archivo":
      return { icono: "archivo", texto: COPY.inbox.resumen.archivo };
    case "ubicacion":
      return { icono: "ubicacion", texto: COPY.inbox.resumen.ubicacion };
    case "perfil":
      return { icono: "perfil", texto: COPY.inbox.resumen.perfil };
    case "contenido":
      return { icono: "contenido", texto: COPY.inbox.resumen.contenido };
    default:
      return { icono: null, texto: (mensaje.body ?? "").trim() };
  }
}

/* ========================================================================== */
/* Llamadas                                                                   */
/* ========================================================================== */

/**
 * La RPC `buscar_en_mensajeria` (0140) devuelve el fragmento de una llamada como
 * `kind || ' · ' || status`, o sea los literales de la base: "video · perdida".
 * Eso NO se muestra: son valores de esquema, no una frase. Acá se traducen.
 *
 * "Llamada perdida" es, palabra por palabra, uno de los ejemplos que pidió el
 * cliente para que la fila diga de un vistazo qué pasó.
 */
export function describirLlamada(fragmento: string | null): string {
  const [kind = "", status = ""] = (fragmento ?? "").split("·").map((parte) => parte.trim());
  const tipo = kind === "video" ? COPY.inbox.llamada.video : COPY.inbox.llamada.audio;

  switch (status) {
    case "perdida":
      return COPY.inbox.llamada.perdida(tipo);
    case "rechazada":
      return COPY.inbox.llamada.rechazada(tipo);
    case "en_curso":
      return COPY.inbox.llamada.enCurso(tipo);
    case "sonando":
      return COPY.inbox.llamada.sonando(tipo);
    default:
      return tipo;
  }
}

/* ========================================================================== */
/* No leídos                                                                  */
/* ========================================================================== */

/**
 * Cuántos mensajes de la otra persona llegaron después de mi última lectura,
 * por conversación.
 *
 * INVARIANTE que no es obvia: una conversación SIN fila en `conversation_reads`
 * cuenta como nunca leída, así que todos los mensajes ajenos suman. Tratar la
 * ausencia como "leída" sería más silencioso, pero dejaría sin contador
 * justamente el caso que importa —una conversación nueva que nadie abrió—, y el
 * filtro "No leídos" nunca mostraría nada.
 *
 * Los propios nunca cuentan: nadie tiene mensajes sin leer de sí mismo.
 */
export function calcularNoLeidos(
  mensajes: readonly MensajeDeBandeja[],
  lecturas: ReadonlyMap<string, string>,
  miId: string,
): Map<string, number> {
  const cortes = new Map<string, number>();
  for (const [conversacionId, iso] of lecturas) {
    const t = Date.parse(iso);
    // Una fecha ilegible se trata como "nunca leí": nunca al revés. Perderse un
    // mensaje es peor que ver un contador de más.
    cortes.set(conversacionId, Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t);
  }

  const conteo = new Map<string, number>();
  for (const mensaje of mensajes) {
    if (mensaje.sender_id === miId) continue;
    const enviado = Date.parse(mensaje.created_at);
    if (Number.isNaN(enviado)) continue;
    const corte = cortes.get(mensaje.conversation_id) ?? Number.NEGATIVE_INFINITY;
    if (enviado <= corte) continue;
    conteo.set(mensaje.conversation_id, (conteo.get(mensaje.conversation_id) ?? 0) + 1);
  }
  return conteo;
}

/** Suma los no leídos de todas las conversaciones que tengo con una persona. */
export function noLeidosDelHilo(
  conversacionIds: readonly string[],
  noLeidosPorConversacion: ReadonlyMap<string, number>,
): number {
  let total = 0;
  for (const id of conversacionIds) total += noLeidosPorConversacion.get(id) ?? 0;
  return total;
}

/**
 * ¿El último mensaje de la conversación ya lo leyó la otra persona?
 *
 * Sólo aplica a los MÍOS: el tilde de "Leído" es información sobre el otro, y
 * ponerlo en un mensaje ajeno no significaría nada.
 */
export function fueLeidoPorElOtro(
  ultimo: MensajeDeBandeja | null,
  miId: string,
  leidoPorElOtroIso: string | null,
): boolean {
  if (!ultimo || ultimo.sender_id !== miId || !leidoPorElOtroIso) return false;
  const leido = Date.parse(leidoPorElOtroIso);
  const enviado = Date.parse(ultimo.created_at);
  if (Number.isNaN(leido) || Number.isNaN(enviado)) return false;
  return leido >= enviado;
}

/* ========================================================================== */
/* Amigos = seguimiento mutuo                                                 */
/* ========================================================================== */

/**
 * "Amigo" no existe en la base y no se va a crear: la decisión de producto es
 * que amistad = SEGUIMIENTO MUTUO sobre `follows` (0023). Acá se cruzan las dos
 * direcciones.
 *
 * Se hace con dos conjuntos y no con una RPC por par (`son_amigos(a, b)`)
 * porque una RPC por fila es un N+1: veinte personas en la bandeja serían
 * veinte viajes. Las dos listas salen de dos consultas en paralelo, ya
 * acotadas a las personas que la pantalla va a pintar.
 */
export function amigosPorSeguimientoMutuo(
  losQueSigo: Iterable<string>,
  losQueMeSiguen: Iterable<string>,
): Set<string> {
  const meSiguen = new Set(losQueMeSiguen);
  const amigos = new Set<string>();
  for (const id of losQueSigo) {
    if (meSiguen.has(id)) amigos.add(id);
  }
  return amigos;
}
