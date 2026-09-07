import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * =============================================================================
 * LLAMADAS DE AUDIO Y VIDEO (0139) — catálogo, tipos y el escape de tipado
 * =============================================================================
 *
 * `src/lib/types/database.types.ts` se regenera a mano y todavía no conoce
 * `calls` ni `call_participants`. Mismo patrón —y el mismo nombre parlante— que
 * `supabaseSinTiparGrupos` de la 0133: un solo lugar donde el cliente pierde el
 * tipado, para que en el diff se vea quién lo usa y por qué.
 */
export function supabaseSinTiparLlamadas(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

/** El tope lo pone `app.tope_de_participantes_en_llamada()`; acá se espeja. */
export const MAX_PARTICIPANTES = 10;

export const KINDS = ["audio", "video"] as const;
export type KindDeLlamada = (typeof KINDS)[number];

export const ESTADOS = [
  "sonando",
  "en_curso",
  "terminada",
  "perdida",
  "rechazada",
] as const;
export type EstadoDeLlamada = (typeof ESTADOS)[number];

export function esEstadoDeLlamada(value: unknown): value is EstadoDeLlamada {
  return typeof value === "string" && (ESTADOS as readonly string[]).includes(value);
}

/** Sonando o en curso: todavía se puede entrar, y todavía cuesta plata. */
export function estaViva(estado: EstadoDeLlamada): boolean {
  return estado === "sonando" || estado === "en_curso";
}

/**
 * ⚠️ `canal` NO ESTÁ EN ESTA LISTA Y NO ES UN OLVIDO.
 *
 * La RLS deja que un participante lo lea, así que técnicamente se podría pedir.
 * No se pide: el nombre del canal es la mitad de la cerradura de Agora (§1 de la
 * 0139) y su único consumidor legítimo es `/api/llamadas/token`, que ya
 * comprueba pertenencia contra la base antes de firmarlo. Si viajara en el
 * payload de un Server Component quedaría en el HTML de la página, en la caché
 * del router y en cualquier extensión que lea el DOM — tres lugares donde nadie
 * lo necesita.
 */
export const LLAMADA_COLUMNS =
  "id, kind, status, group_id, iniciada_por, started_at, ended_at, created_at";

export type LlamadaRow = {
  id: string;
  kind: string;
  status: string;
  group_id: string | null;
  iniciada_por: string;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
};

export const PARTICIPANTE_COLUMNS = "call_id, profile_id, joined_at, left_at";

export type ParticipanteRow = {
  call_id: string;
  profile_id: string;
  joined_at: string | null;
  left_at: string | null;
};

/** Lo mínimo de un perfil que la pantalla de llamada necesita pintar. */
export type PersonaEnLlamada = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  country: string | null;
  /** `null` = invitada, todavía no atendió. */
  joinedAt: string | null;
  leftAt: string | null;
};

/** Sigue adentro: entró y no se fue. */
export function sigueEnLaLlamada(persona: PersonaEnLlamada): boolean {
  return persona.joinedAt !== null && persona.leftAt === null;
}

/**
 * Cuántas personas más entran.
 *
 * Se cuenta contra TODAS las filas de `call_participants`, no contra las que
 * están conectadas: el trigger de la base cuenta filas, y una fila de alguien
 * que todavía no atendió ocupa lugar igual. Contar conectados acá haría que la
 * UI ofreciera invitar a nueve y la base rechazara al tercero.
 */
export function cupoRestante(totalDeFilas: number): number {
  return Math.max(0, MAX_PARTICIPANTES - totalDeFilas);
}
