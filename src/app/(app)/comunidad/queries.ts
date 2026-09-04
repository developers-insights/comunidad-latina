import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  buildTrustSignals,
  decodeCursor,
  encodeCursor,
  allPhotoUrls,
  toTrustLevel,
  type PublisherView,
} from "@/components/listings";
import {
  HELP_NOTICE_COLUMNS,
  HELP_REPLY_COLUMNS,
  LOST_FOUND_KIND,
  RESOURCE_COLUMNS,
  parseLostFoundAttrs,
  sanitizeAreaFilter,
  sanitizeSearchFilter,
  sortCasesOpenFirst,
  supabaseSinTiparComunidad,
  toHelpNotice,
  toHelpReply,
  toResourceGroups,
  type HelpNotice,
  type HelpNoticeRow,
  type HelpReply,
  type HelpReplyRow,
  type HelpTopic,
  type LostFoundCase,
  type LostFoundCategory,
  type LostFoundType,
  type ResourceGroup,
  type ResourceRow,
} from "@/lib/comunidad";
import type { Tables } from "@/lib/types/database.types";
import { timeAgo } from "@/lib/utils";

/**
 * LECTURAS del módulo Comunidad.
 *
 * Todo con el cliente del USUARIO: la RLS decide qué se ve. Ante cualquier
 * error se devuelve vacío y se deja el `console.warn` con el código — el
 * criterio del repo (una consulta rota no tira la pantalla), pero nunca en
 * silencio: el incidente de la 0085 fue exactamente eso, la app vacía sin un
 * solo error visible.
 *
 * LAS GUÍAS NO SE LEEN ACÁ. Ya existen `fetchPublishedGuides` y
 * `fetchGuideBySlug` en `@/components/marketing/data`, con su cache de 600s por
 * tenant y su tag "guides". Duplicarlas para la app significaría dos consultas
 * distintas al mismo contenido y dos caches que se desincronizan: las páginas
 * de Comunidad importan ESAS funciones tal cual.
 */

// ===========================================================================
// Recursos (directorio de ayuda)
// ===========================================================================

/**
 * Recursos publicados de esta comunidad MÁS los globales (`tenant_id is null`),
 * ya agrupados por tema. Mismo criterio de visibilidad que las guías (0007/0096):
 * un consulado le sirve a todas las comunidades y duplicarlo por tenant sería
 * garantizar que alguna copia quede vieja.
 */
export async function fetchResourceGroups(tenantId: string): Promise<ResourceGroup[]> {
  const supabase = supabaseSinTiparComunidad(await createClient());

  const { data, error } = await supabase
    .from("community_resources")
    .select(RESOURCE_COLUMNS)
    .eq("status", "published")
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
    .order("name", { ascending: true })
    .limit(400);

  if (error) {
    console.warn("[comunidad] query de recursos falló", { code: error.code });
    return [];
  }

  // Acá se recupera el tipado: la fila cruda entra como ResourceRow y sale
  // filtrada por `toResourceGroups`, que descarta todo lo que no tenga fuente
  // verificable (ver src/lib/comunidad/recursos.ts).
  //
  // El doble cast por `unknown` es el precio del cliente sin tipar: sin el
  // esquema generado, PostgREST no puede inferir la forma de un `select()` cuya
  // lista de columnas es una constante armada en runtime, y devuelve su tipo de
  // error. Se paga UNA vez, acá, y la fila queda tipada de la línea siguiente
  // en adelante.
  return toResourceGroups((data ?? []) as unknown as ResourceRow[]);
}

// ===========================================================================
// Perdido y encontrado
// ===========================================================================

const PAGE_SIZE = 12;

const CASE_COLUMNS =
  "id, title, description, area_label, photos, attrs, created_at, published_at, created_by";

type CaseRow = Pick<
  Tables<"listings">,
  | "id"
  | "title"
  | "description"
  | "area_label"
  | "photos"
  | "attrs"
  | "created_at"
  | "published_at"
  | "created_by"
>;

type PublisherProfileRow = Pick<
  Tables<"profiles">,
  "id" | "display_name" | "avatar_url" | "identity_verified"
>;
type PublisherTrustRow = Pick<Tables<"trust_scores">, "profile_id" | "score" | "level" | "signals">;

