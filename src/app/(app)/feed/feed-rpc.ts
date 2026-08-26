import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import type { ListingRow, PostRow } from "./queries";

/**
 * =============================================================================
 * LA PÁGINA DEL FEED, RESUELTA DENTRO DE LA BASE
 * =============================================================================
 *
 * ── EL PROBLEMA QUE CIERRA (ver «el presupuesto de 8 KB» en `queries.ts`) ────
 * Las lecturas de supabase-js son GET: todo `.in(…)` viaja en el QUERYSTRING,
 * ~39 bytes por uuid, y Kong corta el request line alrededor de los 8 KB con un
 * **414**. El feed "Para ti" inlinea TRES listas a la vez —campañas activas,
 * entidades seguidas y perfiles bloqueados—; con los topes de hoy (150/200/200)
 * el peor caso son ~21 KB, o sea que las cotas acotan la falla pero no la
 * evitan. Y la lista de campañas es del TENANT, no del viewer: cuando cruza el
 * umbral, el feed deja de responder para TODOS a la vez. El negocio de
 * publicidad funcionando rompería el producto.
 *
 * Estas dos funciones resuelven la página CONTRA `follows`, `post_promotions` y
 * `user_blocks` adentro de Postgres. Por la URL viajan cuatro escalares (tenant,
 * cursor, tope) y ni un solo id de lista. El techo desaparece: no se corre, se
 * saca.
 *
 * ── POR QUÉ `security invoker` Y NO `security definer` ──────────────────────
 * El comentario original de `queries.ts` anotaba «un RPC security definer». Al
 * escribirlo resultó que no hace falta, y que definer sería PEOR: con invoker,
 * las policies (`posts_select`, `listings_select`) se siguen evaluando sobre el
 * JWT de quien pregunta, así que la función no puede devolver una fila que la
 * query de hoy no devolvería. `definer` habría cambiado el filtro de lugar Y la
 * frontera de seguridad en el mismo movimiento — dos cosas distintas, y sólo
 * una estaba rota. Es el mismo criterio de `global_search()` (0044/0052), que
 * ya es `security invoker` con `search_path = ''`.
 *
 * `p_tenant_id` es un parámetro y NO es la frontera: es exactamente el mismo
 * `.eq("tenant_id", …)` que la query hace hoy. La 0091 dejó escrito por qué no
 * puede serlo (el `Host` muere en el middleware y nunca llega a Postgres, y un
 * tenant elegido por el visitante no aísla nada): el aislamiento lo dan las
 * policies, que la 0091 reescribió justamente para eso.
 *
 * ── MIENTRAS LA MIGRACIÓN NO ESTÉ APLICADA ──────────────────────────────────
 * Las dos funciones devuelven `null` —nunca lanzan— cuando el RPC no existe
 * todavía (PostgREST contesta `PGRST202`) o falla por lo que sea. Quien llama
 * cae al camino de siempre, el de los `.in(…)`. Es el mismo patrón con el que
 * `fetchActivePromotions` sobrevive a un entorno sin `cta_whatsapp`: un feed que
 * anda con el techo viejo es infinitamente mejor que un feed que no anda.
 * Cuando la migración esté en todos los entornos, este fallback se borra y el
 * `console.warn` de abajo es lo que va a avisar que ya se puede.
 */

type Supabase = SupabaseClient<Database>;

/** PostgREST cuando la función no existe en el schema expuesto. */
const RPC_NO_EXISTE = "PGRST202";

export interface FeedRpcArgs {
  tenantId: string;
  /** Keyset: `null` en la primera página. */
  cursor: { createdAt: string; id: string } | null;
  /** Cuántas filas pedir (el llamador ya suma el +1 de "hay más"). */
  limit: number;
  /**
   * Las etiquetas EXACTAS de "Tu zona" (0115), ya resueltas por
   * `zonasCoincidentes` con el match laxo. Lista vacía o ausente = sin zona
   * elegida ⇒ el RPC recibe `null` y no filtra.
   *
   * Vacío NUNCA significa "no hay nada": con una zona elegida siempre hay al
   * menos una etiqueta (la propia zona). Mandar `[]` como si fuera un filtro
   * dejaría el feed en blanco, que es el peor modo de falla de esta feature.
   */
  areaLabels?: readonly string[] | null;
}

