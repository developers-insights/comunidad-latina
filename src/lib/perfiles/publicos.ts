import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database.types";
import { perfilesDeVisitante, puntajesDeVisitante } from "./visitante";

/**
 * La ÚNICA lectura de `profiles` y `trust_scores` que sirve sin sesión. Desde la
 * 0186 `anon` no toca esas tablas: un `.from("profiles")` en una pantalla pública
 * devuelve vacío o 42501, y la página se ve sin autores.
 *
 * Pide por id y nunca lista: quien no conoce el id de alguien no puede bajar a
 * nadie. Con sesión manda el JWT (0185). Sin sesión la comunidad sale del dominio y
 * la lee el servidor (0187): con la anon key la elegiría quien pregunta.
 */
type Cliente = Pick<SupabaseClient<Database>, "rpc" | "auth">;

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

interface LecturaFallida {
  code: string;
  message: string;
}

const distintos = (ids: readonly string[]) => [...new Set(ids)];

/** Sólo elige el camino: una sesión falsa no pasa de la RPC, que valida el JWT. */
async function sinSesion(supabase: Cliente) {
  const { data } = await supabase.auth.getSession();
  return !data.session;
}

/**
 * La hoja de comentarios lee autores desde el navegador. Va por un Route Handler y no
 * por server action porque es una lectura: Next encola las actions por router (ver
 * `/buscar/api`), y el tope por IP vale sólo acá y no en cada render del servidor.
 */
async function pedirAlServidor<T>(tipo: "perfiles" | "puntajes", ids: string[]) {
  try {
    const respuesta = await fetch("/api/autores-visitante", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tipo, ids }),
    });
    if (!respuesta.ok) throw new Error(String(respuesta.status));
    return (await respuesta.json()) as { data: T[]; error: LecturaFallida | null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "desconocido";
    return { data: [] as T[], error: { code: "sin_respuesta", message } };
  }
}

export async function perfilesPublicos(supabase: Cliente, ids: readonly string[]) {
  if (ids.length === 0) return { data: [] as PerfilPublico[], error: null };
  if (await sinSesion(supabase)) {
    return typeof window === "undefined"
      ? perfilesDeVisitante(distintos(ids))
      : pedirAlServidor<PerfilPublico>("perfiles", distintos(ids));
  }
  const { data, error } = await supabase.rpc("perfiles_publicos", { p_ids: distintos(ids) });
  return { data: (data ?? []) as PerfilPublico[], error };
}

export async function perfilPublico(supabase: Cliente, id: string) {
  const { data, error } = await perfilesPublicos(supabase, [id]);
  return { data: data[0] ?? null, error };
}

export async function puntajesPublicos(supabase: Cliente, ids: readonly string[]) {
  if (ids.length === 0) return { data: [] as PuntajePublico[], error: null };
  if (await sinSesion(supabase)) {
    return typeof window === "undefined"
      ? puntajesDeVisitante(distintos(ids))
      : pedirAlServidor<PuntajePublico>("puntajes", distintos(ids));
  }
  const { data, error } = await supabase.rpc("puntajes_publicos", { p_ids: distintos(ids) });
  return { data: (data ?? []) as PuntajePublico[], error };
}

export async function puntajePublico(supabase: Cliente, id: string) {
  const { data, error } = await puntajesPublicos(supabase, [id]);
  return { data: data[0] ?? null, error };
}
