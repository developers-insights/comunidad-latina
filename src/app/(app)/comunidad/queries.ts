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
  LOST_FOUND_KIND,
  RESOURCE_COLUMNS,
  parseLostFoundAttrs,
  sanitizeAreaFilter,
  sortCasesOpenFirst,
  sortNeedsFirst,
  supabaseSinTiparComunidad,
  toHelpNotice,
  toResourceGroups,
  type HelpDirection,
  type HelpNotice,
  type HelpNoticeRow,
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
// Ayuda mutua — `public.community_help_notices` (0120)
//
// Todo con el cliente del USUARIO, como el resto del archivo: la RLS decide
// qué se ve, y acá decide más que en ningún otro lado. La policy de SELECT de
// esta tabla NO incluye a `anon` (§4 de la 0120), así que para alguien sin
// sesión estas funciones devuelven vacío — no es un bug, es la medida: un
// tablón de personas ofreciendo ayuda, indexable desde afuera, sería el padrón
// que §5.4 existe para que no exista.
// ===========================================================================

const HELP_PAGE_SIZE = 12;

export interface HelpBoardFilters {
  tenantId: string;
  viewerId: string | null;
  topic?: HelpTopic | null;
  direction?: HelpDirection | null;
  /** Zona tal cual la tecleó la persona; acá se sanitiza para el `ilike`. */
  area?: string | null;
  cursor?: string | null;
}

export interface HelpBoardPage {
  items: HelpNotice[];
  nextCursor: string | null;
  /** true cuando la consulta falló: la pantalla distingue "no hay" de "no pudimos". */
  failed: boolean;
  /**
   * `failed` porque la RLS/los grants no dejan mirar sin sesión, que NO es una
   * falla del sistema sino el diseño de esta sección (ver la 0120: el tablón no
   * le da SELECT a `anon` a propósito — un listado público de nombre + barrio +
   * "necesito ayuda con X" es un padrón).
   *
   * Existe separado de `failed` porque las dos situaciones se le cuentan a la
   * persona de manera opuesta: una es "entrá y lo ves", la otra es "se nos
   * rompió algo". Pintar la primera de rojo es acusar al sistema de un error
   * que no cometió, y encima deja a alguien sin saber que la puerta existe.
   */
  needsSession: boolean;
}

/**
 * Nombres de autores y de fichas, por lote y no por fila.
 *
 * Con doce avisos, resolverlo aviso por aviso serían veinticuatro
 * round-trips. Mismo criterio que `loadPublishers` acá arriba.
 *
 * Del autor se pide SÓLO `display_name` — ni avatar, ni Trust Score, ni
 * verificación. En Perdido y encontrado el publicador va con toda su señal de
 * confianza porque ahí alguien dice tener TUS documentos y hay plata de por
 * medio en la estafa clásica; acá no se transa nada: se ofrece un rato. Pintar
 * un puntaje al lado de quien se ofrece a servir un sábado convertiría la
 * ayuda en una competencia de reputación.
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

/**
 * El tablón: lo APROBADO de esta comunidad, paginado por keyset
 * `(created_at, id)` como el resto de los listados del repo.
 *
 * SIN IMPULSOS y sin ningún criterio de orden comprable, igual que Perdido y
 * encontrado: no se le vende el primer lugar a alguien que ofrece ayuda.
 */
export async function fetchHelpBoard(filters: HelpBoardFilters): Promise<HelpBoardPage> {
  const supabase = await createClient();
  const sinTipar = supabaseSinTiparComunidad(supabase);

  let query = sinTipar
    .from("community_help_notices")
    .select(HELP_NOTICE_COLUMNS)
    .eq("tenant_id", filters.tenantId)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(HELP_PAGE_SIZE + 1);

  if (filters.topic) query = query.eq("topic", filters.topic);
  if (filters.direction) query = query.eq("direction", filters.direction);

  // Coincidencia PARCIAL con los comodines de LIKE ya escapados: la gente
  // escribe "Corona" y el aviso dice "Corona, Queens".
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
    // 42501 = permission denied. Acá significa "estás mirando sin sesión": la
    // 0120 le da SELECT sólo a `authenticated`, así que es el camino ESPERADO
    // de un visitante anónimo, no un incidente. Mismo código que documentó la
    // 0114 cuando la música no sonaba sin cuenta, y misma lección: en esta base
    // las tablas nuevas no nacen con grants para `anon`, así que un 42501 hay
    // que leerlo antes de pintarlo de rojo.
    const sinSesion = error.code === "42501";
    if (!sinSesion) {
      console.warn("[comunidad] query del tablón de ayuda falló", { code: error.code });
    }
    return { items: [], nextCursor: null, failed: !sinSesion, needsSession: sinSesion };
  }

  const rows = (data ?? []) as unknown as HelpNoticeRow[];
  const pageRows = rows.slice(0, HELP_PAGE_SIZE);
  const hasMore = rows.length > HELP_PAGE_SIZE;

  const { nombrePorAutor, nombrePorFicha } = await loadHelpLabels(supabase, pageRows);
  const now = new Date();
  const items = pageRows.flatMap((row) => {
    const aviso = toHelpNotice(row, {
      viewerId: filters.viewerId,
      nombrePorAutor,
      nombrePorFicha,
      now,
    });
    return aviso ? [aviso] : [];
  });

  const last = pageRows.at(-1);
  return {
    // Los pedidos arriba DE ESTA PÁGINA. No se ordena en la base a propósito:
    // el keyset necesita su orden estable por (created_at, id) y meterle un
    // criterio más lo rompería — mismo razonamiento que `sortCasesOpenFirst`.
    items: sortNeedsFirst(items),
    nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
    failed: false,
    needsSession: false,
  };
}

