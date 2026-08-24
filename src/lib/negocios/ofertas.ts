import "server-only";

import { listingPhotoUrl } from "@/components/listings";
import { supabaseSinTipar } from "@/lib/resenas";
import {
  esOfertaTipo,
  etiquetaDeValor,
  vencimientoDeOferta,
  type NegocioDeOferta,
  type OfertaVista,
} from "./ofertas-modelo";

export type { NegocioDeOferta, OfertaVista } from "./ofertas-modelo";

/**
 * =============================================================================
 * LA PESTAÑA "OFERTAS" — `post_offers ⋈ posts`, y ni una fila más
 * =============================================================================
 *
 * La oferta NO es una publicación aparte: es la MISMA fila de `posts` con una
 * fila satélite que le cuelga las condiciones comerciales (0106, PK = FK). Por
 * eso esta pestaña y la de Publicaciones muestran la misma cosa desde dos
 * ángulos y no hay nada que sincronizar entre las dos.
 *
 * ── POR QUÉ ACÁ NO SE APLICA LA REGLA DE "SÓLO PARA QUIEN SIGUE" ────────────
 * El feed "Para ti" y la pestaña Publicaciones filtran los posts de entidad con
 * `feedPostVisibilityFilter`: un post orgánico de una ficha sólo alcanza a quien
 * la sigue, salvo campaña paga. Esa regla existe para que el FEED —que nadie
 * pidió— no se llene de negocios desconocidos. Ofertas es otra cosa: es una
 * vidriera que la persona abrió a propósito, con el nombre puesto. Filtrarla por
 * seguidores la dejaría vacía justo para quien todavía no conoce a nadie, que es
 * exactamente el recién llegado al que la sección sirve. Es el mismo criterio
 * con el que el directorio de Tiendas del Marketplace lista tiendas que nadie
 * sigue: un directorio no es un feed.
 *
 * Lo que SÍ se respeta, porque son reglas de acceso y no de alcance: `status =
 * 'published'`, `hidden_at is null` (0097, lo que su autor sacó de circulación)
 * y la RLS de `post_offers` (0106), que aplica sola en cada consulta.
 *
 * ── DOS CONSULTAS, NO UNA POR TARJETA ───────────────────────────────────────
 * Primero las ofertas vigentes (índice `post_offers_vigentes_idx`: comunidad +
 * rango de vigencia + orden por vencimiento, en un solo recorrido). Después, UNA
 * consulta batched a `listings` para resolver de qué negocio es cada una. Nunca
 * una consulta por oferta.
 *
 * ⚠️ `post_offers` no está en `database.types.ts` (0106 es posterior a la última
 * regeneración): se lee con el escape acotado `supabaseSinTipar()`, igual que
 * `listing_review_stats` y `listing_hours`. Ver `./ofertas-modelo.ts`.
 */

/** Cuántas ofertas trae una página. Corto: son tarjetas altas en un teléfono. */
export const OFERTAS_PAGE_SIZE = 10;

/**
 * Lo que devuelve el embed `posts!inner(...)`.
 *
 * `post_offers.post_id` es una FK a `posts`, así que PostgREST resuelve la
 * relación como MUCHOS-A-UNO y manda un objeto. Igual se acepta el array: el
 * cliente va sin tipar (`supabaseSinTipar`, ver el docblock de arriba) y por lo
 * tanto nadie le está garantizando la forma a TypeScript — normalizar es más
 * barato que descubrirlo en producción con la pestaña en blanco.
 */
interface PostDeOferta {
  id: string;
  body: string | null;
  media: string[] | null;
  created_at: string;
  entity_listing_id: string | null;
}

interface FilaOferta {
  post_id: string;
  tipo: string;
  titulo: string;
  valor_tipo: string | null;
  valor: number | string | null;
  moneda: string;
  codigo_cupon: string | null;
  starts_at: string;
  expires_at: string;
  terminos: string | null;
  posts: PostDeOferta | PostDeOferta[] | null;
}

