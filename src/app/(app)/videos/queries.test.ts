import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchVideoReelsPage } from "./queries";

/**
 * CÓMO SE ACOTA EL SCROLL DE VIDEOS CORTOS A UN VERTICAL.
 *
 * Antes eran dos pasos: una query traía hasta 500 `listings.id` del vertical y
 * esos ids se metían en un `.in("entity_listing_id", …)`. Como las lecturas de
 * supabase-js son GET, esos 500 uuids viajaban en el querystring —unos 19 KB
 * contra el request line de ~8 KB que aceptan Kong y nginx—, o sea 414
 * garantizado, y con ~200 negocios publicados ya alcanzaba para romperlo. De
 * yapa, aquel primer paso descartaba su `error`: un fallo de lectura se
 * mostraba como "todavía no hay videos", que es un vacío mentiroso.
 *
 * Lo que se fija acá es que el scope se resuelva DENTRO de la base (join
 * `listings!inner`), sin round-trip previo y sin un solo id en la URL — y que
 * el scope "para ti", que NO filtra por vertical, siga sin el join (con `!inner`
 * se comería todas las publicaciones personales, que no tienen entidad).
 */

interface RecordedCall {
  method: string;
  args: unknown[];
}

/** Cliente falso: un builder por tabla que anota cómo se armó cada query. */
function createStub(rowsByTable: Record<string, unknown[]> = {}) {
  const calls: Record<string, RecordedCall[]> = {};
  const builderFor = (table: string) => {
    const record =
      (method: string) =>
      (...args: unknown[]) => {
        (calls[table] ??= []).push({ method, args });
        return builder;
      };
    const result = { data: rowsByTable[table] ?? [], error: null };
    const builder = {
      select: record("select"),
      eq: record("eq"),
      gt: record("gt"),
      in: record("in"),
      or: record("or"),
      order: record("order"),
      limit: record("limit"),
      maybeSingle: async () => result,
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    return builder;
  };
  const from = vi.fn((table: string) => builderFor(table));
  return {
    client: { from } as unknown as SupabaseClient<never>,
    from,
    /** Args de un método sobre una tabla, en orden de llamada. */
    argsOf: (table: string, method: string) =>
      (calls[table] ?? []).filter((c) => c.method === method).map((c) => c.args),
  };
}

/** Página del reel con viewer anónimo: sin bloqueos ni seguidos que leer. */
function fetchPage(stub: ReturnType<typeof createStub>, scope: "para-ti" | "negocios") {
  return fetchVideoReelsPage({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: stub.client as any,
    tenantId: "tenant-1",
    viewerId: null,
    scope,
    cursor: null,
  });
}

describe("fetchVideoReelsPage — scope por módulo", () => {
  it("no lee la tabla listings aparte: el vertical se resuelve con el join", async () => {
    const stub = createStub();

    await fetchPage(stub, "negocios");

    // El round-trip que metía 500 uuids en la URL ya no existe.
    expect(stub.from).toHaveBeenCalledWith("posts");
    expect(stub.from).not.toHaveBeenCalledWith("listings");
  });

  it("pide la entidad embebida con !inner y filtra por su vertical", async () => {
    const stub = createStub();

    await fetchPage(stub, "negocios");

    const [[selectArg]] = stub.argsOf("posts", "select");
    expect(String(selectArg)).toContain("listings!inner(id)");

    const eqArgs = stub.argsOf("posts", "eq");
    expect(eqArgs).toContainEqual(["listings.kind", "business"]);
    expect(eqArgs).toContainEqual(["listings.status", "published"]);
    // Ningún id de listing viaja como filtro: eso es todo el punto.
    expect(stub.argsOf("posts", "in")).toEqual([]);
  });

  it('"para ti" no lleva join: con !inner se perderían las publicaciones personales', async () => {
    const stub = createStub();

    await fetchPage(stub, "para-ti");

    const [[selectArg]] = stub.argsOf("posts", "select");
    expect(String(selectArg)).not.toContain("listings");
    expect(
      stub.argsOf("posts", "eq").filter(([column]) => String(column).startsWith("listings.")),
    ).toEqual([]);
  });

  it("sigue filtrando lo que sostiene la superficie: sólo cortos elegibles", async () => {
    // El scope cambió de forma; el contrato 0046 no. Un `advertising_video` no
    // entra al reel ni por el join ni por ningún lado.
    const stub = createStub();

    await fetchPage(stub, "negocios");

    const eqArgs = stub.argsOf("posts", "eq");
    expect(eqArgs).toContainEqual(["video_type", "short_video"]);
    expect(eqArgs).toContainEqual(["eligible_for_short_feed", true]);
    expect(eqArgs).toContainEqual(["status", "published"]);
    expect(eqArgs).toContainEqual(["tenant_id", "tenant-1"]);
  });
});
