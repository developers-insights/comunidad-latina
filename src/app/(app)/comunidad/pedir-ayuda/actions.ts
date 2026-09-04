"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DAY_MS, limit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";
import { requireTenantMatch } from "@/lib/tenant/guard";
import {
  COMUNIDAD_COPY,
  HELP_AREA_MAX,
  HELP_AREA_MIN,
  HELP_BODY_MAX,
  HELP_BODY_MIN,
  HELP_DIRECTION_DEFAULT,
  HELP_REPLY_MAX,
  HELP_REPLY_MIN,
  HELP_STATUSES,
  HELP_TITLE_MAX,
  HELP_TITLE_MIN,
  HELP_TOPICS,
  isHelpStatus,
  primerDatoDeContacto,
  puedeTransicionar,
  supabaseSinTiparComunidad,
  type HelpStatus,
} from "@/lib/comunidad";
import { notifyHelpReply } from "./notify";

/**
 * =============================================================================
 * SERVER ACTIONS DEL TABLÓN "PEDIR AYUDA" (Comunidad, 0120 + 0130)
 * =============================================================================
 *
 * Cinco acciones: escribir un pedido, moverlo de estado, escribirle en privado
 * a quien lo escribió, responder en público y borrar la propia respuesta.
 *
 * Todo lo demás —quién puede, desde dónde, hacia dónde— lo decide la base
 * (policies + triggers), y acá se vuelve a chequear no por desconfianza sino
 * para poder contestar con una frase que se entienda en vez de con un error de
 * Postgres.
 *
 * ── UN PEDIDO SE PUBLICA AL TOQUE, Y ESO CAMBIÓ QUÉ HACE ESTE ARCHIVO ───────
 * En la 0120 la fila nacía `draft`, se moderaba a mano y recién después se
 * veía. La 0130 lo dio vuelta (§4 de la migración: el cliente pidió velocidad,
 * la cola humana es una sola persona, y el feed de la app ya publica texto sin
 * revisión previa). La consecuencia práctica acá es UNA y hay que verla escrita:
 *
 *   `moderateText` DEJÓ DE SER UNA CORTESÍA Y ES EL GATE.
 *
 * Antes, un texto marcado igual lo iba a leer una persona antes de publicarse,
 * así que dejarlo en borrador era suficiente. Ahora no hay nadie después: si
 * vuelve `flagged`, no hay fila. Por eso corre ANTES del insert y no después.
 *
 * Sin `OPENAI_API_KEY` (`moderation.skipped`) no bloquea nada — degradación
 * elegante §5.6 —, y lo que queda cubriendo el hueco es la moderación posterior
 * del panel y el reporte desde la pantalla.
 *
 * ── EL DETECTOR DE CONTACTO CORRE SOBRE EL PEDIDO Y NO SOBRE LA RESPUESTA ───
 * Es la asimetría deliberada del módulo y está explicada en
 * `src/lib/comunidad/pedir-ayuda.ts` y en §6 de la 0130: el número que alguien
 * pone en SU pedido es el suyo (dato personal pegado a su barrio y su
 * necesidad); el que aparece en una respuesta es el de una oficina, y pasarlo
 * es literalmente el producto que pidió el cliente.
 *
 * TENANT: siempre del guard (JWT + host), jamás de un campo del formulario.
 * =============================================================================
 */

const C = COMUNIDAD_COPY.escribirPedido;
const R = COMUNIDAD_COPY.pedirAyuda.respuestas;
const CONTACTO = COMUNIDAD_COPY.pedirAyuda.card.escribirErrores;

const RUTA = "/comunidad/pedir-ayuda";

// ===========================================================================
// 1. Escribir un pedido
// ===========================================================================

const pedidoSchema = z.object({
  topic: z.enum(HELP_TOPICS),
  title: z.string().trim().min(HELP_TITLE_MIN).max(HELP_TITLE_MAX),
  body: z.string().trim().min(HELP_BODY_MIN).max(HELP_BODY_MAX),
  areaLabel: z.string().trim().min(HELP_AREA_MIN).max(HELP_AREA_MAX),
});

