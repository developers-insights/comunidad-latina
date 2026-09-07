import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LLAMADA_COLUMNS,
  PARTICIPANTE_COLUMNS,
  supabaseSinTiparLlamadas,
  type LlamadaRow,
  type ParticipanteRow,
  type PersonaEnLlamada,
} from "@/lib/calls/tipos";

/**
 * Lecturas de llamadas.
 *
 * TODAS van con el cliente del usuario: la RLS de la 0139 ya deja ver sólo las
 * llamadas en las que uno está invitado, así que no hay ningún `where` de
 * seguridad escrito acá. Si alguna vez se cambia a `service_role`, hay que
 * escribir a mano todo lo que estas policies hacen gratis.
 */

type PerfilLite = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  country_origin: string | null;
};

export interface LlamadaCompleta {
  id: string;
  kind: string;
  status: string;
  groupId: string | null;
  iniciadaPor: string;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  personas: PersonaEnLlamada[];
  /** Cuántas filas tiene `call_participants`: el número contra el que corre el tope. */
  totalDeFilas: number;
  grupo: { id: string; name: string } | null;
}

async function perfilesPorId(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, PerfilLite>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url, country_origin")
    .in("id", ids);
  const filas = (data ?? []) as unknown as PerfilLite[];
  return new Map(filas.map((p) => [p.id, p]));
}

export async function getLlamada(
  supabaseCliente: SupabaseClient,
  callId: string,
): Promise<LlamadaCompleta | null> {
  const db = supabaseSinTiparLlamadas(supabaseCliente);

  const { data } = await db.from("calls").select(LLAMADA_COLUMNS).eq("id", callId).maybeSingle();
  const llamada = data as unknown as LlamadaRow | null;
  if (!llamada) return null;

  const { data: participantesData } = await db
    .from("call_participants")
    .select(PARTICIPANTE_COLUMNS)
    .eq("call_id", callId);
  const participantes = (participantesData ?? []) as unknown as ParticipanteRow[];

  const perfiles = await perfilesPorId(
    supabaseCliente,
    participantes.map((p) => p.profile_id),
  );

  let grupo: { id: string; name: string } | null = null;
  if (llamada.group_id) {
    const { data: grupoData } = await db
      .from("chat_groups")
      .select("id, name")
      .eq("id", llamada.group_id)
      .maybeSingle();
    if (grupoData) grupo = { id: String(grupoData.id), name: String(grupoData.name) };
  }

  return {
    id: llamada.id,
    kind: llamada.kind,
    status: llamada.status,
    groupId: llamada.group_id,
    iniciadaPor: llamada.iniciada_por,
    startedAt: llamada.started_at,
    endedAt: llamada.ended_at,
    createdAt: llamada.created_at,
    totalDeFilas: participantes.length,
    grupo,
    personas: participantes.map((p) => {
      const perfil = perfiles.get(p.profile_id);
      return {
        id: p.profile_id,
        displayName: perfil?.display_name ?? "Miembro de la comunidad",
        avatarUrl: perfil?.avatar_url ?? null,
        country: perfil?.country_origin ?? null,
        joinedAt: p.joined_at,
        leftAt: p.left_at,
      };
    }),
  };
}

export interface FilaDeHistorial {
  id: string;
  kind: string;
  status: string;
  iniciadaPor: string;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  grupoNombre: string | null;
  /** Con quién fue. En una de grupo, todas menos yo. */
  otros: { id: string; displayName: string; avatarUrl: string | null }[];
}

/**
 * El historial. La RLS ya lo acota a mis llamadas; el `limit` es de pantalla, no
 * de seguridad. Las llamadas se purgan solas a los 90 días (0139 §7), así que
 * esto nunca crece sin techo.
 */
