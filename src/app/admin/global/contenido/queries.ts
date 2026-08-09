import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import { encodeCursor, decodeCursor } from "@/components/listings/helpers";
import { RESOURCES, RESOURCE_KEYS, type ResourceKey } from "./resources";

/**
 * LECTURAS de los listados por comunidad (panel Global).
 *
 * PAGINACIÓN POR CURSOR, NUNCA POR OFFSET (ARQUITECTURA §6). El cursor es
 * `created_at|id` — el mismo formato y los mismos validadores que usa el resto
 * de la app (`components/listings/helpers`), así que un cursor pegado a mano
 * con basura adentro se descarta antes de tocar Postgres. Con offset, saltar a
 * la página 40 de una comunidad grande obliga a Postgres a leer y tirar las 39
 * anteriores en CADA request; con keyset, cada página cuesta lo mismo.
 *
 * TODO va con el cliente del staff. Las policies de `listings`, `posts` y
 * `creator_profiles` tienen rama `app.is_global_admin()` y `profiles` es de
 * lectura pública: mirar otra comunidad NO necesita service role. Y como no lo
 * necesita, tampoco lo usa — si mañana alguien le quita a `global_admin` esa
 * rama en la base, esta pantalla se queda vacía en vez de seguir mostrando
 * datos que ya no le corresponden.
 */

const PAGE_SIZE = 25;

export interface ContentItem {
  id: string;
  title: string;
  subtitle: string | null;
  status: string | null;
  createdAt: string;
  /** Quién lo publicó, si se pudo resolver. */
  authorName: string | null;
}

export interface ContentPage {
  items: ContentItem[];
  /** Cursor de la próxima página, o `null` si esta era la última. */
  nextCursor: string | null;
  /** true si la consulta falló (distinto de "no hay nada"). */
  failed: boolean;
}

type StaffClient = SupabaseClient<Database>;

/** Primeras palabras de un texto largo, sin cortar a mitad de palabra. */
function excerpt(text: string, max = 90): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 40 ? lastSpace : max)}…`;
}

const POST_KIND_LABEL: Record<string, string> = {
  text: "Texto",
  photo: "Foto",
  video: "Video",
  poll: "Encuesta",
  listing: "Aviso compartido",
};

/**
 * Aplica el filtro de keyset sobre una query ya armada.
 *
 * `idColumn` es parámetro porque `creator_profiles` no tiene `id`: su clave es
 * `profile_id`. El valor interpolado ya pasó por `decodeCursor`, que sólo deja
 * salir un timestamp ISO canónico y un uuid — nada que pueda romper la sintaxis
 * del filtro `.or()` de PostgREST.
 */
function applyCursor<T extends { or: (filter: string) => T }>(
  query: T,
  cursor: { createdAt: string; id: string } | null,
  idColumn: string,
): T {
  if (!cursor) return query;
  return query.or(
    `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",${idColumn}.lt."${cursor.id}")`,
  );
}

/** Nombres de quienes publicaron, en UNA consulta y no una por fila. */
async function resolveAuthors(
  supabase: StaffClient,
  ids: Array<string | null>,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const { data } = await supabase.from("profiles").select("id, display_name").in("id", unique);
  return new Map((data ?? []).map((row) => [row.id, row.display_name]));
}