export type PedidoInput = z.input<typeof pedidoSchema>;

export type PublicarPedidoResult =
  | { ok: true; pedidoId: string }
  | { ok: false; error: string; needsAuth?: boolean };

export async function publicarPedido(
  rawInput: PedidoInput,
): Promise<PublicarPedidoResult> {
  // Zod PURO primero (sin I/O): un payload roto no consume guard ni cuota.
  const parsed = pedidoSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: C.errors.generic };
  }
  const input = parsed.data;

  /**
   * El detector de datos de contacto corre ANTES de tocar la base, y es lo
   * único de esta action que le contesta al usuario con un texto distinto
   * según qué encontró. La tabla no tiene columna de teléfono a propósito: el
   * texto libre es el único agujero por el que un dato de contacto puede
   * entrar, y taparlo acá es taparlo entero.
   */
  const contacto = primerDatoDeContacto(input.title, input.body, input.areaLabel);
  if (contacto) {
    return { ok: false, error: C.errors[contacto] };
  }

  // Guard ANTES de cualquier efecto colateral (regla del repo, lib/tenant/guard).
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: C.needLogin };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`comunidad-pedido:${user.id}`, 10, DAY_MS).ok) {
    return { ok: false, error: C.errors.cupo };
  }

  // EL GATE. Ver la cabecera: acá no hay una persona después que lo lea.
  const moderation = await moderateText(`${input.title}\n${input.body}`);
  if (moderation.flagged) {
    return { ok: false, error: C.errors.moderacion };
  }

  const { data, error } = await supabaseSinTiparComunidad(supabase)
    .from("community_help_notices")
    .insert({
      tenant_id: tenant.id,
      created_by: user.id,
      direction: HELP_DIRECTION_DEFAULT,
      topic: input.topic,
      title: input.title,
      body: input.body,
      area_label: input.areaLabel,
      languages: [],
      // Nace publicado. La policy y el trigger de la 0130 lo permiten SÓLO
      // para 'draft' y 'approved': nadie puede fabricar un pedido "ya
      // rechazado" ni "ya archivado" salteándose la app.
      status: "approved",
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    console.warn("[comunidad] alta de pedido falló", { code: error?.code });
    return { ok: false, error: traducirErrorDeBase(error?.message, C.errors.generic) };
  }

  revalidatePath(RUTA);
  revalidatePath(`${RUTA}/mios`);
  return { ok: true, pedidoId: (data as { id: string }).id };
}

// ===========================================================================
// 2. Mover el pedido de estado (marcarlo resuelto)
// ===========================================================================

const estadoSchema = z.object({
  pedidoId: z.uuid(),
  hasta: z.enum(HELP_STATUSES),
});

export type CambiarEstadoResult =
  | { ok: true; estado: HelpStatus }
  | { ok: false; error: string; needsAuth?: boolean };

/**
 * Hoy hace una sola cosa —marcar un pedido como resuelto (`archived`)— pero no
 * está escrita como "resolverPedido" a propósito: la transición válida la
 * decide `puedeTransicionar(..., 'autor')`, que es el espejo del trigger, y una
 * action por transición serían N copias de la misma verificación. La lista de
 * lo permitido vive en UN lugar (`src/lib/comunidad/pedir-ayuda.ts`) y se
 * testea sola.
 *
 * `approved` y `rejected` no son alcanzables desde acá aunque lleguen en el
 * payload: no están entre las transiciones del autor. Es la tercera vez que se
 * dice lo mismo (policy, trigger, esto) y las tres son a propósito.
 */
