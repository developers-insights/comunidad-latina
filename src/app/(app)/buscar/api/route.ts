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
import { createClient } from "@/lib/supabase/server";

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

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("global_search", {
    q: query.slice(0, MAX_SEARCH_LENGTH),
    limit_per_type: LIMIT_PER_TYPE,
  });

  if (error) {
    // Sin detalle del error al cliente (§5.6) y sin el término en el log: lo
    // que alguien busca es dato sensible y no se persiste en claro (§5.4).
    console.warn("[buscar] global_search falló", { code: error.code });
    return NextResponse.json({ error: "search_failed" }, { status: 502 });
  }

  const rows = (data ?? []) as RawSearchRow[];
  const groups = groupSearchResults(rows, await sponsoredVideoIds(supabase, rows));

  return NextResponse.json({
    query,
    groups,
    total: countResults(groups),
  } satisfies SearchPayload);
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
