import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "./notify";
import {
  KIND_SOLICITUD,
  KIND_SOLICITUD_ACEPTADA,
  chatHref,
  estadoDeSolicitud,
  type SolicitudDelAviso,
} from "./solicitud";

type Cliente = SupabaseClient<Database>;

export type FilaConEntidad = {
  id: string;
  kind: string;
  entity_type: string | null;
  entity_id: string | null;
};

const NOMBRE_DE_RESPALDO = "Alguien de la comunidad";

/**
 * Estado VIVO de las solicitudes que aparecen en una lista de avisos, en una
 * sola consulta. Lo vivo manda sobre lo que dice el aviso: si ya se aceptó desde
 * Mensajes o desde otro dispositivo, la fila no vuelve a ofrecer los botones.
 */
export async function leerSolicitudesDeAvisos(
  supabase: Cliente,
  miId: string,
  filas: FilaConEntidad[],
): Promise<Map<string, SolicitudDelAviso>> {
  const porConversacion = new Map<string, string[]>();
  for (const fila of filas) {
    if (fila.kind !== KIND_SOLICITUD || fila.entity_type !== "conversation" || !fila.entity_id) {
      continue;
    }
    const ids = porConversacion.get(fila.entity_id) ?? [];
    ids.push(fila.id);
    porConversacion.set(fila.entity_id, ids);
  }

  const resultado = new Map<string, SolicitudDelAviso>();
  if (porConversacion.size === 0) return resultado;

  const { data, error } = await supabase
    .from("conversations")
    .select(
      `id, status, created_by, counterpart_id,
       creator:profiles!conversations_created_by_fkey(id, display_name, avatar_url)`,
    )
    .in("id", [...porConversacion.keys()]);

  if (error) {
    console.warn("[notificaciones] no se pudo leer el estado de las solicitudes", {
      code: error.code,
    });
    return resultado;
  }

  const conversaciones = (data ?? []) as unknown as {
    id: string;
    status: string;
    created_by: string;
    counterpart_id: string;
    creator: { id: string; display_name: string | null; avatar_url: string | null } | null;
  }[];

  for (const conversacion of conversaciones) {
    const estado =
      conversacion.counterpart_id === miId
        ? estadoDeSolicitud(conversacion.status)
        : "no_disponible";
    const solicitud: SolicitudDelAviso = {
      conversationId: conversacion.id,
      estado,
      actor: {
        id: conversacion.creator?.id ?? conversacion.created_by,
        nombre: conversacion.creator?.display_name?.trim() || NOMBRE_DE_RESPALDO,
        avatarUrl: conversacion.creator?.avatar_url ?? null,
      },
    };
    for (const notificationId of porConversacion.get(conversacion.id) ?? []) {
      resultado.set(notificationId, solicitud);
    }
  }

  return resultado;
}

/**
 * Idempotente por conversación, no por "no leído": quien toca "Enviar mensaje"
 * cinco veces sobre la misma solicitud pendiente no puede generarle cinco avisos
 * a la otra persona, aunque ella ya haya leído el primero.
 */
async function yaAvisado(
  admin: Cliente,
  destinatarioId: string,
  kind: string,
  conversationId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("notifications")
    .select("id")
    .eq("profile_id", destinatarioId)
    .eq("kind", kind)
    .eq("entity_type", "conversation")
    .eq("entity_id", conversationId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[notificaciones] chequeo de aviso previo falló; se avisa igual", {
      code: error.code,
    });
    return false;
  }
  return data !== null;
}

