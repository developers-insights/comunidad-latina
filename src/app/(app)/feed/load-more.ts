"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import { getTenant } from "@/lib/tenant/resolve";
import { recommendedFeedListingFilter } from "@/lib/monetization/feed";
import { createClient, getAuthUserId } from "@/lib/supabase/server";
import { decodeCursor, encodeCursor } from "@/components/listings";
import {
  feedPostVisibilityFilter,
  feedZoneFilter,
  parseTab,
  siguiendoListingVisibilityFilter,
  siguiendoPostVisibilityFilter,
  type FeedItem,
  type FeedTabId,
  type GuideCardModel,
} from "@/components/feed";
import { campanaAlcanzaZona } from "@/lib/zona";
import { resolverVistaZona } from "@/lib/zona/server";
import {
  LISTING_COLUMNS,
  POST_COLUMNS,
  VISIBLE_POSTS_FILTER,
  fetchActivePromotions,
  fetchAuthorViews,
  fetchBlockedIds,
  fetchEntityViews,
  fetchFollowedListingIds,
  fetchFollowedProfileIds,
  fetchListingExtras,
  fetchPostMusic,
  fetchPostPolls,
  fetchPromotionsForPosts,
  fetchViewerLikes,
  fetchViewerSaves,
  toFeedListingModel,
  toListingCardModel,
  toPostCardModel,
  type ListingRow,
  type PostRow,
} from "./queries";
import { fetchPostTags } from "@/lib/social/post-tags";
import {
  fetchFeedListingsPageViaRpc,
  fetchFeedPostsPageViaRpc,
  fetchFeedSiguiendoListingsPageViaRpc,
  fetchFeedSiguiendoPostsPageViaRpc,
} from "./feed-rpc";

/**
 * Módulo FLUIDEZ — paginación del feed como server action.
 *
 * Extraído de page.tsx: ANTES `ParaTiFeed`/`ListingsFeed` armaban la query Y el
 * JSX en la misma función, así que la única forma de pedir "la próxima página"
 * era un <Link href="?cursor=..."> que navegaba y repintaba TODA la ruta. Acá
 * vive la lógica de "armar una página de items" pelada de JSX — la llaman
 * TANTO page.tsx (primera página, server→server, sin red) COMO feed-list.tsx
 * (scroll infinito, vía esta MISMA server action) — una sola fuente de verdad
 * para el keyset, nunca dos implementaciones que puedan desincronizarse.
 *
 * SEGURIDAD (guía server-actions.md): esta action es un POST alcanzable por
 * cualquiera, no solo por el scroll de la UI. Por eso NUNCA acepta tenantId ni
 * viewerId del caller — los resuelve siempre acá adentro (getTenant/JWT), y
 * `tab` se re-normaliza con parseTab() por si alguien la invoca a mano con un
 * string fuera del union. Es una LECTURA (nunca muta ni revalida cache), así
 * que no hace falta autenticar: RLS ya decide qué ve cada quien.
 */

