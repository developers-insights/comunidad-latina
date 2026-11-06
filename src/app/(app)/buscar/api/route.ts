import { NextResponse } from "next/server";
import { z } from "zod";
import {
  MAX_SEARCH_LENGTH,
  countResults,
  groupSearchResults,
  isSearchable,
  sanitizeSearchQuery,
  type RawSearchRow,
  type SearchPayload,
} from "@/components/search/helpers";
import { clientIpFromHeaders, limit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, getAuthUserId } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";

/**
 * GET /buscar/api?q=… — la búsqueda global de la barra de /buscar.
 *
 * POR QUÉ UN ROUTE HANDLER Y NO UNA SERVER ACTION
 * -----------------------------------------------
 * Esto es una LECTURA que se dispara con cada tecla y que hay que poder
 * CANCELAR. Las server actions no se cancelan (no hay señal que abortar) y Next
 * las serializa por router, así que un tecleo rápido encolaría peticiones que
 * ya no le importan a nadie. Un GET con `AbortController` corta la anterior en
 * el acto. Además es idempotente y sin efectos: el verbo correcto es GET.
 *
 * POR QUÉ VIVE EN /buscar/api Y NO EN /api/buscar
 * -----------------------------------------------
 * Es el back-end de UNA pantalla y de ninguna otra. Colgado del segmento de esa
 * pantalla, el endpoint y su única consumidora se mueven, se leen y se borran
 * juntos. (Los route handlers no participan de layouts, así que estar dentro de
 * `(app)` no le agrega nada.)
 *
 * SEGURIDAD — lo que este archivo NO tiene que hacer:
 * la RPC `global_search` es SECURITY INVOKER y filtra por el tenant del JWT, por
 * `status='published'` y por bloqueo mutuo. Este handler usa el cliente con la
 * anon key + cookies del usuario, así que la RLS decide qué ve cada quien. No
 * hay ni un `.eq('tenant_id', …)` acá: el día que se agregue uno, la barrera
 * real deja de ser la única y empiezan a existir dos verdades.
 *
 * VISITANTES: sin sesión no hay JWT del que sacar la comunidad, así que se le
 * pasa `p_tenant` con la del dominio (0182) y la llamada va con service_role
 * (0186). La RPC lo ignora si hay sesión, pero acá tampoco se manda: quien entró
 * busca en SU comunidad, siempre.
 *
 * LA EXCEPCIÓN AL "SIN ADMIN CLIENT" ES PERSONAS PARA VISITANTES. `global_search`
 * está abierta a la anon key y por eso no devuelve personas sin sesión: sería un
 * padrón de la comunidad. Ese grupo sale de `buscar_personas_visitante`, que sólo
 * ejecuta service_role, y este handler es lo único que la llama: con la comunidad
 * que dijo el dominio (nada del request) y detrás de un tope por IP más bajo.
 */

export const runtime = "nodejs";

/**
 * Resultados por tipo. 5 es lo que entra en un panel de tipo-ahead sin
 * convertirlo en una página de resultados; el "Ver todas…" de cada grupo es el
 * camino a la lista completa. La base clampa a [1,20] igual.
 */
const LIMIT_PER_TYPE = 5;

/**
 * Zod al borde. `q` se recorta al mismo tope que la RPC (80) en vez de
 * rechazarse: alguien que pega un párrafo en el buscador cometió un accidente,
 * no un ataque, y merece resultados del principio de lo que pegó — no un 400.
 */
const QuerySchema = z.object({
  q: z.string().max(4000).default("").transform(sanitizeSearchQuery),
});

/** Ventana generosa: corta scripts, no a una persona escribiendo rápido. */
const RATE_MAX = 120;
const RATE_WINDOW_MS = 60_000;

/**
 * Tope por IP de la búsqueda de personas sin sesión. Alcanza para escribir varias
 * búsquedas por minuto y le pone piso a quien barre nombres. Es sólo de ese grupo:
 * pasarlo saca a las personas de la respuesta, y avisos y publicaciones siguen.
 */
const VISITOR_PEOPLE_RATE_MAX = 30;