export async function avisarSolicitudDeContacto(
  admin: Cliente,
  input: {
    tenantId: string;
    destinatarioId: string;
    conversationId: string;
    nombreDeQuienPide: string | null;
  },
): Promise<void> {
  if (await yaAvisado(admin, input.destinatarioId, KIND_SOLICITUD, input.conversationId)) {
    return;
  }
  const nombre = input.nombreDeQuienPide?.trim() || NOMBRE_DE_RESPALDO;
  const resultado = await createNotification(admin, {
    tenantId: input.tenantId,
    profileId: input.destinatarioId,
    kind: KIND_SOLICITUD,
    category: "mensajes",
    priority: "high",
    title: `${nombre} quiere hablar con vos`,
    body: "Si confirmás, van a poder escribirse.",
    href: "/mensajes/solicitudes",
    entity: { type: "conversation", id: input.conversationId },
  });
  if (!resultado.ok) {
    console.warn("[notificaciones] no se pudo avisar la solicitud de contacto");
  }
}

async function miNombre(supabase: Cliente, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();
  return data?.display_name ?? null;
}

/**
 * La RPC `solicitar_contacto_directo` devuelve el mismo id para una charla ya
 * aceptada, para una pendiente de la otra persona hacia mí y para una recién
 * creada. Sólo la última —o una pendiente mía que todavía no se avisó— merece
 * aviso; por eso se mira la fila y no el resultado de la RPC.
 */
export async function avisarSolicitudNueva(
  supabase: Cliente,
  input: { userId: string; conversationId: string },
): Promise<void> {
  try {
    const [{ data: conversacion, error }, nombre] = await Promise.all([
      supabase
        .from("conversations")
        .select("id, tenant_id, status, created_by, counterpart_id")
        .eq("id", input.conversationId)
        .maybeSingle(),
      miNombre(supabase, input.userId),
    ]);
    if (error || !conversacion) {
      console.warn("[notificaciones] no se pudo leer la solicitud recién creada", {
        code: error?.code,
      });
      return;
    }
    if (conversacion.status !== "pending" || conversacion.created_by !== input.userId) return;

    await avisarSolicitudDeContacto(createAdminClient(), {
      tenantId: conversacion.tenant_id,
      destinatarioId: conversacion.counterpart_id,
      conversationId: conversacion.id,
      nombreDeQuienPide: nombre,
    });
  } catch (error) {
    console.warn("[notificaciones] aviso de solicitud nueva falló", {
      message: error instanceof Error ? error.message : "error desconocido",
    });
  }
}

export async function avisarAceptacion(
  supabase: Cliente,
  input: { userId: string; tenantId: string; solicitanteId: string; conversationId: string },
): Promise<void> {
  try {
    const nombre = await miNombre(supabase, input.userId);
    await avisarSolicitudAceptada(createAdminClient(), {
      tenantId: input.tenantId,
      solicitanteId: input.solicitanteId,
      conversationId: input.conversationId,
      nombreDeQuienAcepta: nombre,
    });
  } catch (error) {
    console.warn("[notificaciones] aviso de solicitud aceptada falló", {
      message: error instanceof Error ? error.message : "error desconocido",
    });
  }
}

export async function avisarSolicitudAceptada(
  admin: Cliente,
  input: {
    tenantId: string;
    solicitanteId: string;
    conversationId: string;
    nombreDeQuienAcepta: string | null;
  },
): Promise<void> {
  if (
    await yaAvisado(admin, input.solicitanteId, KIND_SOLICITUD_ACEPTADA, input.conversationId)
  ) {
    return;
  }
  const nombre = input.nombreDeQuienAcepta?.trim() || NOMBRE_DE_RESPALDO;
  const resultado = await createNotification(admin, {
    tenantId: input.tenantId,
    profileId: input.solicitanteId,
    kind: KIND_SOLICITUD_ACEPTADA,
    category: "mensajes",
    title: `${nombre} aceptó tu solicitud`,
    body: "Ya le podés escribir.",
    href: chatHref(input.conversationId),
    // La respuesta a algo que la persona pidió: silenciar Mensajes no significa
    // "no me digas si me aceptaron".
    ignorePrefs: true,
    entity: { type: "conversation", id: input.conversationId },
  });
  if (!resultado.ok) {
    console.warn("[notificaciones] no se pudo avisar que la solicitud fue aceptada");
  }
}