/**
 * Cuántos ítems trae una página del feed.
 *
 * ── POR QUÉ 12 Y NO 8 (medido, 2026-08-26) ─────────────────────────────────
 * El cliente: «los videos/post en el feed principal tardan en cargar cuando se
 * baja viendo los post viejos». Una página de este feed no cuesta UNA consulta:
 * cuesta CUATRO viajes ENCADENADOS a la base —el tenant, después la zona (que a
 * su vez lee el catálogo de zonas), después las dos RPC de la página, y recién
 * después los batches de autores/likes/entidades/etiquetas/música/promociones—.
 * Ese costo es casi todo LATENCIA y es el MISMO trajera 8 filas o 12: sólo
 * cambia cuántas veces hay que pagarlo para recorrer el mismo feed.
 *
 * Lo que cuesta traer más filas se midió y es despreciable al lado de eso:
 * `explain analyze` de `feed_posts_page` contra producción da **9,0 ms** de
 * ejecución con todo en caché, y una fila de `posts` pesa **455 bytes** de
 * promedio (cuerpo medio de 67 caracteres). Cuatro filas más son ~1,8 KB y
 * ningún viaje extra. El ida y vuelta a Supabase, en cambio, se midió en
 * **314–362 ms** desde una conexión doméstica (mediana 344 ms).
 *
 * O sea: 8 → 12 saca un tercio de las tandas del recorrido completo del feed
 * sin agregar una sola consulta ni un salto perceptible por tanda. Las tarjetas
 * de más tampoco cuestan pintado: fuera de pantalla el navegador las saltea
 * (`content-visibility` en feed-list.tsx).
 *
 * El otro lado del mismo arreglo vive en `feed-list.tsx`: el sentinel ahora
 * avisa con dos pantallas de anticipo en vez de 600 px fijos. Las dos cosas
 * atacan la misma causa —el feed pedía tarde y cada pedido costaba caro— y
 * ninguna sirve sola.
 *
 * Techo: el RPC clampea a 50 (`least(greatest(coalesce(p_limit,9),1),50)`), y
 * los llamadores mandan `PAGE_SIZE + 1` para saber si hay más.
 */
const PAGE_SIZE = 12;

// Espeja el flag de page.tsx (oculto por pedido cliente 2026-07-20): la guía
// destacada del feed no se intercala hoy. Booleano explícito por la misma
// razón que allá — no romper el narrowing de abajo con el literal `false`.
const GUIDES_IN_FEED_ENABLED: boolean = false;

const TAB_KIND: Partial<Record<FeedTabId, string>> = {
  propiedades: "property",
  negocios: "business",
  profesionales: "professional",
  eventos: "event",
};

type Supabase = SupabaseClient<Database>;
type Cursor = { createdAt: string; id: string } | null;
type GuideRow = {
  slug: string;
  title: string;
  summary: string | null;
  reading_minutes: number | null;
};

export interface FeedPageResult {
  items: FeedItem[];
  nextCursor: string | null;
}

/**
 * Punto de entrada ÚNICO para pedir una página del feed (cualquier tab).
 * `cursor` viaja como el mismo string codificado que antes iba en `?cursor=`
 * (o `null` para la primera página) — mismo contrato, ahora sin navegar.
 */
export async function fetchFeedPageAction(input: {
  tab: FeedTabId;
  cursor: string | null;
}): Promise<FeedPageResult> {
  const tab = parseTab(input.tab);
  const cursor = decodeCursor(input.cursor ?? undefined);

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  // Lectura respaldada por RLS, no una mutación: la verificación LOCAL del JWT
  // (WebCrypto, sin round-trip al Auth server) alcanza y evita pagar esa
  // latencia en CADA scroll — mismo criterio que notificaciones/entrar.
  const viewerId = await getAuthUserId();

  /**
   * "Tu zona" (0115). Se resuelve ACÁ, en la puerta única del feed, y no en
   * cada camino: el scroll infinito entra por esta misma action, así que si la
   * zona se resolviera más adentro habría que acordarse de hacerlo en los dos
   * lugares — y el día que uno se olvide, la página 2 traería la comunidad
   * entera arriba de una página 1 filtrada.
   *
   * `urlZona` va en `null` a propósito: el feed no tiene filtro propio de zona
   * en la URL, así que acá manda siempre la preferencia (cookie > perfil).
   * `resolverVistaZona` está `cache()`-eada por request: la pantalla ya la pidió
   * para el encabezado y esta llamada no vuelve a tocar la base.
   */
  const { areaLabels } = await resolverVistaZona(tenant.id, null);

  if (tab === "para-ti") {
    return loadParaTiPage({
      supabase,
      tenantId: tenant.id,
      locale: tenant.locale,
      viewerId,
      cursor,
      areaLabels,
    });
  }
  if (tab === "siguiendo") {
    // SIN `areaLabels`: "Siguiendo" no filtra por zona (0119 §67, "SIN
    // ZONA") — pasarlo igual sería la clase de copiar-y-pegar que termina
    // filtrando por barrio una pestaña que el propio contrato dice que no
    // filtra por barrio.
    return loadSiguiendoPage({
      supabase,
      tenantId: tenant.id,
      locale: tenant.locale,
      viewerId,
      cursor,
    });
  }
  return loadListingsPage({
    supabase,
    tab,
    tenantId: tenant.id,
    locale: tenant.locale,
    viewerId,
    cursor,
    areaLabels,
  });
}

