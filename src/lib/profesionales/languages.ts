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
 */
export async function fetchLanguagesByProfile(
  supabase: SupabaseClient<Database>,
  profileIds: string[],
): Promise<Map<string, string[]>> {
  const ids = [...new Set(profileIds.filter(Boolean))];
  const byId = new Map<string, string[]>();
  if (ids.length === 0) return byId;

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
