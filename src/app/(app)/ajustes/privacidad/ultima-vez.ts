import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * =============================================================================
 * "MOSTRAR CUÁNDO ESTUVISTE EN LÍNEA" — contrato compartido (columna
 * `profiles.mostrar_ultima_vez`, migración 0145)
 * =============================================================================
 *
 * Mismo patrón que `tag-policy.ts` y por el mismo motivo: la 0145 puede no estar
 * aplicada todavía, así que la columna no existe ni en la base ni en
 * `database.types.ts` (que se regenera aparte). Cliente de esquema abierto y una
 * lectura que NUNCA lanza.
 *
 * EL DEFAULT ES `true`, y eso lo fija la migración (`not null default true`).
 * Devolver `false` ante un error sería más "seguro" en apariencia y peor en la
 * práctica: la fila de ajustes se dibujaría apagada, la persona la vería como su
 * elección, y estaría mirando un estado que la base no tiene.
 */

export const DEFAULT_MOSTRAR_ULTIMA_VEZ = true;

/** `profiles.mostrar_ultima_vez` no está en `Database` todavía — ver arriba. */
type OpenClient = SupabaseClient;

export async function readMostrarUltimaVez(
  supabase: SupabaseClient,
  profileId: string,
): Promise<boolean> {
  const open = supabase as OpenClient;
  const { data, error } = await open
    .from("profiles")
    .select("mostrar_ultima_vez")
    .eq("id", profileId)
    .maybeSingle();

  if (error) {
    // 42703 = la columna todavía no existe (migración sin aplicar acá).
    console.warn("[privacidad] lectura de mostrar_ultima_vez falló", { code: error.code });
    return DEFAULT_MOSTRAR_ULTIMA_VEZ;
  }

  const valor = (data as { mostrar_ultima_vez?: unknown } | null)?.mostrar_ultima_vez;
  return typeof valor === "boolean" ? valor : DEFAULT_MOSTRAR_ULTIMA_VEZ;
}
