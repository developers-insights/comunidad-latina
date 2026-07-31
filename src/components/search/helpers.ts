import { listingPhotoUrl } from "@/components/listings/helpers";
import { mediaKindOf, postMediaUrl } from "@/components/feed/helpers";

/**
 * Helpers PUROS de la búsqueda global. Sin dependencias de servidor ni de
 * React: los consume el route handler (servidor), la isla cliente y los tests.
 *
 * El contrato de datos lo fija la RPC `public.global_search` (migración 0044,
 * ruteo de video re-creado en 0046). Lo que la base NO hace y hacemos acá:
 *   · resolver `image_url`, que sale CRUDO (ruta de Storage o URL absoluta);
 *   · decidir si un resultado de video es imagen o video (`mediaKindOf`);
 *   · agrupar y ordenar los grupos entre sí — `rank` ordena DENTRO del grupo
 *     y entre tipos no es comparable (ts_rank vs similarity).
 */

// ---------------------------------------------------------------------------
// Tipos de resultado (el enum de `result_type` de la RPC, en orden de pantalla)
// ---------------------------------------------------------------------------

/**
 * El orden en que se pintan los grupos. Es el del contrato escrito
 * (feedback consolidado §1) y NO el que devuelve la RPC: la base agrupa por
 * eficiencia de scan, la pantalla agrupa por lo que la gente busca más.
 *
 * Es una constante y no un `sort()` por cantidad de resultados a propósito: si
 * el orden de los grupos cambiara en cada tecleo, la lista bailaría bajo el
 * dedo y tocar un resultado se volvería una lotería.
 */
export const SEARCH_RESULT_TYPES = [
  "personas",
  "propiedades",
  "negocios",
  "profesionales",
  "eventos",
  "empleos",
  "marketplace",
  "videos",
  "publicaciones",
] as const;

export type SearchResultType = (typeof SEARCH_RESULT_TYPES)[number];

const TYPE_SET = new Set<string>(SEARCH_RESULT_TYPES);

export function isSearchResultType(value: string): value is SearchResultType {
  return TYPE_SET.has(value);
}

// ---------------------------------------------------------------------------
// Metadatos de grupo: etiqueta, acento y a dónde lleva "Ver todas…"
// ---------------------------------------------------------------------------

export interface SearchGroupMeta {
  /** Encabezado del grupo, en plural ("Propiedades"). */
  label: string;
  /**
   * El "Ver todas/todos los…" completo y ya concordado en género. Escrito
   * entero y no armado con plantilla: "Ver todas las {label}" produce «Ver
   * todas las negocios» y en español eso se lee como un error, no como copy.
   */
  seeAllLabel: string;
  /** Variable de acento del módulo (globals.css). Decorativa, nunca texto. */
  accentVar: string;
  /** Listado del módulo. `null` = el módulo no tiene listado propio. */
  listHref: string | null;
  /**
   * Nombre REAL del parámetro de búsqueda del listado, verificado contra cada
   * página. `null` = ese listado todavía no acepta término de búsqueda.
   */
  queryParam: string | null;
}

/**
 * VERIFICADO contra cada página (no asumido):
 *   · /propiedades  → `?q=`        (listings/listing-filters.tsx)
 *   · /marketplace  → `?q=`        (marketplace/marketplace-search-bar.tsx)
 *   · /eventos      → `?q=`        (lo agrega este mismo frente)
 *   · /negocios     → `?q=`        (lo agrega este mismo frente)
 *   · /profesionales→ sólo `?rubro=`  — sin término de búsqueda todavía
 *   · /empleos      → sólo `?tipo=`   — sin término de búsqueda todavía
 *   · /videos       → sólo `?scope=`/`?start=`
 *   · /feed         → sólo `?tab=`
 *   · personas      → no hay directorio de personas (el perfil es por id)
 *
 * Donde `queryParam` es null NO se pinta "Ver todos los…": mandar a alguien a
 * un listado que descarta silenciosamente lo que escribió es peor que no
 * ofrecer el link. Cuando esos módulos acepten `?q=`, se completa acá y el
 * link aparece solo.
 */