export async function cambiarEstadoDePedido(rawInput: {
  pedidoId: string;
  hasta: string;
}): Promise<CambiarEstadoResult> {
  const parsed = estadoSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: C.errors.estado };
  }
  const { pedidoId, hasta } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: C.needLogin };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  if (!limit(`comunidad-pedido-estado:${user.id}`, 60, DAY_MS).ok) {
    return { ok: false, error: C.errors.generic };
  }

  const sinTipar = supabaseSinTiparComunidad(supabase);

  // Lectura previa: hace falta el estado ACTUAL para saber si la transición es
  // legal, y de paso convierte "no existe" y "no es tuyo" en la misma
  // respuesta — desde acá no se confirma la existencia de un pedido ajeno.
  const { data: actual, error: leerError } = await sinTipar
    .from("community_help_notices")
    .select("id, status")
    .eq("id", pedidoId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    .maybeSingle();

  if (leerError || !actual) {
    return { ok: false, error: C.errors.estado };
  }

  const desde = (actual as { status: string }).status;
  if (!isHelpStatus(desde) || !puedeTransicionar(desde, hasta, "autor")) {
    return { ok: false, error: C.errors.estado };
  }

  const { data: movido, error: moverError } = await sinTipar
    .from("community_help_notices")
    .update({ status: hasta })
    .eq("id", pedidoId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    // Vuelve a exigir el estado que se leyó: si alguien del equipo lo resolvió
    // en el medio, este UPDATE no toca nada en vez de pisar su decisión.
    .eq("status", desde)
    .select("id")
    .maybeSingle();

  if (moverError || !movido) {
    console.warn("[comunidad] cambio de estado del pedido falló", { code: moverError?.code });
    return { ok: false, error: traducirErrorDeBase(moverError?.message, C.errors.estado) };
  }

  revalidatePath(RUTA);
  revalidatePath(`${RUTA}/mios`);
  revalidatePath(`${RUTA}/${pedidoId}`);
  return { ok: true, estado: hasta };
}

// ===========================================================================
// 3. Escribirle en privado a quien pidió
// ===========================================================================

const contactoSchema = z.object({ pedidoId: z.uuid() });

export type ContactarPedidoResult =
  | { ok: true; conversationId: string }
  | { ok: false; error: string; needsAuth?: boolean };

/**
 * Abre (o recupera) la conversación privada con quien escribió el pedido.
 *
 * Sigue existiendo AL LADO de las respuestas públicas y no en su lugar: hay
 * datos que no se publican en un tablón —el nombre de alguien que te va a
 * atender, una dirección particular— y esa conversación tiene que poder pasar
 * por un canal que se puede reportar y bloquear.
 *
 * Toda la autorización vive en `public.contactar_aviso_de_ayuda` (0120): que el
 * pedido esté publicado, que sea de esta comunidad, que no sea el propio y que
 * no haya bloqueo entre las partes. Acá no se repite ninguna —se repetirían
 * mal— y sólo se traducen sus errores. La función conserva su nombre viejo:
 * renombrarla sería una migración que rompe en el deploy si el código sale
 * antes que el SQL.
 */
export async function contactarPedido(rawInput: {
  pedidoId: string;
}): Promise<ContactarPedidoResult> {
  const parsed = contactoSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: CONTACTO.generic };
  }

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: C.needLogin };
    }
    return { ok: false, error: guard.message };
  }
  const { supabase, user } = guard;

  if (!limit(`comunidad-pedido-contacto:${user.id}`, 40, DAY_MS).ok) {
    return { ok: false, error: CONTACTO.generic };
  }

  const { data, error } = await supabaseSinTiparComunidad(supabase).rpc(
    "contactar_aviso_de_ayuda",
    { p_notice: parsed.data.pedidoId },
  );

  if (error || typeof data !== "string") {
    const mensaje = error?.message ?? "";
    if (mensaje.includes("NOTICE_NOT_FOUND")) {
      return { ok: false, error: CONTACTO.noDisponible };
    }
    if (mensaje.includes("CANNOT_CONTACT_SELF")) {
      return { ok: false, error: CONTACTO.propio };
    }
    if (mensaje.includes("USER_BLOCKED")) {
      return { ok: false, error: CONTACTO.bloqueado };
    }
    if (mensaje.includes("AUTH_REQUIRED")) {
      return { ok: false, needsAuth: true, error: C.needLogin };
    }
    console.warn("[comunidad] no se pudo abrir el contacto del pedido", { code: error?.code });
    return { ok: false, error: CONTACTO.generic };
  }

  return { ok: true, conversationId: data };
}

