import "server-only";

import { createClient } from "@/lib/supabase/server";
import { supabaseSinTiparGrupos } from "@/lib/messaging/grupos";
import {
  agruparPorPersona,
  type ConversacionLite,
  type HiloDePersona,
  type UltimoMensaje,
} from "@/lib/messaging/agrupar-por-persona";
import {
  amigosPorSeguimientoMutuo,
  calcularNoLeidos,
  fueLeidoPorElOtro,
  noLeidosDelHilo,
  resumirMensaje,
  type FiltroDePersonas,
  type MensajeDeBandeja,
  type ResumenDeActividad,
} from "@/lib/messaging/bandeja";

/**
 * =============================================================================
 * LECTURAS DE LA BANDEJA
 * =============================================================================
 *
 * Ninguna consulta de este archivo filtra por `tenant_id` ni por `profile_id`:
 * la RLS de `conversations` y `messages` (0006) ya exige ser participante y del
 * tenant del JWT. Repetirlo acá crearía una segunda verdad — la regla que la
 * 0044 dejó escrita para todo el repo.
 *
 * ── POR QUÉ TODO ESTO DEGRADA EN VEZ DE ROMPER ──────────────────────────────
 * `messages.kind`/`adjunto` (0136) y `conversation_reads` + `contar_no_leidos()`
 * (0137) están en el repo, pero que un archivo de migración exista no significa
 * que esté APLICADO: en este proyecto `schema_migrations` ya mintió una vez y
 * hubo que verificar por los objetos. Y el modo de falla es feo: un `select` que
 * nombra una columna inexistente no devuelve una lista incompleta, devuelve
 * `data: null` con un 42703 — o sea la BANDEJA ENTERA VACÍA y ningún error a la
 * vista, idéntico a "no tenés mensajes" (el mismo síntoma que dejaron unos GRANT
 * borrados).
 *
 * Por eso cada pieza nueva se pide por separado y su fallo apaga sólo su
 * función: sin `kind` la bandeja muestra texto plano, sin los no leídos no hay
 * contadores ni chip. Nunca una pantalla en blanco.
 */

/** Techo de conversaciones. Mismo que traía la pantalla antes de las pestañas. */
const LIMITE_CONVERSACIONES = 100;

/** Ventana de mensajes recientes de la que salen el resumen Y los no leídos. */
const LIMITE_MENSAJES = 400;

const CONVERSACION_COLUMNS = `id, status, created_at, created_by, counterpart_id,
   listing:listings(id, title, kind),
   creator:profiles!conversations_created_by_fkey(id, display_name, avatar_url),
   counterpart:profiles!conversations_counterpart_id_fkey(id, display_name, avatar_url)`;

const MENSAJE_COLUMNS_RICAS = "conversation_id, sender_id, body, created_at, kind, adjunto";
const MENSAJE_COLUMNS_BASE = "conversation_id, sender_id, body, created_at";

export type FilaDeBandeja = HiloDePersona & {
  /** Lo que dice la última línea, con su ícono. */
  resumen: ResumenDeActividad | null;
  /** Mensajes de la otra persona que llegaron después de mi última lectura. */
  noLeidos: number;
  /** El último mensaje es mío y la otra persona ya lo abrió. */
  leidoPorElOtro: boolean;
  /** Sumado sólo cuando el filtro lo necesita; `null` significa "no se preguntó". */
  esAmigo: boolean | null;
};

export type Bandeja = {
  /** Ya filtradas por el chip activo. */
  filas: FilaDeBandeja[];
  /**
   * Sin leer en TODA la bandeja, no en `filas`. Es lo que muestra el chip "No
   * leídos": si contara lo filtrado, pararse en ese chip lo dejaría siempre
   * igual al largo de la lista, y pararse en "Amigos" lo bajaría sin que nada
   * se hubiera leído.
   */
  totalNoLeidos: number;
  /** `false` cuando `conversation_reads` todavía no existe: sin contadores. */
  hayLecturas: boolean;
};

/**
 * Un `select` que nombra columnas que la base todavía no tiene se lleva puesta
 * la consulta entera. Se prueba con las nuevas y, ante el 42703 (`undefined
 * column`) o el 42P01 de PostgREST, se repite con las de siempre.
 */