const EMPTY: SearchPayload = { query: "", groups: [], total: 0 };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({ q: url.searchParams.get("q") ?? "" });

  // Un `q` inválido devuelve VACÍO, no 400: la barra dispara sola mientras se
  // escribe, así que un error acá se vería como "la búsqueda se rompió" sin que
  // nadie haya hecho nada raro. Degradación elegante (§5.6).
  if (!parsed.success) return NextResponse.json(EMPTY);

  const query = parsed.data.q;
  if (!isSearchable(query)) return NextResponse.json({ ...EMPTY, query });

  const gate = limit(`buscar:${clientIpFromHeaders(request.headers)}`, RATE_MAX, RATE_WINDOW_MS);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "rate_limit" },
      { status: 429, headers: { "retry-after": String(Math.ceil(gate.retryAfterMs / 1000)) } },
    );
  }

  const [supabase, userId] = await Promise.all([createClient(), getAuthUserId()]);
  const term = query.slice(0, MAX_SEARCH_LENGTH);
  const tenantId = userId ? null : (await getTenant()).id;

  const [{ data, error }, personas] = await Promise.all([
    tenantId
      ? buscarComoVisitante(tenantId, term)
      : supabase.rpc("global_search", { q: term, limit_per_type: LIMIT_PER_TYPE }),
    tenantId ? personasParaVisitante(request, tenantId, term) : Promise.resolve([]),
  ]);

  if (error) {
    // Código desplegado antes que la 0182: la RPC todavía no conoce `p_tenant`. Un
    // visitante ve la pantalla vacía de siempre, no un error.
    if (error.code === "PGRST202" && !userId) {
      return NextResponse.json({ ...EMPTY, query });
    }
    // Sin detalle del error al cliente (§5.6) y sin el término en el log: lo
    // que alguien busca es dato sensible y no se persiste en claro (§5.4).
    console.warn("[buscar] global_search falló", { code: error.code });
    return NextResponse.json({ error: "search_failed" }, { status: 502 });
  }

  const rows = [...personas, ...((data ?? []) as RawSearchRow[])];
  const groups = groupSearchResults(rows, await sponsoredVideoIds(supabase, rows));

  return NextResponse.json({
    query,
    groups,
    total: countResults(groups),
  } satisfies SearchPayload);
}

/**
 * Sin sesión va con service_role: desde la 0186 `anon` no ejecuta `global_search`,
 * así que este handler y su tope por IP son la única puerta. La RPC filtra sola por
 * comunidad, estado y baja, y sin JWT queda en la rama de visitantes.
 */
async function buscarComoVisitante(tenantId: string, term: string) {
  try {
    return await createAdminClient().rpc("global_search", {
      q: term,
      limit_per_type: LIMIT_PER_TYPE,
      p_tenant: tenantId,
    });
  } catch (error) {
    console.warn("[buscar] visitante sin admin client", {
      name: error instanceof Error ? error.name : "desconocido",
    });
    return { data: [], error: null };
  }
}

/**
 * El grupo "Personas" para quien no tiene sesión. Si falla o se pasa del tope, el
 * grupo no aparece y el resto de la búsqueda sigue: los avisos no pueden caerse por
 * esto. Sin el término en el log, igual que arriba.
 */
async function personasParaVisitante(
  request: Request,
  tenantId: string,
  term: string,
): Promise<RawSearchRow[]> {
  const ip = clientIpFromHeaders(request.headers);
  if (!limit(`buscar-visitante:${ip}`, VISITOR_PEOPLE_RATE_MAX, RATE_WINDOW_MS).ok) return [];

  try {
    const { data, error } = await createAdminClient().rpc("buscar_personas_visitante", {
      p_tenant: tenantId,
      q: term,
    });
    if (error) {
      console.warn("[buscar] personas para visitantes falló", { code: error.code });
      return [];
    }
    return (data ?? []) as RawSearchRow[];
  } catch (error) {
    console.warn("[buscar] personas para visitantes sin admin client", {
      name: error instanceof Error ? error.name : "desconocido",
    });
    return [];
  }
}

/**
 * Qué videos de los resultados son publicidad paga (`posts.is_paid_ad`, 0046).
 *
 * Va en una segunda consulta y no en la RPC a propósito: `global_search` es
 * contrato compartido y estable, y esto es una marca de PRESENTACIÓN de una
 * sola pantalla. Cuesta una query acotada a ≤5 ids que ya tenemos, contra
 * re-crear una función que usa todo el resto de la app.
 *
 * Si falla, se devuelve el set vacío: un video sin la etiqueta "Patrocinado" es
 * un defecto menor; una búsqueda entera caída por un adorno, no.
 */
async function sponsoredVideoIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: readonly RawSearchRow[],
): Promise<Set<string>> {
  const ids = rows.filter((row) => row.result_type === "videos").map((row) => row.id);
  if (ids.length === 0) return new Set();

  const { data, error } = await supabase
    .from("posts")
    .select("id")
    .in("id", ids)
    .eq("is_paid_ad", true);

  if (error) {
    console.warn("[buscar] is_paid_ad falló", { code: error.code });
    return new Set();
  }
  return new Set((data ?? []).map((row) => row.id));
}
