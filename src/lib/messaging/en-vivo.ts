/**
 * =============================================================================
 * MENSAJES EN VIVO — el contrato del aviso y el parcheo en memoria
 * =============================================================================
 *
 * Módulo puro (sin Supabase, sin React): lo importan el hilo y la bandeja, y lo
 * prueba `en-vivo.test.ts` sin levantar nada.
 *
 * ─── EL AVISO ES UN TIMBRE, NO EL MENSAJE ───────────────────────────────────
 * Viaja por el MISMO canal privado del "está escribiendo…" (0148), con otro
 * evento. Lo emite el navegador de quien escribió, así que su contenido no se
 * pinta nunca: quien lo recibe va a buscar los mensajes nuevos a la base, con
 * su propia sesión, y la RLS decide qué le llega. Un aviso falso cuesta una
 * consulta que vuelve vacía; no puede hacer aparecer un mensaje que no existe.
 *
 * ⚠️ `messages` y `chat_group_messages` NO están en la publicación
 * `supabase_realtime` (verificado contra la base el 2026-10-06). Si algún día
 * un trigger de la base emite este mismo evento en este mismo tópico, el
 * cliente no cambia: el payload sigue siendo sólo el timbre.
 */

import {
  resumirMensaje,
  type FilaDeBandeja,
  type MensajeDeBandeja,
} from "./bandeja";
import { PREFIJO_DIRECTO, PREFIJO_GRUPO, esTopicoDeEscritura } from "./escribiendo";

export const EVENTO_MENSAJE = "mensaje";

/** `nuevo`: hay mensajes para ir a buscar. `cambio`: se editó, borró o reaccionó. */
export type TipoDeAviso = "nuevo" | "cambio";

export interface AvisoDeMensaje {
  de: string;
  tipo: TipoDeAviso;
}

export function esAvisoDeMensaje(payload: unknown): payload is AvisoDeMensaje {
  if (typeof payload !== "object" || payload === null) return false;
  const aviso = payload as Record<string, unknown>;
  return (
    typeof aviso.de === "string" &&
    aviso.de.length > 0 &&
    (aviso.tipo === "nuevo" || aviso.tipo === "cambio")
  );
}

export function hiloDeTopico(
  topico: string,
): { ambito: "directo" | "grupo"; id: string } | null {
  if (!esTopicoDeEscritura(topico)) return null;
  const [prefijo, id] = topico.split(":");
  if (prefijo === PREFIJO_DIRECTO) return { ambito: "directo", id };
  if (prefijo === PREFIJO_GRUPO) return { ambito: "grupo", id };
  return null;
}

function tiempo(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** El más nuevo de los dos ISO, o el que haya. */
export function masReciente(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return tiempo(b) > tiempo(a) ? b : a;
}

/**
 * Suma a la bandeja los mensajes que trajo un aviso.
 *
 * Quien llama garantiza que cada mensaje llega UNA sola vez (lleva el registro
 * de ids aplicados): esta función suma no leídos, así que un mensaje repetido
 * sería un contador inflado.
 *
 * Un mensaje viejo de otra charla con la misma persona suma al contador pero no
 * pisa el resumen: la fila habla de lo último que pasó con esa persona.
 */
export function aplicarMensajesALaBandeja(
  filas: readonly FilaDeBandeja[],
  mensajes: readonly MensajeDeBandeja[],
  miId: string,
): FilaDeBandeja[] {
  if (mensajes.length === 0) return [...filas];

  const siguiente = [...filas];
  const ordenados = [...mensajes].sort((a, b) => tiempo(a.created_at) - tiempo(b.created_at));
  let tocada = false;

  for (const mensaje of ordenados) {
    const indice = siguiente.findIndex((fila) =>
      fila.conversacionIds.includes(mensaje.conversation_id),
    );
    if (indice === -1) continue;

    const fila = siguiente[indice];
    const propio = mensaje.sender_id === miId;
    const esLoUltimo = tiempo(mensaje.created_at) >= tiempo(fila.ultimaActividad);
    tocada = true;

    siguiente[indice] = {
      ...fila,
      noLeidos: propio ? fila.noLeidos : fila.noLeidos + 1,
      // Si la otra persona escribió, la charla ya no está esperando respuesta.
      esperandoRespuesta: propio ? fila.esperandoRespuesta : false,
      ...(esLoUltimo
        ? {
            ultimoMensaje: {
              conversation_id: mensaje.conversation_id,
              sender_id: mensaje.sender_id,
              body: mensaje.body ?? "",
              created_at: mensaje.created_at,
            },
            resumen: resumirMensaje(mensaje),
            ultimaActividad: mensaje.created_at,
            leidoPorElOtro: false,
          }
        : {}),
    };
  }

  if (!tocada) return siguiente;
  return ordenarPorActividad(siguiente);
}

/** Estable: dos filas con la misma hora no se cruzan entre sí. */
export function ordenarPorActividad(filas: readonly FilaDeBandeja[]): FilaDeBandeja[] {
  return filas
    .map((fila, indice) => ({ fila, indice }))
    .sort(
      (a, b) =>
        tiempo(b.fila.ultimaActividad) - tiempo(a.fila.ultimaActividad) || a.indice - b.indice,
    )
    .map(({ fila }) => fila);
}

export function marcarFilaLeida(
  filas: readonly FilaDeBandeja[],
  personaId: string,
): FilaDeBandeja[] {
  return filas.map((fila) =>
    fila.personaId === personaId && fila.noLeidos > 0 ? { ...fila, noLeidos: 0 } : fila,
  );
}

export function sumarNoLeidos(filas: readonly FilaDeBandeja[]): number {
  return filas.reduce((total, fila) => total + fila.noLeidos, 0);
}

/* ========================================================================== */
/* Mensajes que llegan al hilo antes que el refresco del servidor             */
/* ========================================================================== */

export interface MensajeEntrante {
  id: string;
  body: string;
  created_at: string;
  kind: string | null;
  adjunto: unknown;
  propio: boolean;
  autorNombre: string | null;
}

/**
 * Suma los recién llegados sin repetir y en orden de envío. `conocidos` son los
 * ids que el servidor ya pintó: un entrante que el refresco ya trajo no se
 * vuelve a dibujar abajo.
 */
export function sumarEntrantes(
  previos: readonly MensajeEntrante[],
  nuevos: readonly MensajeEntrante[],
  conocidos: ReadonlySet<string>,
): MensajeEntrante[] {
  const porId = new Map<string, MensajeEntrante>();
  for (const mensaje of [...previos, ...nuevos]) {
    if (conocidos.has(mensaje.id) || porId.has(mensaje.id)) continue;
    porId.set(mensaje.id, mensaje);
  }
  return [...porId.values()].sort((a, b) => tiempo(a.created_at) - tiempo(b.created_at));
}

/** Lo que dice la burbuja provisoria: el texto, o "Foto" / "Nota de voz · 0:24". */
export function textoDeEntrante(mensaje: MensajeEntrante): {
  texto: string;
  esResumen: boolean;
} {
  const resumen = resumirMensaje({
    conversation_id: "",
    sender_id: "",
    body: mensaje.body,
    created_at: mensaje.created_at,
    kind: mensaje.kind,
    adjunto: mensaje.adjunto,
  });
  return { texto: resumen.texto, esResumen: resumen.icono !== null };
}