/**
 * "Mis avisos": TODOS los estados, incluidos los borradores y los rechazados.
 *
 * Es la única pantalla donde alguien ve el motivo por el que no se le publicó
 * algo. Sin ella, un rechazo sería una desaparición silenciosa — la persona
 * volvería a escribir el mismo aviso y lo volveríamos a rechazar.
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
    console.warn("[comunidad] query de mis avisos de ayuda falló", { code: error.code });
    return [];
  }

  const rows = (data ?? []) as unknown as HelpNoticeRow[];
  const { nombrePorAutor, nombrePorFicha } = await loadHelpLabels(supabase, rows);
  const now = new Date();
  return rows.flatMap((row) => {
    const aviso = toHelpNotice(row, {
      viewerId: input.viewerId,
      nombrePorAutor,
      nombrePorFicha,
      now,
    });
    return aviso ? [aviso] : [];
  });
}

/** Cuántos lugares están pidiendo manos hoy — el número del índice del módulo. */
export async function countOpenHelpNeeds(tenantId: string): Promise<number> {
  const supabase = supabaseSinTiparComunidad(await createClient());
  const { count, error } = await supabase
    .from("community_help_notices")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "approved")
    .eq("direction", "need");

  if (error) {
    console.warn("[comunidad] conteo de pedidos de manos falló", { code: error.code });
    return 0;
  }
  return count ?? 0;
}

/**
 * Cuántas personas se ofrecieron en cada ficha, en UNA consulta para toda la
 * pantalla.
 *
 * Devuelve un Map vacío ante cualquier problema —incluido el más común, que es
 * que quien mira no tenga sesión (la policy pide cuenta)—. La tarjeta
 * simplemente no muestra el contador: nunca un cero que mienta diciendo que
 * nadie se ofreció.
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
    console.warn("[comunidad] conteo de ofrecimientos por ficha falló", { code: error.code });
    return conteo;
  }

  for (const row of (data ?? []) as { resource_id: string | null }[]) {
    if (!row.resource_id) continue;
    conteo.set(row.resource_id, (conteo.get(row.resource_id) ?? 0) + 1);
  }
  return conteo;
}

/**
 * Fichas publicadas de los temas que aceptan avisos, para el selector del
 * formulario de alta.
 *
 * Se traen TODAS de una y el formulario filtra por tema en el cliente: son
 * pocas, no cambian mientras alguien escribe, y así elegir el tema no dispara
 * una consulta nueva a mitad del formulario. `id, name, topic` y nada más —
 * el selector no muestra teléfono ni dirección.
 */
export async function fetchHelpResourceOptions(
  tenantId: string,
  topics: readonly string[],
): Promise<{ id: string; name: string; topic: string }[]> {
  const supabase = supabaseSinTiparComunidad(await createClient());
  const { data, error } = await supabase
    .from("community_resources")
    .select("id, name, topic")
    .eq("status", "published")
    .in("topic", [...topics])
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
    .order("name", { ascending: true })
    .limit(300);

  if (error) {
    console.warn("[comunidad] query de lugares para el alta falló", { code: error.code });
    return [];
  }
  return (data ?? []) as { id: string; name: string; topic: string }[];
}

/**
 * UN borrador propio, para volver a abrirlo en el formulario.
 *
 * Los tres `eq` no son redundantes con la RLS: son lo que hace que "no existe",
 * "es de otra comunidad", "es de otra persona" y "ya no es un borrador" den
 * todos el mismo `null`. El formulario, ante `null`, simplemente arranca vacío
 * — nunca le confirma a nadie la existencia de un aviso ajeno.
 *
 * `status = 'draft'` es la parte que importa: un aviso ya enviado NO se edita
 * (el trigger de la 0120 lo congela), así que abrirlo en el formulario sería
 * ofrecer algo que la base va a rechazar.
 */
export async function fetchMyHelpDraft(input: {
  avisoId: string;
  tenantId: string;
  viewerId: string;
}): Promise<HelpNoticeRow | null> {
  const supabase = supabaseSinTiparComunidad(await createClient());
  const { data, error } = await supabase
    .from("community_help_notices")
    .select(HELP_NOTICE_COLUMNS)
    .eq("id", input.avisoId)
    .eq("tenant_id", input.tenantId)
    .eq("created_by", input.viewerId)
    .eq("status", "draft")
    .maybeSingle();

  if (error) {
    console.warn("[comunidad] query del borrador de ayuda falló", { code: error.code });
    return null;
  }
  return (data ?? null) as unknown as HelpNoticeRow | null;
}
