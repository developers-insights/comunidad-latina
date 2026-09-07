"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/notify";
import {
  CHAT_MEDIA_BUCKET,
  MAX_ADJUNTOS_POR_ENVIO,
  MAX_PIE_DE_ADJUNTO,
  esRutaPropiaDeAdjunto,
  rutaDeAdjunto,
  supabaseSinTiparMensajes,
  validarAdjunto,
  type Adjunto,
} from "@/lib/messaging/adjuntos";
import { esOndaValida } from "@/lib/messaging/audio";

/**
 * =============================================================================
 * SERVER ACTIONS DE ADJUNTOS DEL CHAT (0136 + 0140)
 * =============================================================================
 *
 * Un mensaje deja de ser texto: puede ser una foto, un video, una nota de voz,
 * un archivo, un punto en el mapa o la tarjeta del propio perfil. Las tres
 * acciones de acá son el ÚNICO camino por el que eso entra a la base.
 *
 * ─── EL REPARTO DE TRABAJO ENTRE EL NAVEGADOR Y ACÁ ─────────────────────────
 *
 *   1. `prepararAdjuntosAction` — el navegador dice QUÉ tipo de archivo va a
 *      subir y recibe la RUTA ya armada. El cliente nunca inventa un path: el
 *      prefijo `{tenant}/{user}` sale del guard y del JWT, igual que en
 *      `prepareMediaUploadAction` del feed, y acá además el nombre del archivo
 *      también, así que no queda ni un carácter de la ruta bajo su control.
 *   2. El navegador sube DIRECTO al bucket por XHR (el body de una server
 *      action tiene techo y un video de 25 MB no entra). La policy
 *      `chat_media_insert` (0140) revalida el prefijo contra el JWT.
 *   3. `enviarAdjuntoAction` — recibe el path de vuelta y lo VUELVE A VALIDAR
 *      antes de persistirlo. Que el paso 1 lo haya emitido no prueba que el
 *      paso 3 esté recibiendo el mismo: en el medio hubo un viaje por el
 *      cliente.
 *   4. `firmarAdjuntosAction` — el bucket es privado, así que ver un archivo es
 *      pedir una URL firmada. Se firma con el CLIENTE DEL USUARIO, nunca con el
 *      admin: la 0140 resolvió la lectura con una policy justamente para que
 *      decida la RLS de la tabla de mensajes. Firmar con service_role sería
 *      tirar esa decisión a la basura y volver a un bucket público con pasos
 *      extra.
 *
 * Como el resto del módulo: la RLS es la frontera real, todo pasa por el
 * cliente del usuario, y el admin client aparece SÓLO para emitir
 * notificaciones (`notifications` tiene `insert with check (false)` para JWT de
 * usuario).
 */

export type AdjuntoActionResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "unauthenticated"
        | "tenant-mismatch"
        | "invalid"
        | "forbidden"
        | "flagged"
        | "rate-limited"
        /** El tipo de archivo no se acepta (§TIPOS_DE_ADJUNTO). */
        | "tipo"
        /** Pesa más de lo que el chat admite para ese tipo. */
        | "peso"
        | "error";
      message?: string;
    };

/* -------------------------------------------------------------------------- */
/* 1 · Preparar la subida                                                     */
/* -------------------------------------------------------------------------- */

const prepararSchema = z.object({
  mimes: z.array(z.string().min(3).max(120)).min(1).max(MAX_ADJUNTOS_POR_ENVIO),
});

export type PrepararAdjuntosResult =
  | { ok: true; rutas: { mime: string; path: string }[] }
  | { ok: false; code: "unauthenticated" | "tenant-mismatch" | "invalid" | "tipo" | "error"; message?: string };

/**
 * Devuelve una ruta por cada tipo pedido, EN EL MISMO ORDEN.
 *
 * Corre el guard antes de tocar nada: sin esto, un tenant-mismatch se
 * descubriría recién al subir, después de gastar el intento de Storage — el
 * mismo bug que el docblock de `requireTenantMatch` cuenta del composer del
 * feed.
 */
export async function prepararAdjuntosAction(input: {
  mimes: string[];
}): Promise<PrepararAdjuntosResult> {
  const parsed = prepararSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { ok: false, code: "unauthenticated" };
    if (guard.reason === "tenant-mismatch") {
      return { ok: false, code: "tenant-mismatch", message: guard.message };
    }
    return { ok: false, code: "error" };
  }

  const rutas: { mime: string; path: string }[] = [];
  for (const mime of parsed.data.mimes) {
    const path = rutaDeAdjunto(guard.tenant.id, guard.user.id, mime, crypto.randomUUID());
    if (!path) return { ok: false, code: "tipo" };
    rutas.push({ mime, path });
  }
  return { ok: true, rutas };
}

