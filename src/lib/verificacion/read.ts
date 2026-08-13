import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseSinTiparVerificacion } from "./types";

/**
 * =============================================================================
 * LECTURA DE LA INSIGNIA — un booleano público, y nada más
 * =============================================================================
 *
 * SE LEE DE `profiles.verified_badge`, NO DE `verification_subscriptions`.
 *
 * Es deliberado y es la mitad del porqué de esa columna espejo (0101):
 *
 *  1. PRIVACIDAD. `verification_subscriptions` no es pública — tiene el precio
 *     pactado, el estado de cobranza y el customer de Stripe. Para pintar una
 *     insignia al lado de un nombre no hace falta nada de eso, y abrirla para
 *     eso sería publicar el estado de facturación de la gente.
 *  2. COSTO. La insignia se dibuja al lado de CADA nombre: en el feed, en cada
 *     tarjeta, en cada comentario. Un join por insignia es un join por fila
 *     renderizada.
 *
 * El espejo lo mantiene `app.mirror_verified_badge()` en la misma transacción en
 * que cambia el estado, así que no hay ventana en la que digan cosas distintas.
 */

/**
 * ¿Esta cuenta lleva el check azul? Para UN perfil.
 *
 * Nunca lanza y ante la duda devuelve `false`: una insignia que no se pudo leer
 * NO se muestra. Es la degradación correcta — de los dos errores posibles,
 * mostrar de menos es invisible y mostrar de más es una afirmación falsa sobre
 * alguien.
 */
export async function leerCheckAzul(
  supabase: SupabaseClient,
  profileId: string,
): Promise<boolean> {
  const { data, error } = await supabaseSinTiparVerificacion(supabase)
    .from("profiles")
    .select("verified_badge")
    .eq("id", profileId)
    .maybeSingle();

  if (error) {
    console.warn("[verificacion] no se pudo leer la insignia", { code: error.code });
    return false;
  }
  return (data as { verified_badge?: boolean } | null)?.verified_badge === true;
}

/**
 * Las insignias de VARIOS perfiles, en una sola vuelta.
 *
 * Es lo que evita el N+1 en un listado (creadores, resultados de búsqueda, una
 * lista de postulantes). Devuelve un Set con los ids que la tienen: preguntar
 * `set.has(id)` es más difícil de usar mal que un mapa de booleanos, donde un
 * `undefined` se lee como falso sin que nadie lo note.
 */
export async function leerChecksAzules(
  supabase: SupabaseClient,
  profileIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(profileIds)].filter((id) => id.length > 0);
  if (ids.length === 0) return new Set();

  const { data, error } = await supabaseSinTiparVerificacion(supabase)
    .from("profiles")
    .select("id, verified_badge")
    .in("id", ids)
    .eq("verified_badge", true);

  if (error) {
    console.warn("[verificacion] no se pudieron leer las insignias", { code: error.code });
    return new Set();
  }
  return new Set((data as Array<{ id: string }> | null)?.map((row) => row.id) ?? []);
}