// ---------------------------------------------------------------------------
// "Para ti": mezcla server-side de posts + listings recientes + 1 guía (§4.b)
// (idéntico al que vivía en page.tsx — ver ese historial para el porqué de
// cada `.or()`; acá solo cambia el remate: datos, no JSX).
// ---------------------------------------------------------------------------

async function loadParaTiPage({
  supabase,
  tenantId,
  locale,
  viewerId,
  cursor,
  areaLabels,
}: {
  supabase: Supabase;
  tenantId: string;
  locale: string;
  viewerId: string | null;
  cursor: Cursor;
  /** Etiquetas exactas de "Tu zona". Vacío = sin zona elegida, no filtra. */
  areaLabels: readonly string[];
}): Promise<FeedPageResult> {
  const isFirstPage = !cursor;

  const guidePromise =
    isFirstPage && GUIDES_IN_FEED_ENABLED
      ? supabase
          .from("guides")
          .select("slug, title, summary, reading_minutes")
          .eq("status", "published")
          .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
          .order("published_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null });

  /**
   * CAMINO 1 — la página resuelta DENTRO de la base (`feed-rpc.ts`).
   *
   * Ni un id viaja por la URL, así que el techo de 8 KB (y el 414 que le pega a
   * todo el tenant a la vez) deja de existir. Es el camino bueno; el de abajo
   * queda sólo mientras la migración no esté aplicada en todos los entornos.
   */
  const rpcArgs = { tenantId, cursor, limit: PAGE_SIZE + 1, areaLabels };
  const [rpcPosts, rpcListings] = await Promise.all([
    fetchFeedPostsPageViaRpc(supabase, rpcArgs),
    fetchFeedListingsPageViaRpc(supabase, rpcArgs),
  ]);

  if (rpcPosts && rpcListings) {
    return assembleFeedPage({
      supabase,
      tenantId,
      locale,
      viewerId,
      postRows: rpcPosts,
      listingRows: rpcListings,
      guideResult: await guidePromise,
    });
  }

  /**
   * CAMINO 2 (legado) — los mismos filtros, pero con los ids inlineados en el
   * querystring y por lo tanto con los topes de `queries.ts` encima. Se conserva
   * entero, sin recortes, para que un entorno sin la migración se comporte
   * EXACTAMENTE como antes: un fallback que además cambia el resultado es un
   * bug esperando el deploy que lo despierte.
   */
  const [blockedIds, followedListingIds, promotions] = await Promise.all([
    fetchBlockedIds(supabase, viewerId),
    fetchFollowedListingIds(supabase, viewerId),
    fetchActivePromotions(supabase, tenantId),
  ]);
  const promotedPostIds = promotions.postIds;

  let postsQuery = supabase
    .from("posts")
    .select(POST_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  // Alcance "para vos": personal (entity null) + entidades que sigo + posts
  // promocionados (a todos). PostgREST AND-ea cada `.or()` de nivel superior, así
  // que este grupo convive con el de bloqueados y el keyset.
  postsQuery = postsQuery.or(
    feedPostVisibilityFilter(followedListingIds, [...promotedPostIds], viewerId),
  );

  // Fuera lo que su autor OCULTÓ del feed (0097). No es moderación ni borrado:
  // la publicación sigue existiendo y su link sigue abriendo — sólo deja de
  // aparecer donde la app la muestra sin que nadie la pida.
  postsQuery = postsQuery.or(VISIBLE_POSTS_FILTER);

  // Nunca mostrar en "Para ti" contenido de gente que el viewer bloqueó. El or()
  // preserva los posts de autor anónimo (cuenta borrada → author_id null): un
  // NOT IN pelado los filtraría por la semántica de NULL.
  if (blockedIds.size > 0) {
    postsQuery = postsQuery.or(
      `author_id.is.null,author_id.not.in.(${[...blockedIds].join(",")})`,
    );
  }

  /**
   * ZONA (0115) — el espejo en PostgREST de la rama ZONA de `feed_posts_page`.
   *
   * Lo orgánico se recorta a la zona; lo promocionado la esquiva SÓLO hasta
   * donde llega el `audience` que compró (`campanaAlcanzaZona`). Que las dos
   * listas se calculen acá y no adentro del filtro es lo que deja ver, leyendo
   * cuatro líneas, que el camino legado decide igual que el RPC.
   */
  const promocionadosQueAlcanzan = [...promotedPostIds].filter((postId) =>
    campanaAlcanzaZona(promotions.zonasByPostId.get(postId) ?? null, areaLabels),
  );
  const filtroZonaPosts = feedZoneFilter(areaLabels, promocionadosQueAlcanzan);
  if (filtroZonaPosts) {
    postsQuery = postsQuery.or(filtroZonaPosts);
  }

  let listingsQuery = supabase
    .from("listings")
    .select(LISTING_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  // MONETIZACIÓN §3 — el News Feed principal recomendado es premium.
  // El aviso gratuito NO desaparece: sigue en su módulo (los otros tabs de esta
  // misma función), en las búsquedas, en el perfil de quien lo publicó y acá
  // mismo para sus seguidores y para su dueño. Lo único que se reserva a
  // premium es el empujón que la app da sin que nadie lo pida.
  listingsQuery = listingsQuery.or(
    recommendedFeedListingFilter({ followedListingIds, viewerId }),
  );

  if (blockedIds.size > 0) {
    listingsQuery = listingsQuery.or(
      `created_by.is.null,created_by.not.in.(${[...blockedIds].join(",")})`,
    );
  }

  // Los avisos no tienen la excepción de la campaña: el impulso compra ORDEN
  // adentro de una comunidad, no domicilio en otro barrio (mismo criterio que
  // los seis módulos). `.in()` de supabase-js entrecomilla solo los valores con
  // coma, que es exactamente la forma de la mitad de estas etiquetas.
  if (areaLabels.length > 0) {
    listingsQuery = listingsQuery.in("area_label", [...areaLabels]);
  }

  if (cursor) {
    const keysetFilter = `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt."${cursor.id}")`;
    postsQuery = postsQuery.or(keysetFilter);
    listingsQuery = listingsQuery.or(keysetFilter);
  }

  const [postsResult, listingsResult, guideResult] = await Promise.all([
    postsQuery,
    listingsQuery,
    guidePromise,
  ]);

  if (postsResult.error) {
    console.warn("[feed] query de posts falló", { code: postsResult.error.code });
  }
  if (listingsResult.error) {
    console.warn("[feed] query de listings falló", { code: listingsResult.error.code });
  }

  return assembleFeedPage({
    supabase,
    tenantId,
    locale,
    viewerId,
    // El RPC puede haber contestado UNA de las dos: se aprovecha la que vino.
    postRows: rpcPosts ?? ((postsResult.data ?? []) as PostRow[]),
    listingRows: rpcListings ?? ((listingsResult.data ?? []) as ListingRow[]),
    guideResult,
  });
}

/**
 * De dos listas de filas a una página de `FeedItem`: mezcla por (created_at,
 * id), corte de página, y los batches de datos anexos.
 *
 * Está aparte de la query A PROPÓSITO: es lo único que los dos caminos de
 * arriba —el RPC y el legado con topes de URL— comparten sin poder
 * desincronizarse. Si la mezcla viviera dentro de cada camino, el fallback
 * podría empezar a devolver un feed distinto sin que nadie lo note.
 *
 * COMPARTIDA por "Para ti" Y "Siguiendo" (0119): el merge-por-fecha, el corte
 * de página y los ocho batches (autores, likes, guardados, encuestas, extras
 * de listings, entidades, etiquetados, música, promociones) no dependen de
 * QUÉ alcance decidió qué filas entraron — sólo de la forma de la fila
 * (`PostRow`/`ListingRow`), que es idéntica en las dos pestañas porque las
 * cuatro funciones SQL comparten `returns table`. Repetir esto en
 * `loadSiguiendoPage` sería la clase de duplicación que se desincroniza sola.
 * La ÚNICA diferencia entre pestañas es la guía editorial: "Siguiendo" nunca
 * la intercala (no es contenido de alguien que se sigue), así que ese
 * llamador manda siempre `guideResult: { data: null }`.
 */
async function assembleFeedPage({
  supabase,
  tenantId,
  locale,
  viewerId,
  postRows,
  listingRows,
  guideResult,
}: {
  supabase: Supabase;
  tenantId: string;
  locale: string;
  viewerId: string | null;
  postRows: PostRow[];
  listingRows: ListingRow[];
  guideResult: { data: GuideRow | null };
}): Promise<FeedPageResult> {
  // Merge por (created_at, id) desc — ids uuid_v7, el desempate es estable.
  const merged: Array<
    | { type: "post"; createdAt: string; id: string; row: PostRow }
    | { type: "listing"; createdAt: string; id: string; row: ListingRow }
  > = [
    ...postRows.map((row) => ({
      type: "post" as const,
      createdAt: row.created_at,
      id: row.id,
      row,
    })),
    ...listingRows.map((row) => ({
      type: "listing" as const,
      createdAt: row.created_at,
      id: row.id,
      row,
    })),
  ].sort((a, b) =>
    a.createdAt === b.createdAt
      ? b.id.localeCompare(a.id)
      : a.createdAt < b.createdAt
        ? 1
        : -1,
  );

  const pageEntries = merged.slice(0, PAGE_SIZE);
  const hasMore = merged.length > PAGE_SIZE;

  // Batches: autores+likes de los posts visibles, extras de listings visibles.
  const visiblePosts = pageEntries.filter((entry) => entry.type === "post");
  const visibleListings = pageEntries
    .filter((entry) => entry.type === "listing")
    .map((entry) => entry.row as ListingRow);

  const now = new Date();
  const entityListingIds = visiblePosts
    .map((entry) => (entry.row as PostRow).entity_listing_id)
    .filter((id): id is string => Boolean(id));

  // Encuestas: solo las PREGUNTAS pueden tener una (0041), así que la query
  // extra ni se dispara en un feed sin preguntas.
  const questionPostIds = visiblePosts
    .filter((entry) => (entry.row as PostRow).kind === "question")
    .map((entry) => entry.id);

  const [
    authors,
    likedIds,
    savedIds,
    pollByPostId,
    listingExtras,
    entityById,
    tagsByPostId,
    musicByPostId,
    promotions,
  ] = await Promise.all([
    fetchAuthorViews(
      supabase,
      visiblePosts
        .map((entry) => (entry.row as PostRow).author_id)
        .filter((id): id is string => Boolean(id)),
    ),
    fetchViewerLikes(
      supabase,
      viewerId,
      visiblePosts.map((entry) => entry.id),
    ),
    fetchViewerSaves(
      supabase,
      viewerId,
      visiblePosts.map((entry) => entry.id),
    ),
    fetchPostPolls(supabase, viewerId, questionPostIds),
    fetchListingExtras(supabase, tenantId, visibleListings, locale),
    fetchEntityViews(supabase, entityListingIds),
    // Etiquetados de TODA la página en UNA query (no una por post).
    fetchPostTags(
      supabase,
      visiblePosts.map((entry) => entry.id),
    ),
    // Música de TODA la página en UNA query (no una por post).
    fetchPostMusic(
      supabase,
      visiblePosts.map((entry) => entry.id),
    ),
    // El chip "Publicidad" y el WhatsApp de la campaña se resuelven sobre los
    // posts QUE SE VAN A PINTAR, no sobre las 150 campañas del tenant: la
    // decisión de alcance ya la tomó la query (o el RPC) más arriba.
    fetchPromotionsForPosts(
      supabase,
      tenantId,
      visiblePosts.map((entry) => entry.id),
    ),
  ]);
  const promotedPostIds = promotions.postIds;

  const items: FeedItem[] = pageEntries.map((entry) => {
    if (entry.type === "post") {
      const postRow = entry.row as PostRow;
      return {
        type: "post",
        createdAt: entry.createdAt,
        id: entry.id,
        post: toPostCardModel(postRow, authors, likedIds, now, {
          entity: postRow.entity_listing_id
            ? (entityById.get(postRow.entity_listing_id) ?? null)
            : null,
          isPromoted: promotedPostIds.has(postRow.id),
          savedByViewer: savedIds.has(postRow.id),
          poll: pollByPostId.get(postRow.id) ?? null,
          ctaWhatsapp: promotions.whatsappByPostId.get(postRow.id) ?? null,
          taggedPeople: tagsByPostId.get(postRow.id) ?? [],
          music: musicByPostId.get(postRow.id) ?? null,
        }),
      };
    }
    const row = entry.row as ListingRow;
    if (row.kind === "property") {
      return {
        type: "listing-property",
        createdAt: entry.createdAt,
        id: entry.id,
        listing: toListingCardModel(row, listingExtras, locale),
      };
    }
    return {
      type: "listing",
      createdAt: entry.createdAt,
      id: entry.id,
      listing: toFeedListingModel(row, listingExtras, locale),
    };
  });

  // Guía destacada intercalada (solo primera página) — formato editorial §4.b.
  const guideRow = guideResult.data as
    | { slug: string; title: string; summary: string | null; reading_minutes: number | null }
    | null;
  const guide: GuideCardModel | null = guideRow
    ? {
        slug: guideRow.slug,
        title: guideRow.title,
        summary: guideRow.summary,
        readingMinutes: guideRow.reading_minutes,
      }
    : null;
  if (guide && items.length > 0) {
    items.splice(Math.min(2, items.length), 0, {
      type: "guide",
      createdAt: "",
      id: `guide-${guide.slug}`,
      guide,
    });
  }

  if (items.length === 0) {
    return { items: [], nextCursor: null };
  }

  const lastEntry = pageEntries[pageEntries.length - 1];
  const nextCursor = hasMore && lastEntry ? encodeCursor(lastEntry.createdAt, lastEntry.id) : null;
  return { items, nextCursor };
}

// ---------------------------------------------------------------------------
// Tabs de listings por kind (Propiedades | Negocios | Profesionales | Eventos)
// ---------------------------------------------------------------------------

async function loadListingsPage({
  supabase,
  tab,
  tenantId,
  locale,
  viewerId,
  cursor,
  areaLabels,
}: {
  supabase: Supabase;
  tab: FeedTabId;
  tenantId: string;
  locale: string;
  viewerId: string | null;
  cursor: Cursor;
  /** Etiquetas exactas de "Tu zona". Vacío = sin zona elegida, no filtra. */
  areaLabels: readonly string[];
}): Promise<FeedPageResult> {
  const kind = TAB_KIND[tab] ?? "property";
  const blockedIds = await fetchBlockedIds(supabase, viewerId);

  let query = supabase
    .from("listings")
    .select(LISTING_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("kind", kind)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (blockedIds.size > 0) {
    query = query.or(
      `created_by.is.null,created_by.not.in.(${[...blockedIds].join(",")})`,
    );
  }

  // ZONA (0115): el MISMO `.in("area_label", …)` con el que Vivienda, Empleos,
  // Negocios, Profesionales, Marketplace y Eventos ya respetan "Tu zona". Estos
  // cuatro tabs son esos mismos avisos vistos desde el feed: filtrar acá distinto
  // que allá sería que la misma publicación esté y no esté según por dónde se
  // entra.
  if (areaLabels.length > 0) {
    query = query.in("area_label", [...areaLabels]);
  }

  if (cursor) {
    query = query.or(
      `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt."${cursor.id}")`,
    );
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[feed] query de listings del tab falló", { code: error.code });
  }

  const rows = ((data ?? []) as ListingRow[]).slice(0, PAGE_SIZE);
  const hasMore = (data ?? []).length > PAGE_SIZE;

  if (rows.length === 0) {
    return { items: [], nextCursor: null };
  }

  const extras = await fetchListingExtras(supabase, tenantId, rows, locale);
  const lastRow = rows[rows.length - 1];

  const items: FeedItem[] = rows.map((row) =>
    row.kind === "property"
      ? {
          type: "listing-property",
          createdAt: row.created_at,
          id: row.id,
          listing: toListingCardModel(row, extras, locale),
        }
      : {
          type: "listing",
          createdAt: row.created_at,
          id: row.id,
          listing: toFeedListingModel(row, extras, locale),
        },
  );

  const nextCursor = hasMore && lastRow ? encodeCursor(lastRow.created_at, lastRow.id) : null;
  return { items, nextCursor };
}

// ---------------------------------------------------------------------------
// "Siguiendo" (0119): SOLO lo de los perfiles y las fichas que seguís, más lo
// propio. Sin promociones, sin zona (ver el docblock de la migración para el
// porqué completo de las dos ausencias) — es la mezcla RPC/legado de "Para
// ti" (mismo merge, mismos batches, vía `assembleFeedPage`) con un alcance
// distinto.
// ---------------------------------------------------------------------------

async function loadSiguiendoPage({
  supabase,
  tenantId,
  locale,
  viewerId,
  cursor,
}: {
  supabase: Supabase;
  tenantId: string;
  locale: string;
  viewerId: string | null;
  cursor: Cursor;
}): Promise<FeedPageResult> {
  /**
   * SIN SESIÓN NO HAY "SIGUIENDO" (0119 §3): el filtro entero se define contra
   * `auth.uid()`, así que sin viewer no hay una sola fila que pueda entrar —
   * ni por RPC (que ni siquiera tiene grant para `anon`) ni por el camino
   * legado. Se corta ACÁ, antes de cualquier lectura: esta action es un POST
   * alcanzable por cualquiera (ver la cabecera del módulo), así que este
   * guard no puede vivir solo del lado del estado vacío de `page.tsx`.
   */
  if (!viewerId) {
    return { items: [], nextCursor: null };
  }

  // CAMINO 1 — RPC (`feed_siguiendo_posts_page` / `feed_siguiendo_listings_page`,
  // 0119). Hermanas exactas de las de "Para ti": mismo `returns table`, mismos
  // mappers vía `assembleFeedPage`. Nunca se intercala la guía editorial acá
  // —no es contenido de alguien que se sigue— así que `guideResult` va fijo.
  const rpcArgs = { tenantId, cursor, limit: PAGE_SIZE + 1 };
  const [rpcPosts, rpcListings] = await Promise.all([
    fetchFeedSiguiendoPostsPageViaRpc(supabase, rpcArgs),
    fetchFeedSiguiendoListingsPageViaRpc(supabase, rpcArgs),
  ]);

  if (rpcPosts && rpcListings) {
    return assembleFeedPage({
      supabase,
      tenantId,
      locale,
      viewerId,
      postRows: rpcPosts,
      listingRows: rpcListings,
      guideResult: { data: null },
    });
  }

  /**
   * CAMINO 2 (legado) — los follows se leen UNA sola vez acá (ni por post ni
   * por listing: nada de N+1) y se vuelcan a dos `.or()` con
   * `siguiendoPostVisibilityFilter` / `siguiendoListingVisibilityFilter`
   * (helpers.ts), que espejan las mismas tres/dos ramas que la 0119.
   */
  const [followedProfileIds, followedListingIds, blockedIds] = await Promise.all([
    fetchFollowedProfileIds(supabase, viewerId),
    fetchFollowedListingIds(supabase, viewerId),
    fetchBlockedIds(supabase, viewerId),
  ]);

  // POSTS: SIEMPRE se consulta, nunca detrás de "¿hay follows?" — la rama de
  // "lo propio" (`author_id.eq.viewerId`) no depende de tener follows, y
  // saltear la query con las dos listas vacías dejaría afuera las
  // publicaciones propias que la 0119 garantiza (ver el docblock de
  // `siguiendoPostVisibilityFilter`).
  let postsQuery = supabase
    .from("posts")
    .select(POST_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1)
    .or(siguiendoPostVisibilityFilter(followedProfileIds, followedListingIds, viewerId))
    // Fuera lo que su autor OCULTÓ (0097) — igual que en "Para ti".
    .or(VISIBLE_POSTS_FILTER);

  if (blockedIds.size > 0) {
    postsQuery = postsQuery.or(
      `author_id.is.null,author_id.not.in.(${[...blockedIds].join(",")})`,
    );
  }
  if (cursor) {
    const keysetFilter = `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt."${cursor.id}")`;
    postsQuery = postsQuery.or(keysetFilter);
  }

  // LISTINGS: acá SÍ hay algo que preguntar únicamente si hay follows — la
  // 0119 no le da a "Siguiendo" una rama de avisos propios (para eso está
  // "Mis publicaciones"). Con las dos listas vacías, `siguiendoListingVisibilityFilter`
  // devuelve `null` y esta rama corta ANTES de pegarle a la base por nada.
  const listingsFilter = siguiendoListingVisibilityFilter(followedProfileIds, followedListingIds);

  let listingsQuery = listingsFilter
    ? supabase
        .from("listings")
        .select(LISTING_COLUMNS)
        .eq("tenant_id", tenantId)
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE + 1)
        .or(listingsFilter)
    : null;

  if (listingsQuery && blockedIds.size > 0) {
    listingsQuery = listingsQuery.or(
      `created_by.is.null,created_by.not.in.(${[...blockedIds].join(",")})`,
    );
  }
  if (listingsQuery && cursor) {
    listingsQuery = listingsQuery.or(
      `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt."${cursor.id}")`,
    );
  }

  const [postsResult, listingsResult] = await Promise.all([
    postsQuery,
    listingsQuery ?? Promise.resolve({ data: [] as ListingRow[], error: null }),
  ]);

  if (postsResult.error) {
    console.warn("[feed] query de posts (siguiendo) falló", { code: postsResult.error.code });
  }
  if (listingsResult.error) {
    console.warn("[feed] query de listings (siguiendo) falló", { code: listingsResult.error.code });
  }

  return assembleFeedPage({
    supabase,
    tenantId,
    locale,
    viewerId,
    // El RPC puede haber contestado UNA de las dos: se aprovecha la que vino
    // (mismo criterio que loadParaTiPage).
    postRows: rpcPosts ?? ((postsResult.data ?? []) as PostRow[]),
    listingRows: rpcListings ?? ((listingsResult.data ?? []) as ListingRow[]),
    guideResult: { data: null },
  });
}
