import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  GRUPO_COLUMNS,
  MENSAJE_DE_GRUPO_COLUMNS,
  supabaseSinTiparGrupos,
  type GrupoRow,
  type MensajeDeGrupoRow,
  type RolEnGrupo,
} from "@/lib/messaging/grupos";

/**
 * LECTURAS DE GRUPOS.
 *
 * Ni una sola de estas consultas filtra por `tenant_id`, y es a propósito: las
 * policies de la 0133 ya lo hacen (`tenant_id = app.current_tenant_id()`) y
 * además resuelven la visibilidad —un grupo privado del que no sos miembro no
 * existe para la base—. Repetir el filtro acá crearía una segunda verdad, que
 * es exactamente lo que la 0044 dejó escrito que no hay que hacer.
 *
 * Todas usan `supabaseSinTiparGrupos`: `database.types.ts` se regenera a mano
 * y todavía no conoce estas tablas.
 */

export type MiembroDeGrupo = {
  profileId: string;
  role: RolEnGrupo;
  joinedAt: string;
  displayName: string;
  avatarUrl: string | null;
  identityVerified: boolean;
};

export type GrupoConMiRol = GrupoRow & { miRol: RolEnGrupo | null };

/** Los grupos donde estoy adentro, del que me sumé más recientemente al más antiguo (orden por `joined_at`). */
export async function listarMisGrupos(profileId: string): Promise<GrupoConMiRol[]> {
  const supabase = supabaseSinTiparGrupos(await createClient());
  const { data, error } = await supabase
    .from("chat_group_members")
    .select(`role, grupo:chat_groups(${GRUPO_COLUMNS})`)
    .eq("profile_id", profileId)
    .order("joined_at", { ascending: false })
    .limit(50);

  if (error) {
    console.warn("[grupos] no se pudieron leer mis grupos", { code: error.code });
    return [];
  }

  return ((data ?? []) as unknown as { role: RolEnGrupo; grupo: GrupoRow | null }[])
    .filter((fila): fila is { role: RolEnGrupo; grupo: GrupoRow } => fila.grupo !== null)
    .map((fila) => ({ ...fila.grupo, miRol: fila.role }));
}

/**
 * Los grupos públicos y activos de la comunidad. `excluir` saca los que ya son
 * míos: "Para sumarte" con grupos donde ya estoy es una lista que miente.
 */