export const SEARCH_GROUP_META: Record<SearchResultType, SearchGroupMeta> = {
  personas: {
    label: "Personas",
    seeAllLabel: "Ver todas las personas",
    accentVar: "var(--accent-feed)",
    listHref: null,
    queryParam: null,
  },
  propiedades: {
    label: "Propiedades",
    seeAllLabel: "Ver todas las propiedades",
    accentVar: "var(--accent-vivienda)",
    listHref: "/propiedades",
    queryParam: "q",
  },
  negocios: {
    label: "Negocios",
    seeAllLabel: "Ver todos los negocios",
    accentVar: "var(--accent-negocios)",
    listHref: "/negocios",
    queryParam: "q",
  },
  profesionales: {
    label: "Profesionales",
    seeAllLabel: "Ver todos los profesionales",
    accentVar: "var(--accent-profesionales)",
    listHref: "/profesionales",
    queryParam: null,
  },
  eventos: {
    label: "Eventos",
    seeAllLabel: "Ver todos los eventos",
    accentVar: "var(--accent-eventos)",
    listHref: "/eventos",
    queryParam: "q",
  },
  empleos: {
    label: "Empleos",
    seeAllLabel: "Ver todos los empleos",
    accentVar: "var(--accent-empleos)",
    listHref: "/empleos",
    queryParam: null,
  },
  marketplace: {
    label: "Marketplace",
    seeAllLabel: "Ver todo el marketplace",
    accentVar: "var(--accent-marketplace)",
    listHref: "/marketplace",
    queryParam: "q",
  },
  videos: {
    label: "Videos Cortos",
    seeAllLabel: "Ver todos los videos",
    accentVar: "var(--accent-feed)",
    listHref: "/videos",
    queryParam: null,
  },
  publicaciones: {
    label: "Publicaciones",
    seeAllLabel: "Ver todas las publicaciones",
    accentVar: "var(--accent-feed)",
    listHref: "/feed",
    queryParam: null,
  },
};

/**
 * Link al buscador del módulo con el término ya cargado, o `null` si ese
 * listado todavía no acepta término (ver la tabla de arriba).
 */
export function moduleSearchHref(type: SearchResultType, query: string): string | null {
  const meta = SEARCH_GROUP_META[type];
  const term = sanitizeSearchQuery(query);
  if (!meta.listHref || !meta.queryParam || term.length === 0) return null;
  return `${meta.listHref}?${meta.queryParam}=${encodeURIComponent(term)}`;
}

// ---------------------------------------------------------------------------
// Normalización del término
// ---------------------------------------------------------------------------

/**
 * Mínimo de la RPC: con menos de 2 caracteres devuelve vacío sin escanear.
 * Se replica en el cliente para no gastar un round-trip que ya sabemos vacío.
 */
export const MIN_SEARCH_LENGTH = 2;

/** Tope de la RPC (`left(v_q, 80)`). Recortar acá evita mandar de más. */
export const MAX_SEARCH_LENGTH = 80;

/**
 * Espacios colapsados + recorte al tope de la RPC. Colapsar el espacio interno
 * importa para el HISTORIAL: "cuarto  barato" y "cuarto barato" son la misma
 * búsqueda y no pueden ocupar dos de las ocho ranuras.
 */
export function sanitizeSearchQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_SEARCH_LENGTH);
}

/** ¿Vale la pena llamar a la RPC con esto? */
export function isSearchable(value: string): boolean {
  return sanitizeSearchQuery(value).length >= MIN_SEARCH_LENGTH;
}

// ---------------------------------------------------------------------------
// Medios: `image_url` sale CRUDO de la base y se resuelve acá
// ---------------------------------------------------------------------------

export type SearchMediaKind = "image" | "video";

export interface SearchMedia {
  kind: SearchMediaKind;
  /** URL pública ya resuelta (o absoluta, si el seed la guardó así). */
  url: string;
}

/**
 * Resuelve el `image_url` crudo según de qué tabla vino el resultado:
 *   · personas         → `profiles.avatar_url`, que ya se guarda absoluto
 *     (así lo consume `<Avatar src>` en todo el repo);
 *   · avisos           → `listings.photos[1]` → bucket `listing-photos`;
 *   · videos/publicac. → `posts.media[1]` → bucket `post-media`, y el kind se
 *     infiere por extensión porque el array mezcla fotos y videos sin columna
 *     de tipo (0025). Un resultado de "videos" PUEDE traer la ruta del video.
 */
export function resolveSearchMedia(
  type: SearchResultType,
  imageUrl: string | null | undefined,
): SearchMedia | null {
  const raw = imageUrl?.trim();
  if (!raw) return null;

  if (type === "personas") return { kind: "image", url: raw };
  if (type === "videos" || type === "publicaciones") {
    return { kind: mediaKindOf(raw), url: postMediaUrl(raw) };
  }
  return { kind: "image", url: listingPhotoUrl(raw) };
}