async function leerMensajesRecientes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  conversacionIds: string[],
): Promise<MensajeDeBandeja[]> {
  const pedir = (columnas: string) =>
    supabaseSinTiparGrupos(supabase)
      .from("messages")
      .select(columnas)
      .in("conversation_id", conversacionIds)
      .order("created_at", { ascending: false })
      .limit(LIMITE_MENSAJES);

  const { data, error } = await pedir(MENSAJE_COLUMNS_RICAS);
  if (!error) return (data ?? []) as unknown as MensajeDeBandeja[];

  const { data: basicos, error: errorBase } = await pedir(MENSAJE_COLUMNS_BASE);
  if (errorBase) {
    console.warn("[mensajes] no se pudieron leer los últimos mensajes", {
      code: errorBase.code,
    });
    return [];
  }
  return (basicos ?? []) as unknown as MensajeDeBandeja[];
}

type FilaDeLectura = { conversation_id: string; profile_id: string; last_read_at: string };

/**
 * NO LEÍDOS POR CONVERSACIÓN — el camino corto.
 *
 * `contar_no_leidos()` (0137) devuelve el conteo de TODA la bandeja —chats y
 * grupos— en una sola consulta agrupada, con el mismo criterio que este módulo
 * calcularía a mano: los propios no cuentan y una conversación sin marca de
 * lectura cuenta desde `-infinity`. Y además no tiene el techo de la ventana de
 * 400 mensajes que sí tiene el cálculo en memoria.
 *
 * Devuelve `null` —no un mapa vacío— cuando la RPC no está: la pantalla necesita
 * distinguir "nadie tiene nada sin leer" de "no sabemos", porque en el segundo
 * caso no puede prometer un filtro que no anda.
 */