export async function listarGruposPublicos(options: {
  categoria?: string | null;
  excluir?: string[];
}): Promise<GrupoRow[]> {
  const supabase = supabaseSinTiparGrupos(await createClient());
  let query = supabase
    .from("chat_groups")
    .select(GRUPO_COLUMNS)
    .eq("visibility", "public")
    .eq("status", "active")
    .order("member_count", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(40);

  if (options.categoria) query = query.eq("category", options.categoria);
  // La exclusión va EN la consulta, no sólo en memoria: con `limit(40)` y una
  // persona adentro de los 40 grupos más grandes, filtrar después dejaba
  // "Para sumarte" vacío aunque hubiera otros (revisión del 2026-09-04).
  const excluir = options.excluir ?? [];
  if (excluir.length > 0) query = query.not("id", "in", `(${excluir.join(",")})`);

  const { data, error } = await query;
  if (error) {
    console.warn("[grupos] no se pudo leer el descubrimiento", { code: error.code });
    return [];
  }

  const excluidos = new Set(options.excluir ?? []);
  return ((data ?? []) as unknown as GrupoRow[]).filter((g) => !excluidos.has(g.id));
}

/**
 * Un grupo con mi rol adentro. Devuelve null cuando la RLS no lo deja ver —
 * que es el mismo resultado que "no existe", y así tiene que ser: distinguirlos
 * confirmaría la existencia de grupos privados ajenos.
 */
export async function obtenerGrupo(
  groupId: string,
  profileId: string,
): Promise<GrupoConMiRol | null> {
  const supabase = supabaseSinTiparGrupos(await createClient());

  const [{ data: grupo }, { data: membresia }] = await Promise.all([
    supabase.from("chat_groups").select(GRUPO_COLUMNS).eq("id", groupId).maybeSingle(),
    supabase
      .from("chat_group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("profile_id", profileId)
      .maybeSingle(),
  ]);

  if (!grupo) return null;
  return {
    ...(grupo as unknown as GrupoRow),
    miRol: ((membresia as { role: RolEnGrupo } | null)?.role ?? null),
  };
}

/** La lista de miembros. Sólo la devuelve la base si soy uno de ellos. */
export async function listarMiembros(groupId: string): Promise<MiembroDeGrupo[]> {
  const supabase = supabaseSinTiparGrupos(await createClient());
  const { data, error } = await supabase
    .from("chat_group_members")
    .select(
      "profile_id, role, joined_at, perfil:profiles(id, display_name, avatar_url, identity_verified)",
    )
    .eq("group_id", groupId)
    .order("joined_at", { ascending: true })
    .limit(200);

  if (error) {
    console.warn("[grupos] no se pudieron leer los miembros", { code: error.code });
    return [];
  }

  type Fila = {
    profile_id: string;
    role: RolEnGrupo;
    joined_at: string;
    perfil: {
      id: string;
      display_name: string | null;
      avatar_url: string | null;
      identity_verified: boolean | null;
    } | null;
  };

  const miembros = ((data ?? []) as unknown as Fila[]).map((fila) => ({
    profileId: fila.profile_id,
    role: fila.role,
    joinedAt: fila.joined_at,
    displayName: fila.perfil?.display_name ?? "Miembro de la comunidad",
    avatarUrl: fila.perfil?.avatar_url ?? null,
    identityVerified: fila.perfil?.identity_verified === true,
  }));

  // Quien creó el grupo y quienes administran, arriba: es lo que se busca
  // cuando se abre la lista ("¿a quién le reclamo?").
  const peso: Record<RolEnGrupo, number> = { owner: 0, admin: 1, member: 2 };
  return miembros.sort(
    (a, b) => peso[a.role] - peso[b.role] || a.joinedAt.localeCompare(b.joinedAt),
  );
}

/**
 * Los últimos mensajes del grupo, ya en orden de lectura (viejo → nuevo).
 *
 * Se piden los 100 MÁS NUEVOS con `descending` y se dan vuelta en memoria: con
 * `ascending` el LIMIT devolvería los cien PRIMEROS del grupo, o sea la
 * conversación de hace tres meses.
 *
 * EL FILTRO DE BORRADOS ES DE ACÁ, NO DE LA POLICY (0135). La 0133 lo tenía en
 * `chat_group_messages_select`, y eso hacía imposible bajar un mensaje: el
 * USING de un SELECT se aplica también a la fila nueva de un UPDATE, así que la
 * fila con `deleted_at` puesto no podía existir y el borrado devolvía 42501
 * siempre. La 0135 abrió la policy —su autor y quien administra siguen viendo
 * lo borrado— y el filtro bajó a esta consulta.
 *
 * Se filtra y no se pinta lápida ("Mensaje eliminado") a propósito: en el chat
 * 1-a-1 borrar un mensaje lo hace DELETE físico y desaparece sin dejar rastro
 * (`messages_delete`, 0006). Dos chats de la misma app no pueden borrar de dos
 * maneras distintas; el día que uno estrene lápida, la estrenan los dos.
 */
export async function listarMensajesDelGrupo(
  groupId: string,
): Promise<MensajeDeGrupoRow[]> {
  const supabase = supabaseSinTiparGrupos(await createClient());
  const { data, error } = await supabase
    .from("chat_group_messages")
    .select(MENSAJE_DE_GRUPO_COLUMNS)
    .eq("group_id", groupId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);

  if (error) {
    console.warn("[grupos] no se pudieron leer los mensajes", { code: error.code });
    return [];
  }

  return ((data ?? []) as unknown as MensajeDeGrupoRow[]).slice().reverse();
}

/**
 * Nombre y foto de cada autor, en UNA consulta.
 *
 * En un grupo el mismo nombre se repite en decenas de burbujas: pedirlo por
 * mensaje sería N+1 sobre la pantalla que más se abre del módulo.
 */
export async function perfilesDeAutores(
  ids: string[],
): Promise<Map<string, { displayName: string; avatarUrl: string | null }>> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return new Map();

  const supabase = supabaseSinTiparGrupos(await createClient());
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", unicos);

  const filas = (data ?? []) as unknown as {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  }[];

  return new Map(
    filas.map((fila) => [
      fila.id,
      {
        displayName: fila.display_name ?? "Miembro de la comunidad",
        avatarUrl: fila.avatar_url,
      },
    ]),
  );
}