function unPost(embed: FilaOferta["posts"]): PostDeOferta | null {
  if (!embed) return null;
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

export interface OfertasCursor {
  expiresAt: string;
  postId: string;
}

export interface OfertasPage {
  items: OfertaVista[];
  nextCursor: OfertasCursor | null;
}

/** `expiresAt|postId` → cursor. Formato propio y acotado: nunca entra a una query sin validar. */
export function parseOfertasCursor(raw: string | undefined): OfertasCursor | null {
  if (!raw) return null;
  const [expiresAt, postId] = raw.split("|");
  if (!expiresAt || !postId) return null;
  if (Number.isNaN(Date.parse(expiresAt))) return null;
  if (!/^[0-9a-fA-F-]{36}$/.test(postId)) return null;
  return { expiresAt, postId };
}

export function encodeOfertasCursor(cursor: OfertasCursor): string {
  return `${cursor.expiresAt}|${cursor.postId}`;
}

const OFERTA_COLUMNS =
  "post_id, tipo, titulo, valor_tipo, valor, moneda, codigo_cupon, starts_at, expires_at, terminos, posts!inner(id, body, media, created_at, entity_listing_id)";

/**
 * Las ofertas VIGENTES de la comunidad, la que vence primero arriba.
 *
 * Nunca lanza: ante cualquier error devuelve una página vacía y lo deja
 * anotado. Hoy ese es el camino esperado —la 0106 todavía no está aplicada— y
 * la pestaña muestra su estado vacío, que explica qué va a aparecer ahí.
 */
export async function fetchOfertasVigentes(
  client: unknown,
  args: {
    tenantId: string;
    ahora: Date;
    cursor?: OfertasCursor | null;
    pageSize?: number;
  },
): Promise<OfertasPage> {
  const pageSize = args.pageSize ?? OFERTAS_PAGE_SIZE;
  const supabase = supabaseSinTipar(client);
  const ahoraIso = args.ahora.toISOString();

  let query = supabase
    .from("post_offers")
    .select(OFERTA_COLUMNS)
    .eq("tenant_id", args.tenantId)
    // Vigencia: empezó y todavía no venció. El índice de la 0106 cubre el rango
    // sobre `expires_at` y el ORDER BY con el mismo recorrido.
    .lte("starts_at", ahoraIso)
    .gt("expires_at", ahoraIso)
    // Acceso, no alcance: una publicación despublicada u ocultada por su autor
    // no se muestra por la puerta de al lado.
    .eq("posts.status", "published")
    .is("posts.hidden_at", null)
    .order("expires_at", { ascending: true })
    .order("post_id", { ascending: true })
    .limit(pageSize + 1);

  if (args.cursor) {
    query = query.or(
      `expires_at.gt."${args.cursor.expiresAt}",and(expires_at.eq."${args.cursor.expiresAt}",post_id.gt."${args.cursor.postId}")`,
    );
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[negocios] no se pudieron leer las ofertas vigentes", {
      code: (error as { code?: string }).code,
    });
    return { items: [], nextCursor: null };
  }

  const filas = (data ?? []) as unknown as FilaOferta[];
  const pagina = filas.slice(0, pageSize);
  const hayMas = filas.length > pageSize;
  if (pagina.length === 0) return { items: [], nextCursor: null };

  const negocios = await fetchNegociosDeOfertas(
    client,
    args.tenantId,
    pagina.map((fila) => unPost(fila.posts)?.entity_listing_id ?? null),
  );

  const items: OfertaVista[] = [];
  for (const fila of pagina) {
    // `tipo` viene de un CHECK, pero una fila escrita fuera de la app no puede
    // tumbar la pestaña entera: se descarta esa oferta y se sigue.
    if (!esOfertaTipo(fila.tipo)) continue;
    const post = unPost(fila.posts);
    const primeraFoto = (post?.media ?? []).find((ruta) => ruta && ruta.trim().length > 0);
    const listingId = post?.entity_listing_id ?? null;

    items.push({
      postId: fila.post_id,
      tipo: fila.tipo,
      titulo: fila.titulo,
      valorEtiqueta: etiquetaDeValor(fila.valor_tipo, fila.valor, fila.moneda),
      codigoCupon: fila.codigo_cupon,
      vencimiento: vencimientoDeOferta(fila.expires_at, args.ahora),
      terminos: fila.terminos,
      cuerpo: post?.body ?? null,
      fotoUrl: primeraFoto ? listingPhotoUrl(primeraFoto) : null,
      negocio: listingId ? (negocios.get(listingId) ?? null) : null,
    });
  }

  const ultima = pagina[pagina.length - 1];
  const nextCursor =
    hayMas && ultima ? { expiresAt: ultima.expires_at, postId: ultima.post_id } : null;

  return { items, nextCursor };
}

/**
 * Los negocios de una tanda de ofertas, en UNA consulta.
 *
 * Se exige `kind='business'` y `status='published'`: una oferta cuya ficha se
 * despublicó deja de mostrar el negocio (y la tarjeta pierde sus botones de
 * contacto), en vez de linkear a un `/negocios/[id]` que responde 404.
 */
async function fetchNegociosDeOfertas(
  client: unknown,
  tenantId: string,
  listingIds: readonly (string | null)[],
): Promise<Map<string, NegocioDeOferta>> {
  const porId = new Map<string, NegocioDeOferta>();
  const ids = [...new Set(listingIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return porId;

  const supabase = supabaseSinTipar(client);
  const { data, error } = await supabase
    .from("listings")
    .select("id, title, photos, created_by")
    .eq("tenant_id", tenantId)
    .eq("kind", "business")
    .eq("status", "published")
    .in("id", ids);

  if (error) {
    console.warn("[negocios] no se pudo resolver el negocio de las ofertas", {
      code: (error as { code?: string }).code,
    });
    return porId;
  }

  for (const fila of (data ?? []) as Array<{
    id: string;
    title: string;
    photos: string[] | null;
    created_by: string | null;
  }>) {
    const primera = (fila.photos ?? []).find((ruta) => ruta && ruta.trim().length > 0);
    porId.set(fila.id, {
      id: fila.id,
      nombre: fila.title,
      fotoUrl: primera ? listingPhotoUrl(primera) : null,
      duenoId: fila.created_by,
    });
  }
  return porId;
}
