import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";

/**
 * Idiomas de un grupo de profesionales CON CUENTA, para el directorio.
 *
 * ── POR QUÉ NO ES UN `.in(...)` SOBRE `profiles_private` ─────────────────────
 * `profiles_private.languages` (0062) es la tabla "dueño y nadie más": su RLS
 * es solo-dueño desde 0003 — ni anon, ni otro miembro, ni siquiera staff la
 * lee para un perfil ajeno. La ÚNICA puerta es `public.profile_card()` (0063),
 * SECURITY DEFINER, que aplica la matriz de privacidad del dueño (el default de
 * `show_languages` es 'publico', pero es SU elección, no un dato abierto).
 *
 * Y `profile_card()` recibe UN id por llamada — no hay variante en lote. Por
 * eso esto es un `Promise.all` de N RPCs, una por publicador ÚNICO de la
 * página (ya deduplicado por quien llama), nunca por card. Con
 * `PAGE_SIZE = 12` más un puñado de destacados, N es chico y acotado por
 * diseño — es la MISMA cardinalidad que ya pagan las consultas en lote de
 * `profiles`/`trust_scores` de esta misma pantalla, sólo que la privacidad de
 * `languages` obliga a pagarla una vez por fila en vez de en un solo `.in()`.
 *
 * Si esto se vuelve un cuello de botella real (páginas mucho más grandes), el
 * arreglo de fondo es una función `profile_cards(uuid[])` en la base — no algo
 * que se resuelva leyendo `profiles_private` derecho desde acá.
 *
 * ── EL TOPE ES DEL MÓDULO, NO DEL LLAMADOR ──────────────────────────────────
 * "N es chico y acotado por diseño" era cierto por el `PAGE_SIZE = 12` del
 * llamador de hoy, no por nada que esta función garantice: subir esa constante,
 * o sumar un segundo llamador, convertía este `Promise.all` en decenas de RPCs
 * en paralelo sin que nadie lo notara al revisar el diff. `MAX_PROFILE_CARDS`
 * lo convierte en una promesa del módulo. Al recortar, las cards que quedan
 * afuera simplemente no muestran la línea de idiomas —la misma degradación que
 * ya tiene un `profile_card` que falla— en vez de tumbar la pantalla entera.
 */

/**
 * Techo de RPCs por render. 24 = dos páginas de 12 con aire para destacados, y
 * sigue siendo un número que la base contesta sin transpirar.
 */
export const MAX_PROFILE_CARDS = 24;

export async function fetchLanguagesByProfile(
  supabase: SupabaseClient<Database>,
  profileIds: string[],
): Promise<Map<string, string[]>> {
  const unique = [...new Set(profileIds.filter(Boolean))];
  const byId = new Map<string, string[]>();
  if (unique.length === 0) return byId;

  if (unique.length > MAX_PROFILE_CARDS) {
    // No es un error del usuario ni algo que se pueda reintentar: es una
    // pantalla que creció de más. Se avisa una vez, sin PII, y se sigue.
    console.warn("[profesionales] se recortó la lectura de idiomas por el tope de RPCs", {
      pedidos: unique.length,
      tope: MAX_PROFILE_CARDS,
    });
  }
  const ids = unique.slice(0, MAX_PROFILE_CARDS);

  const results = await Promise.all(
    ids.map((id) => supabase.rpc("profile_card", { p_profile_id: id })),
  );

  results.forEach((result, index) => {
    const id = ids[index];
    if (result.error) {
      // Nunca rompe la card: sin idiomas resueltos, esa línea no se muestra.
      console.warn("[profesionales] profile_card falló al leer idiomas", {
        code: result.error.code,
      });
      return;
    }
    // `returns table (…)` → PostgREST manda un array; cero filas = sin ficha.
    const row = Array.isArray(result.data) ? result.data[0] : null;
    const languages = Array.isArray(row?.languages) ? row.languages : [];
    if (languages.length > 0) byId.set(id, languages);
  });

  return byId;
}