export async function getHistorial(
  supabaseCliente: SupabaseClient,
  userId: string,
  tope = 40,
): Promise<FilaDeHistorial[]> {
  const db = supabaseSinTiparLlamadas(supabaseCliente);

  const { data } = await db
    .from("calls")
    .select(LLAMADA_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(tope);
  const llamadas = (data ?? []) as unknown as LlamadaRow[];
  if (llamadas.length === 0) return [];

  const { data: participantesData } = await db
    .from("call_participants")
    .select(PARTICIPANTE_COLUMNS)
    .in(
      "call_id",
      llamadas.map((l) => l.id),
    );
  const participantes = (participantesData ?? []) as unknown as ParticipanteRow[];

  const otrosIds = [
    ...new Set(participantes.map((p) => p.profile_id).filter((id) => id !== userId)),
  ];
  const perfiles = await perfilesPorId(supabaseCliente, otrosIds);

  const gruposIds = [...new Set(llamadas.map((l) => l.group_id).filter((g): g is string => !!g))];
  const nombresDeGrupo = new Map<string, string>();
  if (gruposIds.length > 0) {
    const { data: gruposData } = await db.from("chat_groups").select("id, name").in("id", gruposIds);
    for (const g of gruposData ?? []) nombresDeGrupo.set(String(g.id), String(g.name));
  }

  return llamadas.map((llamada) => ({
    id: llamada.id,
    kind: llamada.kind,
    status: llamada.status,
    iniciadaPor: llamada.iniciada_por,
    startedAt: llamada.started_at,
    endedAt: llamada.ended_at,
    createdAt: llamada.created_at,
    grupoNombre: llamada.group_id ? (nombresDeGrupo.get(llamada.group_id) ?? null) : null,
    otros: participantes
      .filter((p) => p.call_id === llamada.id && p.profile_id !== userId)
      .map((p) => {
        const perfil = perfiles.get(p.profile_id);
        return {
          id: p.profile_id,
          displayName: perfil?.display_name ?? "Miembro de la comunidad",
          avatarUrl: perfil?.avatar_url ?? null,
        };
      }),
  }));
}

export interface Candidato {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * A quién se puede sumar a esta llamada.
 *
 * Dos fuentes según de dónde salió la llamada, y ninguna es "toda la comunidad":
 * una lista con los 4.000 miembros del tenant sería un directorio para llamar a
 * desconocidos, que no es lo que la función es.
 *
 *   · Llamada de grupo → los miembros del grupo.
 *   · Llamada de a dos → la gente con la que ya tengo un chat abierto.
 *
 * Sale con quienes YA están en la llamada marcados, no filtrados: verlos
 * atenuados con "Ya está en la llamada" explica por qué no se pueden elegir
 * mejor que su ausencia.
 */
export async function getCandidatos(
  supabaseCliente: SupabaseClient,
  params: { userId: string; groupId: string | null },
  tope = 60,
): Promise<Candidato[]> {
  const db = supabaseSinTiparLlamadas(supabaseCliente);
  let ids: string[] = [];

  if (params.groupId) {
    const { data } = await db
      .from("chat_group_members")
      .select("profile_id")
      .eq("group_id", params.groupId)
      .limit(tope);
    ids = (data ?? []).map((m) => String(m.profile_id));
  } else {
    const { data } = await db
      .from("conversations")
      .select("created_by, counterpart_id")
      .eq("status", "accepted")
      .order("created_at", { ascending: false })
      .limit(tope);
    for (const c of data ?? []) {
      ids.push(String(c.created_by), String(c.counterpart_id));
    }
  }

  const unicos = [...new Set(ids)].filter((id) => id !== params.userId);
  if (unicos.length === 0) return [];

  const perfiles = await perfilesPorId(supabaseCliente, unicos);
  return [...perfiles.values()]
    .map((p) => ({ id: p.id, displayName: p.display_name, avatarUrl: p.avatar_url }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "es"));
}

/**
 * El chat que ya existe entre dos personas, para que el botón "Chat" de la
 * llamada lleve a algún lado.
 *
 * Devuelve `null` cuando no hay conversación abierta —se puede llamar a alguien
 * de un grupo sin haberle escrito nunca— y ahí el botón queda deshabilitado en
 * vez de mandar a la bandeja vacía y hacer que la persona busque.
 */
export async function conversacionEntre(
  supabase: SupabaseClient,
  miId: string,
  otroId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("conversations")
    .select("id")
    .or(
      `and(created_by.eq.${miId},counterpart_id.eq.${otroId}),and(created_by.eq.${otroId},counterpart_id.eq.${miId})`,
    )
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ? String(data.id) : null;
}
