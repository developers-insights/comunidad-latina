/**
 * =============================================================================
 * LA BANDEJA SE AGRUPA POR PERSONA, NO POR AVISO
 * =============================================================================
 *
 * EL PROBLEMA, con la foto del cliente delante (call del 3/9, punto 7):
 * la bandeja listaba UNA FILA POR CONVERSACIÓN, y como cada conversación nace
 * de un aviso (`request_contact`), Ramón "El Nítido" Cabrera aparecía tres
 * veces y Doña Altagracia Frías otras tres — «Sobre: Gorra bordada», «Sobre:
 * Barbería El Nítido»… La misma persona, seis filas, y ningún lugar donde
 * buscarla.
 *
 * LA DECISIÓN, y por qué es en la consulta y no en el esquema
 * -----------------------------------------------------------
 * Se evaluó unificar de verdad: una conversación por par de personas, con el
 * aviso pasando a ser un dato del MENSAJE. Se descartó, y no por pereza:
 *
 *   · `conversations` tiene una máquina de estados pending/accepted POR HILO.
 *     Fusionar dos hilos obliga a decidir qué pasa cuando uno está aceptado y
 *     el otro pendiente — o sea, a inventar una regla nueva para el contacto
 *     protegido (§9.2), que es la pieza más delicada del producto.
 *   · `conversations_listing_requester_uniq`, `request_contact()`, el chat de
 *     Empleos y el aviso por mail de "te contactaron por tu aviso" leen esa
 *     forma. Una migración de datos que colapse hilos vivos en producción, con
 *     inversores mirando la app esta semana, es riesgo sin premio.
 *   · Lo que el cliente pidió es lo que se VE. Agrupar en la lectura lo
 *     resuelve entero y es reversible: si mañana se decide fusionar de verdad,
 *     esta función se borra y nada más cambia.
 *
 * Así que el aviso no se pierde: baja de ser el TÍTULO de la fila a ser el
 * CONTEXTO adentro del hilo (la tarjeta del aviso que ya vive en
 * `/mensajes/[id]`), y en la bandeja queda como una línea discreta cuando hay
 * más de una charla con la misma persona.
 *
 * QUÉ ABRE LA FILA
 * ----------------
 * La conversación con actividad más reciente. Con una excepción que manda
 * sobre todo lo demás: si hay una SOLICITUD RECIBIDA sin responder, la fila se
 * planta ahí. Una solicitud pide una decisión ("¿acepto o ignoro?") y esconderla
 * detrás de una charla vieja es perderla.
 *
 * Este archivo es puro y no sabe de Supabase a propósito: se testea sin base.
 */

export type ConversacionLite = {
  id: string;
  status: string;
  created_at: string;
  created_by: string;
  counterpart_id: string;
  listing: { id: string; title: string } | null;
  /** Perfil de quien la creó (puede faltar si el perfil se borró). */
  creator: PersonaLite | null;
  /** Perfil de la contraparte. */
  counterpart: PersonaLite | null;
};

export type PersonaLite = {
  id: string;
  display_name: string;
  avatar_url: string | null;
};

export type UltimoMensaje = {
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

export type HiloDePersona = {
  /** Id del perfil de la otra persona. Es la clave del agrupamiento. */
  personaId: string;
  persona: PersonaLite | null;
  /** A dónde navega la fila. */
  conversacionPrincipalId: string;
  /** Todas las conversaciones con esta persona, de más a menos reciente. */
  conversacionIds: string[];
  ultimoMensaje: UltimoMensaje | null;
  /** ISO de la última señal de vida (último mensaje o alta de la solicitud). */
  ultimaActividad: string;
  /** Solicitud recibida sin responder, si la hay. La fila se planta acá. */
  solicitudRecibidaId: string | null;
  /** Título del aviso de la solicitud recibida, para el copy "Quiere contactarte por…". */
  solicitudRecibidaAviso: string | null;
  /** Tengo una solicitud MÍA esperando respuesta y ninguna charla abierta. */
  esperandoRespuesta: boolean;
  /** Títulos de los avisos involucrados, sin repetir. Contexto de la fila. */
  avisos: string[];
};

/**
 * Agrupa las conversaciones del inbox por contraparte.
 *
 * `blocked` NO llega hasta acá: lo filtra la consulta, como venía haciendo la
 * bandeja ("ignorar = desaparece sin drama"). Si llegara, se ignora igual, para
 * que esta función no dependa de que quien la llame se acuerde.
 */
export function agruparPorPersona(
  conversaciones: ConversacionLite[],
  ultimos: Map<string, UltimoMensaje>,
  miId: string,
): HiloDePersona[] {
  const porPersona = new Map<string, ConversacionLite[]>();

  for (const conversacion of conversaciones) {
    if (conversacion.status === "blocked") continue;
    const soyCreador = conversacion.created_by === miId;
    const otroId = soyCreador ? conversacion.counterpart_id : conversacion.created_by;
    const lista = porPersona.get(otroId);
    if (lista) lista.push(conversacion);
    else porPersona.set(otroId, [conversacion]);
  }

  const hilos: HiloDePersona[] = [];

  for (const [personaId, lista] of porPersona) {
    const ordenadas = [...lista].sort(
      (a, b) => actividadDe(b, ultimos).localeCompare(actividadDe(a, ultimos)),
    );

    const primera = ordenadas[0];
    const soyCreadorDeLaPrimera = primera.created_by === miId;
    const persona = soyCreadorDeLaPrimera ? primera.counterpart : primera.creator;

    // La solicitud recibida manda sobre el orden por fecha: pide una decisión.
    const solicitud =
      ordenadas.find((c) => c.status === "pending" && c.created_by !== miId) ?? null;

    const principal = solicitud ?? primera;

    // "Esperando respuesta" sólo si NO hay ninguna charla abierta con esta
    // persona: con una aceptada al lado, el cartel sobra y confunde.
    const hayAceptada = ordenadas.some((c) => c.status === "accepted");
    const esperandoRespuesta =
      !hayAceptada &&
      !solicitud &&
      ordenadas.every((c) => c.status === "pending" && c.created_by === miId);

    const avisos: string[] = [];
    for (const conversacion of ordenadas) {
      const titulo = conversacion.listing?.title;
      if (titulo && !avisos.includes(titulo)) avisos.push(titulo);
    }

    hilos.push({
      personaId,
      persona: persona ?? null,
      conversacionPrincipalId: principal.id,
      conversacionIds: ordenadas.map((c) => c.id),
      ultimoMensaje: ultimos.get(primera.id) ?? null,
      ultimaActividad: actividadDe(primera, ultimos),
      solicitudRecibidaId: solicitud?.id ?? null,
      solicitudRecibidaAviso: solicitud?.listing?.title ?? null,
      esperandoRespuesta,
      avisos,
    });
  }

  // Orden final: la última actividad de cada persona, de más nueva a más vieja.
  return hilos.sort((a, b) => b.ultimaActividad.localeCompare(a.ultimaActividad));
}

/**
 * Última señal de vida de una conversación: el mensaje más nuevo o, si todavía
 * no hay ninguno, el momento en que se pidió el contacto. Sin este fallback,
 * una solicitud recién llegada y sin mensaje se hundiría al fondo de la lista.
 */
function actividadDe(
  conversacion: ConversacionLite,
  ultimos: Map<string, UltimoMensaje>,
): string {
  return ultimos.get(conversacion.id)?.created_at ?? conversacion.created_at;
}