// ===========================================================================
// 4. Responder en público
// ===========================================================================

const respuestaSchema = z.object({
  pedidoId: z.uuid(),
  body: z.string().trim().min(HELP_REPLY_MIN).max(HELP_REPLY_MAX),
});

export type ResponderResult =
  | { ok: true; respuestaId: string }
  | { ok: false; error: string; needsAuth?: boolean };

/**
 * La acción que este módulo existía para no tener.
 *
 * SIN detector de datos de contacto (ver la cabecera). Con moderación
 * automática, con cupo diario y con reporte + ocultamiento después.
 */
export async function responderPedido(rawInput: {
  pedidoId: string;
  body: string;
}): Promise<ResponderResult> {
  const parsed = respuestaSchema.safeParse(rawInput);
  if (!parsed.success) {
    const largo = (rawInput.body ?? "").trim().length;
    return { ok: false, error: largo > HELP_REPLY_MAX ? R.errors.larga : R.errors.vacia };
  }
  const { pedidoId, body } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return { ok: false, needsAuth: true, error: C.needLogin };
    }
    return { ok: false, error: guard.message };
  }
  const { tenant, supabase, user } = guard;

  // 30 respuestas por día y por persona. Es holgado para quien de verdad
  // ayuda —nadie contesta treinta pedidos en un día— y corta al que quiera
  // sembrar el mismo teléfono en todo el tablón.
  if (!limit(`comunidad-respuesta:${user.id}`, 30, DAY_MS).ok) {
    return { ok: false, error: R.errors.cupo };
  }

  const moderation = await moderateText(body);
  if (moderation.flagged) {
    return { ok: false, error: R.errors.moderacion };
  }

  const sinTipar = supabaseSinTiparComunidad(supabase);

  /**
   * Lectura previa del pedido. Hace falta para dos cosas y ninguna es
   * autorización (de eso se encarga el trigger):
   *  · contestar "ese pedido ya no está abierto" en vez de dejar que la base
   *    tire `NOTICE_NOT_FOUND` crudo;
   *  · saber a QUIÉN hay que avisarle, sin una segunda consulta después.
   */
  const { data: pedido, error: leerError } = await sinTipar
    .from("community_help_notices")
    .select("id, created_by, status, reply_count")
    .eq("id", pedidoId)
    .eq("tenant_id", tenant.id)
    .maybeSingle();

  const fila = (pedido ?? null) as
    | { id: string; created_by: string; status: string; reply_count: number | null }
    | null;

  if (leerError || !fila || fila.status !== "approved") {
    return { ok: false, error: R.errors.noDisponible };
  }

  const { data, error } = await sinTipar
    .from("community_help_replies")
    .insert({
      tenant_id: tenant.id,
      notice_id: pedidoId,
      created_by: user.id,
      body,
      status: "visible",
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    console.warn("[comunidad] alta de respuesta falló", { code: error?.code });
    const mensaje = error?.message ?? "";
    if (mensaje.includes("NOTICE_NOT_FOUND")) {
      return { ok: false, error: R.errors.noDisponible };
    }
    if (mensaje.includes("USER_BLOCKED")) {
      return { ok: false, error: R.errors.bloqueado };
    }
    if (mensaje.includes("ACCOUNT_SUSPENDED")) {
      return { ok: false, error: R.errors.suspendida };
    }
    return { ok: false, error: R.errors.generic };
  }

  // El aviso va DESPUÉS de que la fila existe y no puede desarmarla: si algo
  // falla acá adentro, la respuesta ya está publicada igual.
  await notifyHelpReply({
    tenantId: tenant.id,
    noticeId: pedidoId,
    noticeAuthorId: fila.created_by,
    actorId: user.id,
    body,
    // El contador que leímos es el de ANTES de esta respuesta: sumarle uno da
    // el número real sin volver a consultar.
    replyCount: (fila.reply_count ?? 0) + 1,
  });

  revalidatePath(`${RUTA}/${pedidoId}`);
  revalidatePath(RUTA);
  // "Mis pedidos" pinta el contador ("Ver 1 respuesta") y quien más lo mira es
  // justamente el autor que espera respuestas.
  revalidatePath(`${RUTA}/mios`);
  return { ok: true, respuestaId: (data as { id: string }).id };
}