/** Un caso con quién lo publicó — lo que consumen la card y el detalle. */
export interface LostFoundCaseView extends LostFoundCase {
  /**
   * Quién publica. Importa MÁS que en otros módulos: alguien que dice tener tus
   * documentos es exactamente el lugar donde aparece un estafador, así que la
   * señal de confianza que ya calcula la plataforma se muestra igual que en
   * Vivienda o Empleos, sin inventar una propia.
   */
  publisher: PublisherView;
}

export interface LostFoundPage {
  items: LostFoundCaseView[];
  nextCursor: string | null;
}

export interface LostFoundFilters {
  tenantId: string;
  viewerId: string | null;
  type?: LostFoundType | null;
  category?: LostFoundCategory | null;
  /** Zona tal cual la tecleó la persona; acá se sanitiza para el `ilike`. */
  area?: string | null;
  cursor?: string | null;
}

/** Fila cruda → vista, sin tocar la base. Exportada para poder testearla sola. */
export function toLostFoundCaseView(
  row: CaseRow,
  viewerId: string | null,
  profileById: ReadonlyMap<string, PublisherProfileRow>,
  trustById: ReadonlyMap<string, PublisherTrustRow>,
  now = new Date(),
): LostFoundCaseView {
  const attrs = parseLostFoundAttrs(row.attrs);

  let publisher: PublisherView = null;
  if (row.created_by) {
    const profile = profileById.get(row.created_by);
    const trust = trustById.get(row.created_by);
    publisher = {
      type: "member",
      profileId: row.created_by,
      displayName: profile?.display_name ?? "Alguien de la comunidad",
      avatarUrl: profile?.avatar_url ?? null,
      score: trust?.score ?? 0,
      level: toTrustLevel(trust?.level),
      signals: buildTrustSignals(trust?.signals ?? {}, profile?.identity_verified ?? false),
    };
  }

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    areaLabel: row.area_label,
    photos: allPhotoUrls(row.photos),
    type: attrs.type,
    category: attrs.category,
    happenedOn: attrs.happenedOn,
    resolvedAt: attrs.resolvedAt,
    publishedAtLabel: timeAgo(row.published_at ?? row.created_at, now),
    isOwner: Boolean(viewerId && row.created_by === viewerId),
    publisher,
  };
}

/** Perfil + Trust Score de varios publicadores, en dos consultas y no N. */
async function loadPublishers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: readonly CaseRow[],
): Promise<{
  profileById: Map<string, PublisherProfileRow>;
  trustById: Map<string, PublisherTrustRow>;
}> {
  const memberIds = [
    ...new Set(rows.map((row) => row.created_by).filter((id): id is string => Boolean(id))),
  ];
  if (memberIds.length === 0) {
    return { profileById: new Map(), trustById: new Map() };
  }

  const [{ data: profiles }, { data: trusts }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, avatar_url, identity_verified")
      .in("id", memberIds),
    supabase.from("trust_scores").select("profile_id, score, level, signals").in("profile_id", memberIds),
  ]);

  return {
    profileById: new Map((profiles ?? []).map((row) => [row.id, row])),
    trustById: new Map((trusts ?? []).map((row) => [row.profile_id, row])),
  };
}

/**
 * Listado paginado por keyset `(created_at, id)` — el mismo patrón que el resto
 * de los módulos, para que "ver más" no repita ni saltee filas cuando alguien
 * publica mientras vos scrolleás.
 *
 * SIN IMPULSOS. Los otros listados intercalan avisos patrocinados; acá no, y no
 * es un olvido: no se le vende posición a alguien que está buscando el
 * documento que perdió.
 */
