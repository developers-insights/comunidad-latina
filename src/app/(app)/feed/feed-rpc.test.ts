import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import { fetchFeedListingsPageViaRpc, fetchFeedPostsPageViaRpc } from "./feed-rpc";

/**
 * El contrato de las dos llamadas: qué manda por el body y —sobre todo— QUÉ
 * DEVUELVE CUANDO NO PUEDE.
 *
 * El `null` es lo que se testea de verdad: mientras la migración no esté en
 * todos los entornos, `loadParaTiPage` tiene que poder distinguir "el RPC no
 * contestó" de "el feed está vacío". Confundir las dos cosas deja el feed en
 * blanco en cualquier entorno sin migrar — que es exactamente el modo de falla
 * que este fallback existe para evitar.
 */

type Supabase = SupabaseClient<Database>;

function clientWith(result: { data?: unknown; error?: { code?: string } | null }) {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  return { supabase: { rpc } as unknown as Supabase, rpc };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchFeedPostsPageViaRpc", () => {
  it("manda tenant, keyset y tope por el BODY del rpc (nada por la URL)", async () => {
    const { supabase, rpc } = clientWith({ data: [] });
    await fetchFeedPostsPageViaRpc(supabase, {
      tenantId: "t1",
      cursor: { createdAt: "2026-08-01T10:00:00Z", id: "p9" },
      limit: 9,
    });
    expect(rpc).toHaveBeenCalledWith("feed_posts_page", {
      p_tenant_id: "t1",
      p_cursor_created_at: "2026-08-01T10:00:00Z",
      p_cursor_id: "p9",
      p_limit: 9,
      p_entity_kind: null,
    });
  });

  it("primera página: el cursor viaja explícitamente en null", async () => {
    const { supabase, rpc } = clientWith({ data: [] });
    await fetchFeedPostsPageViaRpc(supabase, { tenantId: "t1", cursor: null, limit: 9 });
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_cursor_created_at: null,
      p_cursor_id: null,
    });
  });

  it("devuelve las filas tal cual cuando el RPC contesta", async () => {
    const { supabase } = clientWith({ data: [{ id: "p1" }, { id: "p2" }] });
    const rows = await fetchFeedPostsPageViaRpc(supabase, {
      tenantId: "t1",
      cursor: null,
      limit: 9,
    });
    expect(rows?.map((row) => row.id)).toEqual(["p1", "p2"]);
  });

  it("entorno sin la migración (PGRST202): null, no una lista vacía", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { supabase } = clientWith({ error: { code: "PGRST202" } });
    expect(
      await fetchFeedPostsPageViaRpc(supabase, { tenantId: "t1", cursor: null, limit: 9 }),
    ).toBeNull();
  });

  it("cualquier otro error también cae al camino viejo, y se loguea", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { supabase } = clientWith({ error: { code: "57014" } });
    expect(
      await fetchFeedPostsPageViaRpc(supabase, { tenantId: "t1", cursor: null, limit: 9 }),
    ).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("una página VACÍA de verdad es [] y no null (no dispara el fallback)", async () => {
    const { supabase } = clientWith({ data: [] });
    expect(
      await fetchFeedPostsPageViaRpc(supabase, { tenantId: "t1", cursor: null, limit: 9 }),
    ).toEqual([]);
  });
});

describe("fetchFeedListingsPageViaRpc", () => {
  it("llama a su propia función, sin p_entity_kind", async () => {
    const { supabase, rpc } = clientWith({ data: [] });
    await fetchFeedListingsPageViaRpc(supabase, { tenantId: "t1", cursor: null, limit: 9 });
    expect(rpc).toHaveBeenCalledWith("feed_listings_page", {
      p_tenant_id: "t1",
      p_cursor_created_at: null,
      p_cursor_id: null,
      p_limit: 9,
    });
  });

  it("sin la migración devuelve null y deja pasar al camino con topes", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { supabase } = clientWith({ error: { code: "PGRST202" } });
    expect(
      await fetchFeedListingsPageViaRpc(supabase, { tenantId: "t1", cursor: null, limit: 9 }),
    ).toBeNull();
  });
});