async function leerNoLeidosDeLaBase(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<Map<string, number> | null> {
  const { data, error } = await supabaseSinTiparGrupos(supabase).rpc("contar_no_leidos");

  if (error) {
    console.warn("[mensajes] contar_no_leidos no disponible", { code: error.code });
    return null;
  }

  const conteo = new Map<string, number>();
  for (const fila of (data ?? []) as { tipo: string; id: string; no_leidos: number }[]) {
    if (fila.tipo === "conversacion") conteo.set(fila.id, fila.no_leidos);
  }
  return conteo;
}

/**
 * La red de contención: las marcas de lectura crudas, para calcular los no
 * leídos en memoria cuando la RPC no está desplegada.
 *
 * OJO con lo que esta consulta NO puede traer: la policy de `conversation_reads`
 * (0137) es `profile_id = auth.uid()`, así que sólo devuelve MIS marcas. La
 * marca de la OTRA persona —la que haría falta para el tilde de "Leído"— no es
 * legible desde acá por diseño. Ver el comentario de `leidoPorElOtro`.
 */
async function leerLecturas(
  supabase: Awaited<ReturnType<typeof createClient>>,
  conversacionIds: string[],
): Promise<FilaDeLectura[] | null> {
  const { data, error } = await supabaseSinTiparGrupos(supabase)
    .from("conversation_reads")
    .select("conversation_id, profile_id, last_read_at")
    .in("conversation_id", conversacionIds);

  if (error) {
    console.warn("[mensajes] conversation_reads no disponible", { code: error.code });
    return null;
  }
  return (data ?? []) as unknown as FilaDeLectura[];
}

/**
 * Amigos = seguimiento mutuo sobre `follows` (0023). Dos consultas en paralelo
 * y ya acotadas a la gente que está en pantalla; el cruce lo hace
 * `amigosPorSeguimientoMutuo`. Una RPC por par sería un viaje por fila.
 */
async function leerAmigos(
  supabase: Awaited<ReturnType<typeof createClient>>,
  miId: string,
  personaIds: string[],
): Promise<Set<string>> {
  if (personaIds.length === 0) return new Set();

  const [{ data: sigo, error: errorSigo }, { data: meSiguen, error: errorSiguen }] =
    await Promise.all([
      supabase
        .from("follows")
        .select("target_id")
        .eq("follower_id", miId)
        .eq("target_kind", "profile")
        .in("target_id", personaIds),
      supabase
        .from("follows")
        .select("follower_id")
        .eq("target_kind", "profile")
        .eq("target_id", miId)
        .in("follower_id", personaIds),
    ]);

  if (errorSigo || errorSiguen) {
    console.warn("[mensajes] no se pudo resolver el seguimiento mutuo", {
      code: errorSigo?.code ?? errorSiguen?.code,
    });
    return new Set();
  }

  return amigosPorSeguimientoMutuo(
    (sigo ?? []).map((fila) => fila.target_id),
    (meSiguen ?? []).map((fila) => fila.follower_id),
  );
}

/**
 * La pestaña Personas.
 *
 * Las solicitudes RECIBIDAS ya no viven acá: tienen su propia pestaña
 * (`/mensajes/solicitudes`). Mezclarlas era lo que hacía que una decisión
 * pendiente ("¿acepto o ignoro?") quedara enterrada entre charlas viejas.
 */
export async function leerBandejaDePersonas({
  miId,
  filtro,
}: {
  miId: string;
  filtro: FiltroDePersonas;
}): Promise<Bandeja> {
  const supabase = await createClient();

  const { data: conversacionesData, error } = await supabase
    .from("conversations")
    .select(CONVERSACION_COLUMNS)
    .neq("status", "blocked")
    .order("created_at", { ascending: false })
    .limit(LIMITE_CONVERSACIONES);

  if (error) {
    console.warn("[mensajes] no se pudo leer la bandeja", { code: error.code });
    return { filas: [], totalNoLeidos: 0, hayLecturas: false };
  }

  const todas = (conversacionesData ?? []) as unknown as ConversacionLite[];
  // Una solicitud recibida sin responder pertenece a la pestaña Solicitudes y a
  // ninguna otra. Las MÍAS sin responder sí se quedan: son una conversación que
  // ya empecé, con su "Esperando respuesta".
  const conversaciones = todas.filter(
    (c) => !(c.status === "pending" && c.created_by !== miId),
  );

  if (conversaciones.length === 0) {
    return { filas: [], totalNoLeidos: 0, hayLecturas: true };
  }

  const ids = conversaciones.map((c) => c.id);
  const [mensajes, desdeLaBase] = await Promise.all([
    leerMensajesRecientes(supabase, ids),
    leerNoLeidosDeLaBase(supabase),
  ]);

  const ultimoPorConversacion = new Map<string, MensajeDeBandeja>();
  for (const mensaje of mensajes) {
    if (!ultimoPorConversacion.has(mensaje.conversation_id)) {
      ultimoPorConversacion.set(mensaje.conversation_id, mensaje);
    }
  }

  // Sin la RPC se calcula acá, con las marcas crudas y la ventana de mensajes
  // que ya se bajó. Es un viaje más y sólo ocurre en el mundo degradado.
  const ajenas = new Map<string, string>();
  let noLeidosPorConversacion = desdeLaBase;
  if (noLeidosPorConversacion === null) {
    const lecturas = await leerLecturas(supabase, ids);
    const mias = new Map<string, string>();
    for (const fila of lecturas ?? []) {
      (fila.profile_id === miId ? mias : ajenas).set(
        fila.conversation_id,
        fila.last_read_at,
      );
    }
    noLeidosPorConversacion = lecturas ? calcularNoLeidos(mensajes, mias, miId) : null;
  }

  const hayLecturas = noLeidosPorConversacion !== null;
  const noLeidos = noLeidosPorConversacion ?? new Map<string, number>();

  const hilos = agruparPorPersona(
    conversaciones,
    ultimoPorConversacion as Map<string, UltimoMensaje>,
    miId,
  );

  const amigos =
    filtro === "amigos"
      ? await leerAmigos(supabase, miId, hilos.map((h) => h.personaId))
      : null;

  const filas: FilaDeBandeja[] = hilos.map((hilo) => {
    const ultimo = ultimoPorConversacion.get(hilo.conversacionPrincipalId) ?? null;
    return {
      ...hilo,
      resumen: ultimo ? resumirMensaje(ultimo) : null,
      noLeidos: noLeidosDelHilo(hilo.conversacionIds, noLeidos),
      /**
       * HOY SIEMPRE FALSO, y no es un bug de esta pantalla: `conversation_reads`
       * (0137) tiene la policy `profile_id = auth.uid()`, así que la marca de
       * lectura de la OTRA persona no es legible — que es exactamente lo que
       * haría falta para el tilde. La fila ya sabe pintarlo; lo que falta es una
       * fuente que pueda decirlo sin abrir la marca ajena (una RPC que devuelva
       * sólo el booleano). Se deja cableado en vez de borrado porque el día que
       * exista esa fuente, esto es una línea.
       */
      leidoPorElOtro: fueLeidoPorElOtro(
        ultimo,
        miId,
        ajenas.get(hilo.conversacionPrincipalId) ?? null,
      ),
      esAmigo: amigos ? amigos.has(hilo.personaId) : null,
    };
  });

  const filtradas =
    filtro === "amigos"
      ? filas.filter((fila) => fila.esAmigo === true)
      : filtro === "no-leidos"
        ? filas.filter((fila) => fila.noLeidos > 0)
        : filas;

  const totalNoLeidos = filas.reduce((suma, fila) => suma + fila.noLeidos, 0);

  return { filas: filtradas, totalNoLeidos, hayLecturas };
}

/* ========================================================================== */
/* Solicitudes                                                                */
/* ========================================================================== */

export type SolicitudPendiente = {
  conversationId: string;
  personaId: string;
  nombre: string;
  avatarUrl: string | null;
  avisoTitulo: string | null;
  creadaEn: string;
  /** Lo primero que escribió, si escribió algo antes de que aceptaras. */
  primerMensaje: string | null;
};

/**
 * Cuántas solicitudes esperan una respuesta MÍA. Es `head: true`: la pestaña
 * necesita el número, no las filas.
 *
 * Nunca lanza: un contador caído dibuja la pestaña sin globito. Que el badge
 * falle no puede dejar sin navegación a la bandeja entera.
 */
export async function contarSolicitudesPendientes(miId: string): Promise<number> {
  try {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("counterpart_id", miId)
      .eq("status", "pending");
    if (error || typeof count !== "number") return 0;
    return count;
  } catch {
    return 0;
  }
}

/** Las solicitudes recibidas, de la más nueva a la más vieja. */
export async function leerSolicitudes(miId: string): Promise<SolicitudPendiente[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("conversations")
    .select(
      `id, created_at, created_by,
       listing:listings(id, title),
       creator:profiles!conversations_created_by_fkey(id, display_name, avatar_url)`,
    )
    .eq("counterpart_id", miId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.warn("[mensajes] no se pudieron leer las solicitudes", { code: error.code });
    return [];
  }

  const filas = (data ?? []) as unknown as {
    id: string;
    created_at: string;
    created_by: string;
    listing: { id: string; title: string } | null;
    creator: { id: string; display_name: string; avatar_url: string | null } | null;
  }[];

  if (filas.length === 0) return [];

  // El primer mensaje de cada solicitud en UNA consulta, no una por fila. Puede
  // no haber ninguno: hasta que se acepta, el hilo suele estar vacío.
  const { data: mensajesData } = await supabase
    .from("messages")
    .select("conversation_id, body, created_at")
    .in(
      "conversation_id",
      filas.map((fila) => fila.id),
    )
    .order("created_at", { ascending: true })
    .limit(200);

  const primero = new Map<string, string>();
  for (const mensaje of (mensajesData ?? []) as { conversation_id: string; body: string }[]) {
    if (!primero.has(mensaje.conversation_id)) {
      primero.set(mensaje.conversation_id, mensaje.body);
    }
  }

  return filas.map((fila) => ({
    conversationId: fila.id,
    personaId: fila.creator?.id ?? fila.created_by,
    nombre: fila.creator?.display_name ?? "Miembro de la comunidad",
    avatarUrl: fila.creator?.avatar_url ?? null,
    avisoTitulo: fila.listing?.title ?? null,
    creadaEn: fila.created_at,
    primerMensaje: primero.get(fila.id) ?? null,
  }));
}