/* -------------------------------------------------------------------------- */
/* 2 · Enviar el mensaje que referencia lo subido                             */
/* -------------------------------------------------------------------------- */

const destinoSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("directo"), conversationId: z.uuid() }),
  z.object({ tipo: z.literal("grupo"), groupId: z.uuid() }),
]);

const pieSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.string().max(MAX_PIE_DE_ADJUNTO));

const contenidoSchema = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("archivo"),
    path: z.string().min(5).max(300),
    mime: z.string().min(3).max(120),
    bytes: z.number().int().positive(),
    nombre: z.string().max(200).optional(),
    ancho: z.number().int().positive().max(20_000).optional(),
    alto: z.number().int().positive().max(20_000).optional(),
    duracion_ms: z.number().int().nonnegative().max(6 * 60 * 60 * 1000).optional(),
    onda: z.array(z.number()).max(128).optional(),
    pie: pieSchema.optional(),
  }),
  z.object({
    tipo: z.literal("ubicacion"),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    etiqueta: z.string().max(120).optional(),
  }),
  /**
   * La tarjeta de perfil NO recibe id: se arma con el del JWT. "Mi perfil" sólo
   * puede ser el propio, y aceptar un id sería convertir el botón en un
   * compartidor de perfiles ajenos sin pedirlo nadie.
   */
  z.object({ tipo: z.literal("perfil") }),
]);

const enviarSchema = z.object({
  destino: destinoSchema,
  contenido: contenidoSchema,
});

export type DestinoDeAdjunto = z.infer<typeof destinoSchema>;
export type ContenidoDeAdjunto = z.infer<typeof contenidoSchema>;

/**
 * ~11 m de precisión. Suficiente para "estoy en esta esquina" y bastante menos
 * de lo que entrega el GPS: la coordenada cruda dice en qué parte del edificio
 * está la persona, y eso no lo pidió nadie. Mismo criterio que
 * `lib/zona/centroides.ts`, con un decimal más porque acá el punto SE MANDA a
 * propósito y tiene que servir para encontrarse.
 */
function redondearCoordenada(valor: number): number {
  return Math.round(valor * 10_000) / 10_000;
}