// ===========================================================================
// 5. Borrar la propia respuesta
// ===========================================================================

const borrarSchema = z.object({ respuestaId: z.uuid() });

export type BorrarRespuestaResult = { ok: true } | { ok: false; error: string };

/**
 * "Borrar" es pasar a `deleted`: la fila se queda (§2 de la 0130). Si
 * desapareciera de la base, alguien podría dejar una respuesta dañina, esperar
 * el reporte y borrarla justo antes de que el equipo la mire.
 *
 * Quien la escribió la sigue viendo tachada en la pantalla — así "borrar" se
 * entiende como que funcionó y no como que se rompió algo.
 */
export async function borrarRespuesta(rawInput: {
  respuestaId: string;
}): Promise<BorrarRespuestaResult> {
  const parsed = borrarSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: R.errors.borrar };

  const guard = await requireTenantMatch();
  if (!guard.ok) return { ok: false, error: R.errors.borrar };
  const { tenant, supabase, user } = guard;

  const { data, error } = await supabaseSinTiparComunidad(supabase)
    .from("community_help_replies")
    .update({ status: "deleted" })
    .eq("id", parsed.data.respuestaId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    // Sólo se borra lo que está visible: de `hidden` no sale (borrar lo que el
    // equipo ocultó sería borrar la evidencia). El trigger lo vuelve a exigir.
    .eq("status", "visible")
    .select("id, notice_id")
    .maybeSingle();

  if (error || !data) {
    console.warn("[comunidad] borrado de respuesta falló", { code: error?.code });
    return { ok: false, error: R.errors.borrar };
  }

  revalidatePath(`${RUTA}/${(data as { notice_id: string }).notice_id}`);
  // El trigger baja reply_count y ese número se pinta en el tablón y en "Mis
  // pedidos": mismas rutas que revalidan las otras acciones del módulo.
  revalidatePath(RUTA);
  revalidatePath(`${RUTA}/mios`);
  return { ok: true };
}

// ===========================================================================
// Helper local (no exportado: este módulo es "use server")
// ===========================================================================

/**
 * Los `raise exception` de la 0120 y la 0130 llevan un prefijo estable
 * justamente para esto. Traducirlos acá es lo que separa "TOO_MANY_OPEN: ya
 * tenés 5 pedidos abiertos" —que es un mensaje para quien lee logs— de una
 * frase que le dice a la persona qué puede hacer al respecto.
 *
 * Lo que no se reconoce cae al mensaje por defecto: nunca se le muestra a nadie
 * el texto crudo de un error de Postgres.
 */
function traducirErrorDeBase(mensaje: string | undefined, porDefecto: string): string {
  if (!mensaje) return porDefecto;
  if (mensaje.includes("TOO_MANY_OPEN")) return C.errors.cupo;
  if (mensaje.includes("ACCOUNT_SUSPENDED")) return C.errors.suspendida;
  if (mensaje.includes("BAD_RESOURCE")) return C.errors.resource;
  if (mensaje.includes("CONTENT_FROZEN") || mensaje.includes("BAD_TRANSITION")) {
    return C.errors.estado;
  }
  return porDefecto;
}
