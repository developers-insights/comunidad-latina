import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * =============================================================================
 * QUIÉN PUEDE ETIQUETARTE — contrato compartido (columna `tag_policy`, 0089)
 * =============================================================================
 *
 * La columna la trajo la migración 0089 ("Etiquetar personas en publicaciones"),
 * que está ESCRITA pero NO APLICADA (ver `supabase/migrations/0060_*.sql`, nota
 * al pie del archivo). Hasta que alguien la corra:
 *   - `profiles_private.tag_policy` no existe en la base real.
 *   - tampoco está en `database.types.ts` (se regenera aparte, no a mano).
 *
 * Mismo patrón que `src/lib/social/post-tags.ts` para el mismo problema: cliente
 * de esquema abierto (sin el genérico `Database`) y lectura que NUNCA lanza —
 * ausencia de columna o de fila caen las dos en el default `everyone`, que es
 * exactamente lo que dice `app.tagging_allowed()` cuando no hay fila (0089, línea
 * "Sin fila en profiles_private ⇒ true").
 */

export const TAG_POLICIES = ["everyone", "following", "nobody"] as const;

export type TagPolicy = (typeof TAG_POLICIES)[number];

export function isTagPolicy(value: unknown): value is TagPolicy {
  return typeof value === "string" && (TAG_POLICIES as readonly string[]).includes(value);
}

/** El default de la columna (0089) y lo que se pinta sin fila en `profiles_private`. */
export const DEFAULT_TAG_POLICY: TagPolicy = "everyone";

/** `profiles_private` no está en `Database` todavía — ver nota de arriba. */
type OpenClient = SupabaseClient;

/**
 * La preferencia actual de una persona, para pintar el estado inicial de la
 * fila. Sin fila, con la columna todavía sin existir, o con cualquier otro
 * error de lectura: se devuelve el default — nunca se rompe la pantalla de
 * ajustes por esto, y el default coincide con lo que la base hace de verdad
 * cuando no hay fila.
 */
export async function readTagPolicy(
  supabase: SupabaseClient,
  profileId: string,
): Promise<TagPolicy> {
  const open = supabase as OpenClient;
  const { data, error } = await open
    .from("profiles_private")
    .select("tag_policy")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) {
    // 42703 = la columna todavía no existe (migración sin aplicar en este
    // entorno). Cualquier otro código: mismo criterio, no hay motivo para
    // tirar abajo /ajustes/privacidad por esto.
    console.warn("[privacidad] lectura de tag_policy falló", { code: error.code });
    return DEFAULT_TAG_POLICY;
  }

  const value = (data as { tag_policy?: unknown } | null)?.tag_policy;
  return isTagPolicy(value) ? value : DEFAULT_TAG_POLICY;
}
