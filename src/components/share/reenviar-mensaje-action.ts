"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { supabaseSinTiparGrupos } from "@/lib/messaging/grupos";
import {
  CHAT_MEDIA_BUCKET,
  KINDS_DE_MENSAJE,
  rutaDeAdjunto,
} from "@/lib/messaging/adjuntos";
import { COMPARTIDO_KINDS } from "./enlace-interno";

export type ReenviarMensajeResult =
  | { ok: true; enviados: number; fallidos: number }
  | {
      ok: false;
      code:
        | "unauthenticated"
        | "tenant-mismatch"
        | "invalid"
        | "rate-limited"
        | "forbidden"
        | "error";
    };

const DestinoSchema = z.object({
  tipo: z.enum(["persona", "grupo"]),
  id: z.uuid(),
});

const ReenviarSchema = z.object({
  origen: z.object({
    ambito: z.enum(["directo", "grupo"]),
    mensajeId: z.uuid(),
    hiloId: z.uuid(),
  }),
  destinos: z.array(DestinoSchema).min(1).max(12),
});

const MensajeFuenteSchema = z.object({
  kind: z.enum(KINDS_DE_MENSAJE),
  body: z.string().max(2000),
  adjunto: z.record(z.string(), z.unknown()).nullable(),
  ubicacion: z
    .object({
      lat: z.number().finite().min(-90).max(90),
      lng: z.number().finite().min(-180).max(180),
      etiqueta: z.string().max(120).optional(),
    })
    .nullable(),
  compartido_kind: z.enum(COMPARTIDO_KINDS).nullable(),
  compartido_id: z.uuid().nullable(),
  deleted_at: z.null(),
});

type Destino = z.infer<typeof DestinoSchema>;
type MensajeFuente = z.infer<typeof MensajeFuenteSchema>;

export interface ReenviarMensajeInput {
  origen: {
    ambito: "directo" | "grupo";
    mensajeId: string;
    hiloId: string;
  };
  destinos: Destino[];
}

export async function reenviarMensajeAction(
  input: ReenviarMensajeInput,
): Promise<ReenviarMensajeResult> {
  const parsed = ReenviarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { ok: false, code: "unauthenticated" };
    if (guard.reason === "tenant-mismatch") return { ok: false, code: "tenant-mismatch" };
    return { ok: false, code: "error" };
  }

  const { tenant, user } = guard;
  const supabase = supabaseSinTiparGrupos(guard.supabase);
  const { origen } = parsed.data;
  const tablaOrigen = origen.ambito === "grupo" ? "chat_group_messages" : "messages";
  const columnaHilo = origen.ambito === "grupo" ? "group_id" : "conversation_id";
  const { data, error } = await supabase
    .from(tablaOrigen)
    .select("kind, body, adjunto, ubicacion, compartido_kind, compartido_id, deleted_at")
    .eq("id", origen.mensajeId)
    .eq(columnaHilo, origen.hiloId)
    .eq("tenant_id", tenant.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.warn("[reenviar] no se pudo leer el mensaje origen", { code: error.code });
    return { ok: false, code: "error" };
  }

  const fuente = MensajeFuenteSchema.safeParse(data);
  if (!fuente.success) return { ok: false, code: data ? "error" : "forbidden" };
  const mensajeFuente = fuente.data;
  let adjunto = mensajeFuente.adjunto;

  if (adjunto !== null && typeof adjunto.path === "string") {
    const pathNuevo =
      typeof adjunto.mime === "string"
        ? rutaDeAdjunto(tenant.id, user.id, adjunto.mime, crypto.randomUUID())
        : null;
    if (!pathNuevo) return { ok: false, code: "error" };

    const { error: copyError } = await supabase.storage
      .from(CHAT_MEDIA_BUCKET)
      .copy(adjunto.path, pathNuevo);
    if (copyError) return { ok: false, code: "error" };

    adjunto = { ...adjunto, path: pathNuevo };
  }

  const mensaje = { ...mensajeFuente, adjunto };

  const destinos = [
    ...new Map(
      parsed.data.destinos.map((destino) => [`${destino.tipo}:${destino.id}`, destino]),
    ).values(),
  ];

  for (let i = 0; i < destinos.length; i += 1) {
    if (!limit(`mensaje:${user.id}`, 120, HOUR_MS).ok) {
      return { ok: false, code: "rate-limited" };
    }
  }

  const conversacionesTocadas = new Set<string>();
  const gruposTocados = new Set<string>();

  function filaDeMensaje(destino: Record<string, string>, mensaje: MensajeFuente) {
    return {
      tenant_id: tenant.id,
      sender_id: user.id,
      ...destino,
      kind: mensaje.kind,
      body: mensaje.body,
      adjunto: mensaje.adjunto,
      ubicacion: mensaje.ubicacion,
      compartido_kind: mensaje.compartido_kind,
      compartido_id: mensaje.compartido_id,
    };
  }

  async function insertar(tabla: string, destino: Record<string, string>) {
    const { error: insertError } = await supabase
      .from(tabla)
      .insert(filaDeMensaje(destino, mensaje));
    if (!insertError) return true;
    console.warn("[reenviar] un destino rechazó el mensaje", {
      tabla,
      code: insertError.code,
    });
    return false;
  }

  async function enviarA(destino: Destino): Promise<boolean> {
    if (destino.tipo === "grupo") {
      const ok = await insertar("chat_group_messages", { group_id: destino.id });
      if (ok) gruposTocados.add(destino.id);
      return ok;
    }

    const { data: conversationId, error: rpcError } = await supabase.rpc(
      "solicitar_contacto_directo",
      { p_profile_id: destino.id },
    );
    if (rpcError || typeof conversationId !== "string" || !conversationId) return false;
    const ok = await insertar("messages", { conversation_id: conversationId });
    if (ok) conversacionesTocadas.add(conversationId);
    return ok;
  }

  let enviados = 0;
  for (const destino of destinos) {
    try {
      if (await enviarA(destino)) enviados += 1;
    } catch {
      console.warn("[reenviar] un destino no salió", {
        tipo: destino.tipo,
      });
    }
  }

  if (enviados === 0) return { ok: false, code: "error" };

  revalidatePath("/mensajes");
  for (const id of conversacionesTocadas) revalidatePath(`/mensajes/${id}`);
  for (const id of gruposTocados) revalidatePath(`/mensajes/grupos/${id}`);

  return { ok: true, enviados, fallidos: destinos.length - enviados };
}