/** `[]`/`null` ⇒ `null` (no filtrar). Ver `areaLabels` arriba. */
function zonaParam(areaLabels: readonly string[] | null | undefined): string[] | null {
  return areaLabels && areaLabels.length > 0 ? [...areaLabels] : null;
}

/**
 * El cliente tipado no conoce funciones que todavía no están en
 * `database.types.ts`. Se abre SÓLO para el `.rpc()`, igual que hace
 * `fetchPostMusic` con `post_music`.
 */
function open(supabase: Supabase): SupabaseClient {
  return supabase as unknown as SupabaseClient;
}

function rpcFailed(scope: string, error: { code?: string; message?: string }): null {
  if (error.code === RPC_NO_EXISTE) {
    // Entorno sin la migración: es esperable, no es un incidente.
    console.info(`[feed] ${scope}: RPC ausente, se usa el camino con topes de URL`);
    return null;
  }
  console.warn(`[feed] ${scope}: el RPC falló, se usa el camino con topes de URL`, {
    code: error.code,
  });
  return null;
}

/**
 * Una página de POSTS del feed "Para ti", ya filtrada por alcance (personal +
 * propio + seguido + promocionado), por ZONA (0115), por bloqueos, por
 * `hidden_at` y por keyset.
 *
 * `null` = el RPC no está disponible; el llamador tiene que caer al camino de
 * los `.in(…)`.
 */
export async function fetchFeedPostsPageViaRpc(
  supabase: Supabase,
  args: FeedRpcArgs & {
    /**
     * Acota a posts de una ficha de ESTE vertical (`listings.kind`). `null` =
     * el feed entero. Lo usan los paneles "Publicaciones" de Negocios y de
     * Profesionales, que hoy repiten el mismo filtro con un `!inner`.
     */
    entityKind?: string | null;
  },
): Promise<PostRow[] | null> {
  const { data, error } = await open(supabase).rpc("feed_posts_page", {
    p_tenant_id: args.tenantId,
    p_cursor_created_at: args.cursor?.createdAt ?? null,
    p_cursor_id: args.cursor?.id ?? null,
    p_limit: args.limit,
    p_entity_kind: args.entityKind ?? null,
    p_area_labels: zonaParam(args.areaLabels),
  });

  if (error) return rpcFailed("posts", error);
  if (!Array.isArray(data)) return null;
  return data as PostRow[];
}

/**
 * Una página de LISTINGS del feed "Para ti", ya filtrada por la regla de
 * distribución premium (`recommendedFeedListingFilter`: premium + seguidos +
 * propios), por ZONA (0115), por bloqueos y por keyset.
 *
 * Va aparte del de posts —y no un solo RPC que devuelva la mezcla— porque las
 * dos listas se mezclan por `(created_at, id)` EN LA APP y esa mezcla es la que
 * decide qué entra en la página. Un RPC único tendría que devolver dos formas
 * de fila en una sola tabla (o un jsonb), y el tipado de los `as PostRow` /
 * `as ListingRow` que ya usa todo el módulo se perdería. Dos llamadas en
 * paralelo cuestan lo mismo que las dos queries de hoy.
 */
export async function fetchFeedListingsPageViaRpc(
  supabase: Supabase,
  args: FeedRpcArgs,
): Promise<ListingRow[] | null> {
  const { data, error } = await open(supabase).rpc("feed_listings_page", {
    p_tenant_id: args.tenantId,
    p_cursor_created_at: args.cursor?.createdAt ?? null,
    p_cursor_id: args.cursor?.id ?? null,
    p_limit: args.limit,
    p_area_labels: zonaParam(args.areaLabels),
  });

  if (error) return rpcFailed("listings", error);
  if (!Array.isArray(data)) return null;
  return data as ListingRow[];
}
