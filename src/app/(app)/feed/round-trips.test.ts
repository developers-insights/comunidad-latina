import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * CUÁNTAS VECES SALE A LA RED UNA PÁGINA DEL FEED
 * =============================================================================
 *
 * El cliente reportó que el feed "tarda en cargar cuando se baja viendo los
 * post viejos". Parte de esa lentitud es CONSTANTE y no se ve leyendo el
 * código: cada página dispara un abanico de lecturas a PostgREST, y cada
 * lectura es un round-trip HTTP propio. Contarlas a ojo no sirve —varias
 * funciones de `queries.ts` esconden DOS queries adentro (`fetchAuthorViews`
 * pide perfiles Y trust scores; `fetchListingExtras` pide verificaciones Y
 * llama otra vez a `fetchAuthorViews`)—, así que este test las cuenta de
 * verdad: intercepta `.from()` y `.rpc()` del cliente de Supabase y afirma el
 * total.
 *
 * ES UN PRESUPUESTO, no una foto. Si alguien agrega una lectura al abanico,
 * este test se pone en rojo y obliga a decidirlo a propósito: sumarla al
 * número de acá (y saber que el feed se hizo más lento) o batchearla con una
 * de las que ya están.
 */

const espia = vi.hoisted(() => ({
  llamadas: [] as string[],
}));

/** Filas que devuelve el RPC: 6 posts (3 de entidad) + 2 avisos. */
const FILAS_POST = Array.from({ length: 6 }, (_, i) => ({
  id: `11111111-1111-4111-8111-00000000000${i}`,
  body: "hola",
  kind: i === 0 ? "question" : "post",
  media: [],
  status: "published",
  like_count: 0,
  comment_count: 0,
  view_count: 0,
  created_at: `2026-01-0${i + 1}T00:00:00Z`,
  author_id: `22222222-2222-4222-8222-00000000000${i}`,
  entity_listing_id: i < 3 ? `33333333-3333-4333-8333-00000000000${i}` : null,
  video_type: null,
  duration_seconds: null,
  is_paid_ad: false,
  eligible_for_short_feed: null,
  video_category: null,
  pinned_at: null,
  hidden_at: null,
  comments_locked_at: null,
  media_filters: null,
  mux_playback_id: null,
  mux_status: null,
}));

const FILAS_LISTING = Array.from({ length: 2 }, (_, i) => ({
  id: `44444444-4444-4444-8444-00000000000${i}`,
  kind: i === 0 ? "property" : "business",
  title: "aviso",
  description: null,
  price_amount: null,
  price_currency: "USD",
  price_period: null,
  area_label: "Centro",
  photos: [],
  created_by: `55555555-5555-4555-8555-00000000000${i}`,
  publisher_name: null,
  created_at: `2026-01-0${i + 1}T12:00:00Z`,
}));

/**
 * Cliente de Supabase de mentira que anota cada salida a la red. Un `.from()`
 * o un `.rpc()` = un request HTTP; los encadenados (`.eq()`, `.in()`, …) no
 * salen a ningún lado hasta que se hace `await`.
 */
function clienteEspia() {
  const constructor = (datos: unknown[]): Record<string, unknown> => {
    const propio: Record<string, unknown> = {};
    const encadenar = () => propio;
    for (const metodo of ["select", "eq", "in", "or", "not", "gt", "lt", "gte", "order", "limit", "range"]) {
      propio[metodo] = encadenar;
    }
    propio.maybeSingle = () => Promise.resolve({ data: null, error: null });
    propio.single = () => Promise.resolve({ data: null, error: null });
    propio.then = (ok: (v: unknown) => unknown, mal?: (e: unknown) => unknown) =>
      Promise.resolve({ data: datos, error: null }).then(ok, mal);
    return propio;
  };

  return {
    from(tabla: string) {
      espia.llamadas.push(`from:${tabla}`);
      return constructor([]);
    },
    rpc(funcion: string) {
      espia.llamadas.push(`rpc:${funcion}`);
      if (funcion === "feed_posts_page") return constructor(FILAS_POST);
      if (funcion === "feed_listings_page") return constructor(FILAS_LISTING);
      return constructor([]);
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => clienteEspia(),
  getAuthUserId: async () => "99999999-9999-4999-8999-000000000000",
}));

vi.mock("@/lib/tenant/resolve", () => ({
  getTenant: async () => ({ id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000000", locale: "es-US" }),
}));

// La zona ya la resolvió la pantalla: acá sólo se cuenta el abanico del feed.
vi.mock("@/lib/zona/server", () => ({
  resolverVistaZona: async () => ({ zona: null, areaLabels: [], filtraPorPreferencia: false }),
}));

vi.mock("@/lib/time/viewer-zone", () => ({
  getViewerFormatDate: async () => () => "el 1 de enero",
}));

import { fetchFeedPageAction } from "./load-more";

beforeEach(() => {
  espia.llamadas.length = 0;
});

describe("presupuesto de round-trips de una página del feed", () => {
  it('"Para ti" resuelve una página con el abanico contado', async () => {
    const resultado = await fetchFeedPageAction({ tab: "para-ti", cursor: null });
    expect(resultado.items.length).toBeGreaterThan(0);

    expect({ total: espia.llamadas.length, llamadas: espia.llamadas }).toEqual("MEDIR");
  });
});
