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
  LOST_FOUND_KIND,
  RESOURCE_COLUMNS,
  parseLostFoundAttrs,
  sanitizeAreaFilter,
  sortCasesOpenFirst,
  supabaseSinTiparComunidad,
  toResourceGroups,
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
