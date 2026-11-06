import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database.types";

/**
 * La ÚNICA lectura de `profiles` y `trust_scores` que sirve sin sesión. Desde la
 * 0186 `anon` no toca esas tablas: un `.from("profiles")` en una pantalla pública
 * devuelve vacío o 42501, y la página se ve sin autores.
 *
 * Pide por id y nunca lista: quien no conoce el id de alguien no puede bajar a
 * nadie. Con sesión sigue valiendo la comunidad de siempre (0185).
 */
type Cliente = Pick<SupabaseClient<Database>, "rpc">;

export interface PerfilPublico {
  id: string;
  display_name: string;
  avatar_url: string | null;
  area_label: string | null;
  identity_verified: boolean;
}

export interface PuntajePublico {
  profile_id: string;
  score: number;
  level: string;
  signals: Json;
  computed_at: string;
}

const distintos = (ids: readonly string[]) => [...new Set(ids)];

export async function perfilesPublicos(supabase: Cliente, ids: readonly string[]) {
  if (ids.length === 0) return { data: [] as PerfilPublico[], error: null };
  const { data, error } = await supabase.rpc("perfiles_publicos", { p_ids: distintos(ids) });
  return { data: (data ?? []) as PerfilPublico[], error };
}

export async function perfilPublico(supabase: Cliente, id: string) {
  const { data, error } = await perfilesPublicos(supabase, [id]);
  return { data: data[0] ?? null, error };
}

export async function puntajesPublicos(supabase: Cliente, ids: readonly string[]) {
  if (ids.length === 0) return { data: [] as PuntajePublico[], error: null };
  const { data, error } = await supabase.rpc("puntajes_publicos", { p_ids: distintos(ids) });
  return { data: (data ?? []) as PuntajePublico[], error };
}

export async function puntajePublico(supabase: Cliente, id: string) {
  const { data, error } = await puntajesPublicos(supabase, [id]);
  return { data: data[0] ?? null, error };
}
