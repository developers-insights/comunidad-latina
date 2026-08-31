import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  COMMUNITY_EMOJI_COLUMNS,
  toCommunityEmoji,
  type CommunityEmoji,
  type CommunityEmojiRow,
} from "./catalog";

/**
 * EL CATÁLOGO, LEÍDO DESDE EL SERVIDOR (migración 0125).
 *
 * Éste es el camino para PINTAR: el renderer del comentario necesita el
 * catálogo para cambiar `:klk:` por la imagen, y lo necesita en el mismo
 * render en que llega el texto — no después, con un salto de layout cuando la
 * imagen aparece.
 *
 * El otro camino, el de ELEGIR, es la server action de `actions.ts`, que sale
 * de un gesto del usuario (abrir el picker).
 *
 * ─── POR QUÉ `cache()` Y NO UN FETCH POR COMPONENTE ─────────────────────────
 * Una página de feed puede pintar decenas de comentarios. Sin `cache()`, cada
 * uno pediría el catálogo entero: la misma consulta N veces dentro del mismo
 * render. `cache()` de React la deduplica POR PEDIDO —igual que `getTenant()`
 * en lib/tenant/resolve.ts—, así que sale una sola vez y no hay estado
 * compartido entre pedidos de personas distintas, que es lo que importa en una
 * app multi-tenant: el catálogo depende del tenant y de la sesión, y una caché
 * de módulo se lo daría al siguiente que entre.
 *
 * `community_emojis` llega con la 0125 y todavía no está en
 * `database.types.ts` → cliente de schema abierto, mismo patrón que
 * `music_tracks` en `music-actions.ts`. Al regenerar los tipos, este alias se
 * borra.
 */
type OpenClient = SupabaseClient;

/**
 * Cuántas fichas se traen. El pack del cliente son 60; el tope deja lugar a
 * que una comunidad sume las suyas sin que esto se convierta en una consulta
 * sin límite.
 */
const CATALOG_LIMIT = 300;

/**
 * Devuelve lista VACÍA si el catálogo está vacío o si la consulta falla.
 *
 * Que un fallo se vea igual que "todavía no hay emojis" es aceptable ACÁ y en
 * ningún otro lado: lo único que se pierde es que un `:klk:` quede escrito como
 * `:klk:` en vez de mostrarse como dibujo. Voltear un comentario entero a un
 * estado de error por eso sería peor. El fallo igual se loguea — nunca un
 * `catch {}` mudo.
 */
export const readCommunityEmojiCatalog = cache(async (): Promise<CommunityEmoji[]> => {
  const supabase = (await createClient()) as unknown as OpenClient;

  const { data, error } = await supabase
    .from("community_emojis")
    .select(COMMUNITY_EMOJI_COLUMNS)
    // `is_active` se filtra ACÁ además de en la policy. La policy es la
    // frontera; un select que no lo diga dependería de que nadie afloje esa
    // policy nunca. Los de otra comunidad no se filtran porque no hay forma de
    // pedirlos: la policy no los devuelve.
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true })
    .limit(CATALOG_LIMIT);

  if (error) {
    console.warn("[emojis] lectura del catálogo falló", { code: error.code });
    return [];
  }

  return ((data ?? []) as CommunityEmojiRow[]).map(toCommunityEmoji);
});