export async function enviarAdjuntoAction(input: {
  destino: DestinoDeAdjunto;
  contenido: ContenidoDeAdjunto;
}): Promise<AdjuntoActionResult> {
  const parsed = enviarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const { destino, contenido } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { ok: false, code: "unauthenticated" };
    if (guard.reason === "tenant-mismatch") {
      return { ok: false, code: "tenant-mismatch", message: guard.message };
    }
    return { ok: false, code: "error" };
  }
  const { tenant, supabase, user } = guard;

  /**
   * EL MISMO BUCKET `mensaje:<uid>` que el texto y que los grupos, a propósito.
   * Si los adjuntos tuvieran el suyo, el techo real por persona sería el doble
   * y mandar diez fotos sería la forma de esquivar el límite de mensajes.
   */
  if (!limit(`mensaje:${user.id}`, 120, HOUR_MS).ok) {
    return { ok: false, code: "rate-limited" };
  }

  let kind: string;
  let adjunto: Adjunto | null = null;
  let ubicacion: { lat: number; lng: number; etiqueta?: string } | null = null;
  let compartidoKind: string | null = null;
  let compartidoId: string | null = null;
  let body = "";

  if (contenido.tipo === "archivo") {
    // El path viajó por el cliente: que lo haya emitido `prepararAdjuntosAction`
    // no prueba que sea el mismo que volvió. Sin esta línea, un mensaje puede
    // apuntar al archivo de otra persona y la policy de lectura de la 0140 —que
    // habilita todo objeto referenciado por un mensaje visible— lo convertiría
    // en la llave para leerlo.
    if (!esRutaPropiaDeAdjunto(contenido.path, tenant.id, user.id)) {
      return { ok: false, code: "forbidden" };
    }

    const validacion = validarAdjunto({ mime: contenido.mime, bytes: contenido.bytes });
    if (!validacion.ok) {
      return { ok: false, code: validacion.motivo === "peso" ? "peso" : "tipo" };
    }
    kind = validacion.kind;

    if (contenido.onda !== undefined) {
      // La onda se pinta tal cual venga: un arreglo con un número fuera de
      // rango dibuja una barra que se sale de la burbuja en el teléfono de otra
      // persona, y ningún CHECK de la 0136 mira adentro del jsonb.
      if (!esOndaValida(contenido.onda)) {
        return { ok: false, code: "invalid" };
      }
    }

    adjunto = {
      path: contenido.path,
      mime: validacion.mime,
      bytes: contenido.bytes,
      ...(contenido.nombre ? { nombre: contenido.nombre.slice(0, 200) } : {}),
      ...(contenido.ancho ? { ancho: contenido.ancho } : {}),
      ...(contenido.alto ? { alto: contenido.alto } : {}),
      ...(contenido.duracion_ms !== undefined ? { duracion_ms: contenido.duracion_ms } : {}),
      ...(contenido.onda ? { onda: contenido.onda } : {}),
    };
    body = contenido.pie ?? "";
  } else if (contenido.tipo === "ubicacion") {
    kind = "ubicacion";
    ubicacion = {
      lat: redondearCoordenada(contenido.lat),
      lng: redondearCoordenada(contenido.lng),
      ...(contenido.etiqueta?.trim() ? { etiqueta: contenido.etiqueta.trim() } : {}),
    };
  } else {
    kind = "perfil";
    compartidoKind = "profile";
    compartidoId = user.id;
  }

  // El pie de una foto es texto que otra persona va a leer: pasa por la misma
  // moderación que un mensaje. Sin pie, `moderateText` devuelve `skipped` sin
  // llamar a nadie, así que no cuesta nada.
  if (body.length > 0) {
    const moderacion = await moderateText(body);
    if (moderacion.flagged) return { ok: false, code: "flagged" };
  }

  const sinTipar = supabaseSinTiparMensajes(supabase);

  const fila = {
    tenant_id: tenant.id,
    sender_id: user.id,
    body,
    kind,
    adjunto,
    ubicacion,
    compartido_kind: compartidoKind,
    compartido_id: compartidoId,
  };

  if (destino.tipo === "grupo") {
    const { error } = await sinTipar
      .from("chat_group_messages")
      .insert({ ...fila, group_id: destino.groupId });
    if (error) {
      console.warn("[mensajes] no se pudo enviar el adjunto al grupo", { code: error.code });
      return { ok: false, code: error.code === "42501" ? "forbidden" : "error" };
    }
    await avisar({
      tenantId: tenant.id,
      autorId: user.id,
      supabase: sinTipar,
      destino,
      kind,
    });
    revalidatePath(`/mensajes/grupos/${destino.groupId}`);
    return { ok: true };
  }

  // La conversación sólo es visible para sus participantes (RLS): leerla valida
  // la membresía y, de paso, el estado. Un chat pendiente o bloqueado no recibe
  // fotos, igual que no recibe texto.
  const { data: conversacion, error: errorConversacion } = await sinTipar
    .from("conversations")
    .select("id, tenant_id, status, created_by, counterpart_id")
    .eq("id", destino.conversationId)
    .maybeSingle();
  if (errorConversacion || !conversacion) return { ok: false, code: "forbidden" };
  if (conversacion.status !== "accepted") return { ok: false, code: "forbidden" };

  const { error } = await sinTipar
    .from("messages")
    .insert({ ...fila, tenant_id: conversacion.tenant_id, conversation_id: destino.conversationId });
  if (error) {
    console.warn("[mensajes] no se pudo enviar el adjunto", { code: error.code });
    return { ok: false, code: error.code === "42501" ? "forbidden" : "error" };
  }

  await avisar({
    tenantId: conversacion.tenant_id,
    autorId: user.id,
    supabase: sinTipar,
    destino,
    kind,
    destinatarioId:
      conversacion.created_by === user.id
        ? conversacion.counterpart_id
        : conversacion.created_by,
  });

  revalidatePath(`/mensajes/${destino.conversationId}`);
  revalidatePath("/mensajes");
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* 3 · Firmar lo que ya está guardado                                         */
/* -------------------------------------------------------------------------- */

const firmarSchema = z.object({
  paths: z.array(z.string().min(5).max(300)).min(1).max(60),
});

/**
 * Una hora. Corta para que una URL reenviada por WhatsApp deje de servir el
 * mismo día, y larga para que nadie vea un audio caducarse mientras lo escucha.
 *
 * ⚠️ Una URL firmada vale hasta que vence PASE LO QUE PASE: si el mensaje se
 * baja o lo barre el TTL de 90 días, la firma ya emitida sigue abriendo el
 * archivo. Ese es el motivo real del techo bajo, no el ahorro.
 */
const VIGENCIA_DE_FIRMA_S = 60 * 60;