export async function fetchContentPage(
  supabase: StaffClient,
  input: { tenantId: string; resource: ResourceKey; cursor: string | null },
): Promise<ContentPage> {
  const cursor = decodeCursor(input.cursor ?? undefined);
  const source = RESOURCES[input.resource].source;

  // Se pide UNO MÁS que el tamaño de página: si vuelve, hay página siguiente.
  // Es más barato y más exacto que preguntar por el total en cada request.
  const limit = PAGE_SIZE + 1;

  if (source.table === "profiles") {
    let query = supabase
      .from("profiles")
      .select("id, display_name, role, account_status, created_at")
      .eq("tenant_id", input.tenantId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    query = applyCursor(query, cursor, "id");

    const { data, error } = await query;
    if (error) {
      console.error("[admin/contenido] usuarios:", error.message);
      return { items: [], nextCursor: null, failed: true };
    }
    return toPage(
      (data ?? []).map((row) => ({
        id: row.id,
        title: row.display_name,
        subtitle: row.role === "member" ? null : `Rol: ${row.role}`,
        status: row.account_status,
        createdAt: row.created_at,
        authorName: null,
      })),
    );
  }

  if (source.table === "posts") {
    let query = supabase
      .from("posts")
      .select("id, body, kind, status, created_at, author_id")
      .eq("tenant_id", input.tenantId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    query = applyCursor(query, cursor, "id");

    const { data, error } = await query;
    if (error) {
      console.error("[admin/contenido] publicaciones:", error.message);
      return { items: [], nextCursor: null, failed: true };
    }
    const rows = data ?? [];
    const authors = await resolveAuthors(supabase, rows.map((row) => row.author_id));
    return toPage(
      rows.map((row) => ({
        id: row.id,
        title: excerpt(row.body) || POST_KIND_LABEL[row.kind] || "Publicación",
        subtitle: POST_KIND_LABEL[row.kind] ?? null,
        status: row.status,
        createdAt: row.created_at,
        authorName: row.author_id ? (authors.get(row.author_id) ?? null) : null,
      })),
    );
  }

  if (source.table === "creator_profiles") {
    let query = supabase
      .from("creator_profiles")
      .select("profile_id, headline, categories, status, created_at")
      .eq("tenant_id", input.tenantId)
      .order("created_at", { ascending: false })
      .order("profile_id", { ascending: false })
      .limit(limit);
    query = applyCursor(query, cursor, "profile_id");

    const { data, error } = await query;
    if (error) {
      console.error("[admin/contenido] influencers:", error.message);
      return { items: [], nextCursor: null, failed: true };
    }
    const rows = data ?? [];
    const authors = await resolveAuthors(supabase, rows.map((row) => row.profile_id));
    return toPage(
      rows.map((row) => ({
        id: row.profile_id,
        title: authors.get(row.profile_id) ?? row.headline,
        subtitle: row.categories.length > 0 ? row.categories.join(" · ") : row.headline,
        status: row.status,
        createdAt: row.created_at,
        authorName: null,
      })),
    );
  }

  // Resto: los seis verticales que viven en `listings`, separados por `kind`.
  let query = supabase
    .from("listings")
    .select("id, title, area_label, status, created_at, created_by, publisher_name")
    .eq("tenant_id", input.tenantId)
    .eq("kind", source.kind)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  query = applyCursor(query, cursor, "id");

  const { data, error } = await query;
  if (error) {
    console.error(`[admin/contenido] ${input.resource}:`, error.message);
    return { items: [], nextCursor: null, failed: true };
  }
  const rows = data ?? [];
  const authors = await resolveAuthors(supabase, rows.map((row) => row.created_by));
  return toPage(
    rows.map((row) => ({
      id: row.id,
      title: row.title,
      subtitle: row.area_label,
      status: row.status,
      createdAt: row.created_at,
      authorName: row.created_by
        ? (authors.get(row.created_by) ?? null)
        : (row.publisher_name ?? "Publicado por la plataforma"),
    })),
  );
}

function toPage(items: ContentItem[]): ContentPage {
  const hasMore = items.length > PAGE_SIZE;
  const page = hasMore ? items.slice(0, PAGE_SIZE) : items;
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    failed: false,
  };
}

/**
 * Cuántos hay de cada cosa en esta comunidad, para los contadores de las
 * pestañas. Son `count: "exact", head: true` — no traen filas, sólo el número.
 *
 * Un conteo que falla vuelve como `null`, no como 0: la pestaña muestra su
 * etiqueta sin número en vez de afirmar que no hay nada.
 */
export async function fetchResourceCounts(
  supabase: StaffClient,
  tenantId: string,
): Promise<Record<ResourceKey, number | null>> {
  const entries = await Promise.all(
    RESOURCE_KEYS.map(async (key) => {
      const source = RESOURCES[key].source;
      const query =
        source.table === "profiles"
          ? supabase
              .from("profiles")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", tenantId)
          : source.table === "posts"
            ? supabase
                .from("posts")
                .select("id", { count: "exact", head: true })
                .eq("tenant_id", tenantId)
            : source.table === "creator_profiles"
              ? supabase
                  .from("creator_profiles")
                  .select("profile_id", { count: "exact", head: true })
                  .eq("tenant_id", tenantId)
              : supabase
                  .from("listings")
                  .select("id", { count: "exact", head: true })
                  .eq("tenant_id", tenantId)
                  .eq("kind", source.kind);

      const { count, error } = await query;
      return [key, error ? null : (count ?? 0)] as const;
    }),
  );

  return Object.fromEntries(entries) as Record<ResourceKey, number | null>;
}