// ---------------------------------------------------------------------------
// Agrupado
// ---------------------------------------------------------------------------

/** Una fila cruda de `global_search`, tal como la devuelve PostgREST. */
export interface RawSearchRow {
  result_type: string;
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  href: string;
  rank: number;
}

export interface SearchResultItem {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  media: SearchMedia | null;
  /** Video de una campaña paga (`posts.is_paid_ad`) → se marca "Patrocinado". */
  sponsored: boolean;
}

export interface SearchGroup {
  type: SearchResultType;
  items: SearchResultItem[];
}

export interface SearchPayload {
  /** El término efectivamente consultado, ya normalizado. */
  query: string;
  groups: SearchGroup[];
  total: number;
}

/**
 * Filas crudas → grupos listos para pintar.
 *
 * Reglas:
 *   · el orden DENTRO del grupo es el que ya trae la RPC (`rank`), no se
 *     re-ordena: `rank` no es comparable entre tipos, así que ordenar la lista
 *     entera por rank mezclaría escalas distintas y daría un orden falso;
 *   · el orden ENTRE grupos es `SEARCH_RESULT_TYPES`, fijo;
 *   · grupos vacíos no se emiten (un encabezado sin filas es ruido);
 *   · un `result_type` desconocido se descarta en silencio — si mañana la RPC
 *     agrega un tipo, la UI vieja no se rompe, simplemente no lo muestra.
 *
 * @param sponsoredIds ids de posts con `is_paid_ad` (se piden aparte).
 */
export function groupSearchResults(
  rows: readonly RawSearchRow[],
  sponsoredIds: ReadonlySet<string> = new Set(),
): SearchGroup[] {
  const byType = new Map<SearchResultType, SearchResultItem[]>();

  for (const row of rows) {
    if (!isSearchResultType(row.result_type)) continue;
    const type = row.result_type;
    const sponsored = type === "videos" && sponsoredIds.has(row.id);
    const bucket = byType.get(type) ?? [];
    bucket.push({
      type,
      id: row.id,
      title: row.title,
      subtitle: row.subtitle,
      // UN VIDEO PATROCINADO ABRE SU ANUNCIO, NO EL REEL (contrato §4).
      //
      // `app.video_post_href` (0044) devuelve `/videos?start=id` para TODO
      // video. Su propio comentario dice que la 0046 iba a re-crearla cuando
      // apareciera el video publicitario, y no llegó a hacerlo. El efecto: tocar
      // un resultado patrocinado te manda al scroll de Videos Cortos, donde ese
      // video —por el filtro `video_type='short_video'`— NO existe; el reel
      // arranca con OTROS videos y la persona se fue del anuncio que tocó.
      //
      // Se corrige acá y no en la base porque el dato que hace falta
      // (`is_paid_ad`) ya está resuelto en esta misma línea, y porque el destino
      // correcto —el detalle de la publicación, donde el video se reproduce
      // dentro de su anuncio— es una ruta de la app. Cuando la RPC se re-cree
      // con el href correcto, esto se vuelve un no-op: `/feed/{id}` es el mismo
      // valor que devolvería.
      href: sponsored ? `/feed/${row.id}` : row.href,
      media: resolveSearchMedia(type, row.image_url),
      sponsored,
    });
    byType.set(type, bucket);
  }

  return SEARCH_RESULT_TYPES.filter((type) => (byType.get(type)?.length ?? 0) > 0).map(
    (type) => ({ type, items: byType.get(type) as SearchResultItem[] }),
  );
}

export function countResults(groups: readonly SearchGroup[]): number {
  return groups.reduce((total, group) => total + group.items.length, 0);
}

/**
 * Texto que lee el lector de pantalla cuando llegan resultados: cuántos y de
 * qué tipo. Sin esto, alguien que no ve la pantalla escribe y no pasa nada
 * audible — el buscador en vivo es justamente el caso donde el `aria-live`
 * deja de ser un extra.
 *
 * Ej.: "12 resultados: 3 personas, 5 propiedades, 4 eventos."
 */
export function announceResults(groups: readonly SearchGroup[]): string {
  const total = countResults(groups);
  if (total === 0) return "Sin resultados.";
  const detail = groups
    .map((group) => `${group.items.length} ${SEARCH_GROUP_META[group.type].label.toLowerCase()}`)
    .join(", ");
  return `${total} ${total === 1 ? "resultado" : "resultados"}: ${detail}.`;
}