export type FirmasResult =
  | { ok: true; urls: Record<string, string> }
  | { ok: false; code: "unauthenticated" | "invalid" | "error" };

/**
 * URLs firmadas para los adjuntos que la pantalla va a pintar.
 *
 * En LOTE y no de a una: un hilo con veinte fotos serían veinte viajes al
 * servidor, que es el N+1 que el resto del repo evita.
 *
 * Se firma con `guard.supabase` —el cliente del USUARIO— porque la 0140 §1
 * resolvió la lectura con una policy: el `exists` sobre `messages` corre con
 * los permisos de quien pregunta, así que la RLS de la tabla de mensajes es la
 * que decide. Un path de un chat ajeno simplemente no se firma, y la respuesta
 * lo omite en vez de fallar entera.
 */
export async function firmarAdjuntosAction(input: {
  paths: string[];
}): Promise<FirmasResult> {
  const parsed = firmarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const guard = await requireTenantMatch();
  // Firmar es LECTURA: un tenant-mismatch no la bloquea (el guard sólo cierra
  // escrituras), pero sin sesión no hay nada que firmar.
  if (!guard.user) return { ok: false, code: "unauthenticated" };

  const unicos = [...new Set(parsed.data.paths)];
  const { data, error } = await guard.supabase.storage
    .from(CHAT_MEDIA_BUCKET)
    .createSignedUrls(unicos, VIGENCIA_DE_FIRMA_S);

  if (error || !data) {
    console.warn("[mensajes] no se pudieron firmar los adjuntos", {
      message: error?.message,
    });
    return { ok: false, code: "error" };
  }

  const urls: Record<string, string> = {};
  for (const item of data) {
    if (item.signedUrl && item.path) urls[item.path] = item.signedUrl;
  }
  return { ok: true, urls };
}

/* -------------------------------------------------------------------------- */

/**
 * Aviso de mensaje nuevo. Best-effort de punta a punta: el mensaje YA se
 * entregó, así que nada de acá puede cambiar el resultado de la acción.
 *
 * SIN EMAIL, al revés que `sendMessageAction`. Mandar diez fotos son diez
 * llamadas a esta función, y aunque `dedupeUnread` corta la avalancha de
 * notificaciones, un correo por tanda de fotos es ruido que el texto ya cubrió:
 * quien manda fotos casi siempre acaba de escribir algo.
 *
 * PRIVACIDAD: el cuerpo NUNCA dice qué se mandó más allá del tipo. La bandeja
 * se ve en pantallas compartidas y de costado.
 */
async function avisar(params: {
  tenantId: string;
  autorId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  destino: DestinoDeAdjunto;
  kind: string;
  destinatarioId?: string;
}): Promise<void> {
  try {
    const { data: autor } = await params.supabase
      .from("profiles")
      .select("display_name")
      .eq("id", params.autorId)
      .maybeSingle();
    const nombre: string = autor?.display_name ?? "Alguien de la comunidad";
    const admin = createAdminClient();

    const titulo =
      params.kind === "audio"
        ? `${nombre} te mandó una nota de voz`
        : params.kind === "ubicacion"
          ? `${nombre} compartió su ubicación`
          : `${nombre} te mandó un archivo`;

    if (params.destino.tipo === "directo" && params.destinatarioId) {
      await createNotification(admin, {
        tenantId: params.tenantId,
        profileId: params.destinatarioId,
        kind: "message",
        category: "mensajes",
        title: titulo,
        body: "Abrí la conversación para verlo.",
        href: `/mensajes/${params.destino.conversationId}`,
        dedupeUnread: true,
      });
      return;
    }

    if (params.destino.tipo === "grupo") {
      const { data: miembros } = await params.supabase
        .from("chat_group_members")
        .select("profile_id")
        .eq("group_id", params.destino.groupId)
        .order("joined_at", { ascending: true })
        .limit(50);
      const href = `/mensajes/grupos/${params.destino.groupId}`;
      for (const miembro of (miembros ?? []) as { profile_id: string }[]) {
        if (miembro.profile_id === params.autorId) continue;
        await createNotification(admin, {
          tenantId: params.tenantId,
          profileId: miembro.profile_id,
          kind: "message",
          category: "mensajes",
          title: titulo,
          body: "Abrí el grupo para verlo.",
          href,
          dedupeUnread: true,
        });
      }
    }
  } catch (error) {
    console.warn(
      "[mensajes] no se pudo avisar del adjunto:",
      error instanceof Error ? error.message : "error desconocido",
    );
  }
}