export async function fetchLostFoundPage(filters: LostFoundFilters): Promise<LostFoundPage> {
  const supabase = await createClient();

  let query = supabase
    .from("listings")
    .select(CASE_COLUMNS)
    .eq("tenant_id", filters.tenantId)
    .eq("kind", LOST_FOUND_KIND)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (filters.type) query = query.eq("attrs->>lf_type", filters.type);
  if (filters.category) query = query.eq("attrs->>lf_category", filters.category);

  // Zona: `ilike` sobre `area_label` con los comodines de LIKE ya escapados
  // (sanitizeAreaFilter). Es una coincidencia PARCIAL a propósito: la gente
  // escribe "Jackson" y el aviso dice "Jackson Heights, Queens".
  const area = sanitizeAreaFilter(filters.area);
  if (area) query = query.ilike("area_label", `%${area}%`);

  const cursor = decodeCursor(filters.cursor || undefined);
  if (cursor) {
    query = query.or(
      `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt."${cursor.id}")`,
    );
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[comunidad] query de perdidos falló", { code: error.code });
    return { items: [], nextCursor: null };
  }

  const rows = (data ?? []) as CaseRow[];
  const pageRows = rows.slice(0, PAGE_SIZE);
  const hasMore = rows.length > PAGE_SIZE;

  const { profileById, trustById } = await loadPublishers(supabase, pageRows);
  const now = new Date();
  const items = pageRows.map((row) =>
    toLostFoundCaseView(row, filters.viewerId, profileById, trustById, now),
  );

  // Resueltos al final DE ESTA PÁGINA. No se ordena en la base a propósito: el
  // keyset necesita un orden estable por (created_at, id), y meterle un criterio
  // más lo rompería. Reordenar la página que ya se trajo alcanza para que lo
  // abierto quede arriba sin esconder lo que apareció.
  const last = pageRows.at(-1);
  return {
    items: sortCasesOpenFirst(items),
    nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

/** Un caso por id, o null. La RLS ya filtra: sólo `published` es público. */
export async function fetchLostFoundCase(input: {
  id: string;
  tenantId: string;
  viewerId: string | null;
}): Promise<LostFoundCaseView | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("listings")
    .select(CASE_COLUMNS)
    .eq("id", input.id)
    .eq("tenant_id", input.tenantId)
    .eq("kind", LOST_FOUND_KIND)
    .maybeSingle();

  if (error) {
    console.warn("[comunidad] query del caso falló", { code: error.code });
    return null;
  }
  if (!data) return null;

  const row = data as CaseRow;
  const { profileById, trustById } = await loadPublishers(supabase, [row]);
  return toLostFoundCaseView(row, input.viewerId, profileById, trustById);
}

/** Cuántos casos abiertos hay hoy — el número del índice del módulo. */
export async function countOpenCases(tenantId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("listings")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("kind", LOST_FOUND_KIND)
    .eq("status", "published")
    .is("attrs->>lf_resolved_at", null);

  if (error) {
    console.warn("[comunidad] conteo de casos abiertos falló", { code: error.code });
    return 0;
  }
  return count ?? 0;
}

// ===========================================================================
// Pedir ayuda — `community_help_notices` (0120) + `community_help_replies` (0130)
//
// Todo con el cliente del USUARIO, como el resto del archivo: la RLS decide
// qué se ve, y acá decide más que en ningún otro lado. La policy de SELECT de
// estas dos tablas NO incluye a `anon` (§4 de la 0120, §2.3 de la 0130), así
// que para alguien sin sesión estas funciones devuelven vacío — no es un bug,
// es la medida: un tablón de gente pidiendo ayuda, indexable desde afuera,
// sería el padrón que §5.4 existe para que no exista.
// ===========================================================================

const HELP_PAGE_SIZE = 12;

/** Tope de respuestas por pedido en una sola lectura. Ver `fetchHelpReplies`. */
const HELP_REPLIES_LIMIT = 200;

export interface HelpBoardFilters {
  tenantId: string;
  viewerId: string | null;
  topic?: HelpTopic | null;
  /** Zona tal cual la tecleó la persona; acá se sanitiza para el `ilike`. */
  area?: string | null;
  /** Búsqueda libre sobre título y cuerpo. Se sanitiza antes de tocar la base. */
  search?: string | null;
  cursor?: string | null;
}

export interface HelpBoardPage {
  items: HelpNotice[];
  nextCursor: string | null;
  /** true cuando la consulta falló: la pantalla distingue "no hay" de "no pudimos". */
  failed: boolean;
  /**
   * `failed` porque la RLS/los grants no dejan mirar sin sesión, que NO es una
   * falla del sistema sino el diseño de esta sección. Existe separado de
   * `failed` porque las dos situaciones se le cuentan a la persona de manera
   * opuesta: una es "entrá y lo ves", la otra es "se nos rompió algo". Pintar
   * la primera de rojo es acusar al sistema de un error que no cometió, y
   * encima deja a alguien sin saber que la puerta existe.
   */
  needsSession: boolean;
}

/**
 * Nombres de autores y de fichas, por lote y no por fila.
 *
 * Con doce pedidos, resolverlo uno por uno serían veinticuatro round-trips.
 * Mismo criterio que `loadPublishers` acá arriba.
 *
 * Del autor se pide SÓLO `display_name` — ni avatar, ni Trust Score, ni
 * verificación. En Perdido y encontrado el publicador va con toda su señal de
 * confianza porque ahí alguien dice tener TUS documentos y hay plata de por
 * medio en la estafa clásica; acá no se transa nada: alguien pregunta algo.
 * Pintar un puntaje al lado de quien pide ayuda sería ponerle nota a la
 * necesidad.
 */
async function loadHelpLabels(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: readonly HelpNoticeRow[],
): Promise<{
  nombrePorAutor: Map<string, string | null>;
  nombrePorFicha: Map<string, string>;
}> {
  const autores = [...new Set(rows.map((row) => row.created_by))];
  const fichas = [
    ...new Set(rows.map((row) => row.resource_id).filter((id): id is string => Boolean(id))),
  ];

  const sinTipar = supabaseSinTiparComunidad(supabase);
  const [perfiles, recursos] = await Promise.all([
    autores.length > 0
      ? supabase.from("profiles").select("id, display_name").in("id", autores)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
    fichas.length > 0
      ? sinTipar.from("community_resources").select("id, name").in("id", fichas)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  return {
    nombrePorAutor: new Map(
      ((perfiles.data ?? []) as { id: string; display_name: string | null }[]).map((row) => [
        row.id,
        row.display_name,
      ]),
    ),
    nombrePorFicha: new Map(
      ((recursos.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]),
    ),
  };
}

/** 42501 = permission denied. Acá significa "estás mirando sin sesión". */
function esFaltaDeSesion(code: string | undefined): boolean {
  return code === "42501";
}

/**
 * El tablón: los PEDIDOS publicados de esta comunidad, lo más nuevo arriba,
 * paginado por keyset `(created_at, id)` como el resto de los listados del
 * repo.
 *
 * `direction = 'need'` está en el `where` y no sólo en el índice: la 0130
 * archivó los ofrecimientos que había, pero un filtro que depende de que un
 * UPDATE de migración haya corrido bien es un filtro que un día no filtra.
 *
 * SIN IMPULSOS y sin ningún criterio de orden comprable, igual que Perdido y
 * encontrado: no se le vende el primer lugar a alguien que necesita algo.
 */
export async function fetchHelpBoard(filters: HelpBoardFilters): Promise<HelpBoardPage> {
  const supabase = await createClient();
  const sinTipar = supabaseSinTiparComunidad(supabase);

  let query = sinTipar
    .from("community_help_notices")
    .select(HELP_NOTICE_COLUMNS)
    .eq("tenant_id", filters.tenantId)
    .eq("status", "approved")
    .eq("direction", "need")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(HELP_PAGE_SIZE + 1);

  if (filters.topic) query = query.eq("topic", filters.topic);

  // Coincidencia PARCIAL con los comodines de LIKE ya escapados: la gente
  // escribe "Corona" y el pedido dice "Corona, Queens".
  const area = sanitizeAreaFilter(filters.area);
  if (area) query = query.ilike("area_label", `%${area}%`);

  /**
   * Búsqueda: título O cuerpo. Es un `ilike` y no búsqueda de texto completo a
   * propósito — `global_search` (0052) no indexa esta tabla y sumarla sería una
   * migración propia. Con el volumen real de un tablón vecinal (decenas de
   * filas por comunidad) un ilike es instantáneo; el día que deje de serlo, el
   * arreglo es un índice trigram y no reescribir esta pantalla.
   *
   * `sanitizeSearchFilter` es LOAD-BEARING: PostgREST separa las condiciones de
   * un `.or()` con comas, así que una coma sin sacar parte la expresión en dos
   * y el filtro pasa a decir cualquier cosa.
   */
  const busqueda = sanitizeSearchFilter(filters.search);
  if (busqueda) {
    query = query.or(`title.ilike.%${busqueda}%,body.ilike.%${busqueda}%`);
  }

  const cursor = decodeCursor(filters.cursor || undefined);
  if (cursor) {
    query = query.or(
      `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt."${cursor.id}")`,
    );
  }

  const { data, error } = await query;
  if (error) {
    // La 0120 le da SELECT sólo a `authenticated`, así que un 42501 es el
    // camino ESPERADO de un visitante anónimo, no un incidente. Mismo código
    // que documentó la 0114 cuando la música no sonaba sin cuenta, y misma
    // lección: en esta base las tablas nuevas no nacen con grants para `anon`,
    // así que un 42501 hay que leerlo antes de pintarlo de rojo.
    const sinSesion = esFaltaDeSesion(error.code);
    if (!sinSesion) {
      console.warn("[comunidad] query del tablón de pedidos falló", { code: error.code });
    }
    return { items: [], nextCursor: null, failed: !sinSesion, needsSession: sinSesion };
  }

  const rows = (data ?? []) as unknown as HelpNoticeRow[];
  const pageRows = rows.slice(0, HELP_PAGE_SIZE);
  const hasMore = rows.length > HELP_PAGE_SIZE;

  const { nombrePorAutor, nombrePorFicha } = await loadHelpLabels(supabase, pageRows);
  const now = new Date();
  const items = pageRows.flatMap((row) => {
    const pedido = toHelpNotice(row, {
      viewerId: filters.viewerId,
      nombrePorAutor,
      nombrePorFicha,
      now,
    });
    return pedido ? [pedido] : [];
  });

  const last = pageRows.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
    failed: false,
    needsSession: false,
  };
}

export interface HelpNoticeDetail {
  pedido: HelpNotice | null;
  needsSession: boolean;
}

/**
 * UN pedido por id, para la pantalla de detalle.
 *
 * El `eq("tenant_id")` no es la seguridad —la RLS ya la hace— pero sí es lo que
 * convierte "no existe", "es de otra comunidad" y "lo ocultó el equipo" en la
 * misma respuesta: `null`. Desde una URL no se puede confirmar la existencia de
 * un pedido ajeno.
 *
 * No filtra por `status`: su autor tiene que poder abrir el suyo aunque esté
 * oculto o resuelto (la RLS le deja ver los propios), y el equipo tiene que
 * poder mirar lo que ocultó. Quien no es ninguno de los dos no recibe la fila.
 */
export async function fetchHelpNotice(input: {
  id: string;
  tenantId: string;
  viewerId: string | null;
}): Promise<HelpNoticeDetail> {
  const supabase = await createClient();
  const sinTipar = supabaseSinTiparComunidad(supabase);

  const { data, error } = await sinTipar
    .from("community_help_notices")
    .select(HELP_NOTICE_COLUMNS)
    .eq("id", input.id)
    .eq("tenant_id", input.tenantId)
    .maybeSingle();

  if (error) {
    const sinSesion = esFaltaDeSesion(error.code);
    if (!sinSesion) {
      console.warn("[comunidad] query del pedido falló", { code: error.code });
    }
    return { pedido: null, needsSession: sinSesion };
  }

  const row = (data ?? null) as unknown as HelpNoticeRow | null;
  if (!row) return { pedido: null, needsSession: false };

  const { nombrePorAutor, nombrePorFicha } = await loadHelpLabels(supabase, [row]);
  return {
    pedido: toHelpNotice(row, {
      viewerId: input.viewerId,
      nombrePorAutor,
      nombrePorFicha,
    }),
    needsSession: false,
  };
}

/**
 * Las respuestas de UN pedido, en orden de conversación (lo más viejo primero:
 * una respuesta contesta a lo de arriba).
 *
 * SIN PAGINADO, y con tope. Un pedido vecinal junta cinco o diez respuestas; el
 * tope de 200 existe para el caso patológico, no para el normal. Paginar un
 * hilo corto es peor experiencia (hay que tocar "ver más" para leer algo que
 * entraba en una pantalla) y esconde justo lo último, que suele ser lo que
 * resolvió el pedido.
 *
 * `toHelpReply` decide qué se muestra: lo visible de todos, más lo propio en
 * cualquier estado. Una respuesta oculta ajena no llega ni al render aunque la
 * RLS se la deje leer al staff.
 */
export async function fetchHelpReplies(input: {
  noticeId: string;
  tenantId: string;
  viewerId: string | null;
}): Promise<HelpReply[]> {
  const supabase = await createClient();
  const sinTipar = supabaseSinTiparComunidad(supabase);

  const { data, error } = await sinTipar
    .from("community_help_replies")
    .select(HELP_REPLY_COLUMNS)
    .eq("notice_id", input.noticeId)
    .eq("tenant_id", input.tenantId)
    .order("created_at", { ascending: true })
    .limit(HELP_REPLIES_LIMIT);

  if (error) {
    if (!esFaltaDeSesion(error.code)) {
      console.warn("[comunidad] query de respuestas falló", { code: error.code });
    }
    return [];
  }

  const rows = (data ?? []) as unknown as HelpReplyRow[];
  if (rows.length === 0) return [];

  const autores = [...new Set(rows.map((row) => row.created_by))];
  const { data: perfiles } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", autores);

  const nombrePorAutor = new Map(
    ((perfiles ?? []) as { id: string; display_name: string | null }[]).map((row) => [
      row.id,
      row.display_name,
    ]),
  );

  const now = new Date();
  return rows.flatMap((row) => {
    const respuesta = toHelpReply(row, { viewerId: input.viewerId, nombrePorAutor, now });
    return respuesta ? [respuesta] : [];
  });
}

/**
 * "Mis pedidos": TODOS los estados, incluidos los ocultos y los resueltos.
 *
 * Es la única pantalla donde alguien ve el motivo por el que el equipo bajó
 * algo suyo. Sin ella, ocultar un pedido sería una desaparición silenciosa — la
 * persona volvería a escribir el mismo texto y lo volveríamos a ocultar.
 */
export async function fetchMyHelpNotices(input: {
  tenantId: string;
  viewerId: string;
}): Promise<HelpNotice[]> {
  const supabase = await createClient();
  const sinTipar = supabaseSinTiparComunidad(supabase);

  const { data, error } = await sinTipar
    .from("community_help_notices")
    .select(HELP_NOTICE_COLUMNS)
    .eq("tenant_id", input.tenantId)
    .eq("created_by", input.viewerId)
    .order("created_at", { ascending: false })
    .limit(60);

  if (error) {
    console.warn("[comunidad] query de mis pedidos falló", { code: error.code });
    return [];
  }

  const rows = (data ?? []) as unknown as HelpNoticeRow[];
  const { nombrePorAutor, nombrePorFicha } = await loadHelpLabels(supabase, rows);
  const now = new Date();
  return rows.flatMap((row) => {
    const pedido = toHelpNotice(row, {
      viewerId: input.viewerId,
      nombrePorAutor,
      nombrePorFicha,
      now,
    });
    return pedido ? [pedido] : [];
  });
}

/** Cuántos pedidos hay abiertos hoy — el número de la tarjeta del índice. */
export async function countPedidosAbiertos(tenantId: string): Promise<number> {
  const supabase = supabaseSinTiparComunidad(await createClient());
  const { count, error } = await supabase
    .from("community_help_notices")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "approved")
    .eq("direction", "need");

  if (error) {
    // Sin sesión no hay número, y está bien: nunca un cero que diga que nadie
    // necesita nada.
    if (!esFaltaDeSesion(error.code)) {
      console.warn("[comunidad] conteo de pedidos falló", { code: error.code });
    }
    return 0;
  }
  return count ?? 0;
}

/**
 * Cuántas personas se ofrecieron en cada ficha del directorio.
 *
 * LEGADO de la 0120. Sigue exportada porque la consume
 * `comunidad/recursos/page.tsx`, que es de otro frente y no se toca en esta
 * ronda; después de la 0130 devuelve ceros (los ofrecimientos quedaron
 * archivados) y ninguna tarjeta dibuja el número. Cuando ese frente limpie su
 * pantalla, esta función se va con él.
 *
 * Devuelve un Map vacío ante cualquier problema —incluido el más común, que es
 * que quien mira no tenga sesión—. Nunca un cero que mienta.
 */
export async function countOffersByResource(
  tenantId: string,
  resourceIds: readonly string[],
): Promise<Map<string, number>> {
  const conteo = new Map<string, number>();
  if (resourceIds.length === 0) return conteo;

  const supabase = supabaseSinTiparComunidad(await createClient());
  const { data, error } = await supabase
    .from("community_help_notices")
    .select("resource_id")
    .eq("tenant_id", tenantId)
    .eq("status", "approved")
    .eq("direction", "offer")
    .in("resource_id", [...resourceIds])
    .limit(1000);

  if (error) {
    if (!esFaltaDeSesion(error.code)) {
      console.warn("[comunidad] conteo de ofrecimientos por ficha falló", { code: error.code });
    }
    return conteo;
  }

  for (const row of (data ?? []) as { resource_id: string | null }[]) {
    if (!row.resource_id) continue;
    conteo.set(row.resource_id, (conteo.get(row.resource_id) ?? 0) + 1);
  }
  return conteo;
}