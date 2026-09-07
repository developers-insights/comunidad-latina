/**
 * =============================================================================
 * "ESTÁ ESCRIBIENDO…" — contrato compartido (migración 0148)
 * =============================================================================
 *
 * Lógica pura: sin Supabase, sin React, sin `server-only`. La importan el
 * servidor —que arma los tópicos y los baja pintados en las props— y el
 * navegador, que es el único que abre canales.
 *
 * ─── POR QUÉ BROADCAST Y NO UNA TABLA ───────────────────────────────────────
 * Que alguien esté tecleando dura segundos y no le importa a nadie un minuto
 * después. Guardarlo en Postgres sería una fila por pulsación —con su WAL, su
 * replicación y su limpieza— para un dato que nace vencido. `broadcast` viaja
 * por el websocket y no toca disco.
 *
 * Tampoco `postgres_changes`, que es lo que ya usa la señalización de llamadas
 * (`lib/calls/vigilancia.ts`): ese mecanismo escucha CAMBIOS DE FILAS, así que
 * exige que primero exista la fila. Es el mismo problema con un paso más.
 *
 * ─── EL TÓPICO ES LA UNIDAD DE PERMISO ──────────────────────────────────────
 * Un tópico por conversación y uno por grupo, y la 0148 escribe las policies de
 * `realtime.messages` contra ESE nombre: para emitir o escuchar en
 * `escribiendo-grupo:<id>` hay que ser miembro de ese grupo, y la base lo
 * verifica igual que verifica los mensajes. Por eso el prefijo y la forma del
 * id no son cosmética.
 *
 * ⚠️ SI ACÁ CAMBIA UN PREFIJO, CAMBIA LA 0148. Los dos regex de la migración
 * están escritos contra estas dos constantes; un tópico que no matchea no
 * falla ruidosamente — simplemente nadie recibe nada.
 */

export const PREFIJO_DIRECTO = "escribiendo-directo";
export const PREFIJO_GRUPO = "escribiendo-grupo";

/** El único evento que viaja por estos canales. */
export const EVENTO_ESCRIBIENDO = "escribiendo";

/**
 * Cada cuánto se emite como mucho mientras alguien teclea.
 *
 * No es un ahorro de ancho de banda: una señal por tecla convierte a cualquiera
 * que escriba rápido en una fuente de cien mensajes por minuto, y Realtime los
 * cobra y los encola. Dos segundos alcanzan porque del otro lado el indicador
 * vive `VIGENCIA_MS`, que es más del doble.
 */
export const THROTTLE_MS = 2_000;

/**
 * Cuánto sobrevive el cartel sin recibir otra señal.
 *
 * ⚠️ TIENE QUE SER MAYOR QUE `THROTTLE_MS` CON MARGEN. Si fueran parecidos, un
 * request lento apagaría el cartel de alguien que sigue escribiendo y lo
 * volvería a prender un instante después: un parpadeo peor que no mostrarlo.
 * Y el techo existe para que el cartel NUNCA quede pegado — quien cierra la
 * pestaña de golpe no manda ningún aviso de despedida.
 */
export const VIGENCIA_MS = 5_000;

/**
 * Cuántas filas de la bandeja escuchan a la vez.
 *
 * Cada tópico es un canal con su chequeo de RLS al entrar. La bandeja puede
 * traer decenas de filas y abrir un canal por cada una convierte una pantalla
 * de lectura en decenas de autorizaciones. Se escuchan las de arriba, que son
 * las más recientes y las únicas donde "está escribiendo" llega a tiempo; el
 * resto se sigue leyendo igual, sin el cartel.
 */
export const MAX_HILOS_ESCUCHADOS = 12;

export function topicoDeDirecto(conversationId: string): string {
  return `${PREFIJO_DIRECTO}:${conversationId}`;
}

export function topicoDeGrupo(groupId: string): string {
  return `${PREFIJO_GRUPO}:${groupId}`;
}

const TOPICO_RE = new RegExp(
  `^(${PREFIJO_DIRECTO}|${PREFIJO_GRUPO}):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
  "i",
);

/**
 * El nombre del canal se interpola en `supabase.channel(...)`, así que se
 * valida antes de abrirlo. Un tópico mal formado no lo rechaza la 0148 con un
 * error: la policy no matchea y el canal queda mudo, que es mucho más difícil
 * de diagnosticar.
 */
export function esTopicoDeEscritura(topico: unknown): topico is string {
  return typeof topico === "string" && TOPICO_RE.test(topico);
}

export interface AvisoDeEscritura {
  /** Quién teclea. El nombre NO viaja: ver `resolverQuienEscribe`. */
  de: string;
  activo: boolean;
}

export function esAvisoDeEscritura(payload: unknown): payload is AvisoDeEscritura {
  if (typeof payload !== "object" || payload === null) return false;
  const aviso = payload as Record<string, unknown>;
  return typeof aviso.de === "string" && aviso.de.length > 0 && typeof aviso.activo === "boolean";
}

/**
 * DE IDS A NOMBRES, CONTRA UN MAPA DEL SERVIDOR.
 *
 * El payload lo escribe el navegador de otra persona, así que un nombre que
 * viniera adentro sería un nombre elegido por ella: en un grupo, cualquiera
 * podría hacer aparecer "Ana está escribiendo…". Por eso el aviso viaja con el
 * id pelado y el nombre lo pone ESTE lado, con la lista que ya bajó el
 * servidor. Un id que no está en el mapa cae en el genérico, nunca en lo que
 * dijo el emisor.
 *
 * El orden es el de llegada (lo conserva el `Set` de quien llama) y se corta en
 * dos: con tres o más el renglón deja de nombrar a nadie.
 */
export function resolverQuienEscribe(
  ids: readonly string[],
  nombres: ReadonlyMap<string, string>,
  generico: string,
): string[] {
  return ids.map((id) => nombres.get(id) ?? generico);
}
