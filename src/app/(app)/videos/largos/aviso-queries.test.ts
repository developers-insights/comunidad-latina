import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/feed/queries", () => ({
  fetchBlockedIds: vi.fn(async () => new Set(["bloqueado"])),
}));

const { fetchAvisosConVideoLargo } = await import("./aviso-queries");

function fila(extra: Record<string, unknown>) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "property",
    title: "Casa con patio",
    price_amount: 1500,
    price_currency: "USD",
    price_period: "month",
    area_label: "Queens",
    created_by: "autor",
    publisher_name: null,
    video_path: "t/u/video.mp4",
    video_poster_path: null,
    video_duration_seconds: 200,
    tier: "premium",
    ...extra,
  };
}

function stub(filas: unknown[]) {
  const filtros: unknown[][] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "not", "gt", "order", "limit"]) {
    builder[m] = vi.fn((...args: unknown[]) => {
      filtros.push([m, ...args]);
      return builder;
    });
  }
  builder.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: filas, error: null }).then(ok);
  return { client: { from: vi.fn(() => builder) }, filtros };
}

describe("fetchAvisosConVideoLargo", () => {
  it("pide sólo avisos publicados, premium y de más de 90 s", async () => {
    const { client, filtros } = stub([fila({})]);
    await fetchAvisosConVideoLargo({ supabase: client, tenantId: "t", viewerId: null, locale: "es-US" });
    expect(filtros).toContainEqual(["eq", "status", "published"]);
    expect(filtros).toContainEqual(["eq", "tier", "premium"]);
    expect(filtros).toContainEqual(["gt", "video_duration_seconds", 90]);
  });

  it("arma el link a la sección y a la página del aviso", async () => {
    const { client } = stub([fila({})]);
    const [aviso] = await fetchAvisosConVideoLargo({
      supabase: client,
      tenantId: "t",
      viewerId: null,
      locale: "es-US",
    });
    expect(aviso.video.fullVideoHref).toBe(`/videos/largos/aviso/${aviso.id}`);
    expect(aviso.detailHref).toBe(`/propiedades/${aviso.id}`);
  });

  it("deja afuera a quien el viewer bloqueó y a un aviso que ya no es premium", async () => {
    const { client } = stub([
      fila({ id: "a", created_by: "bloqueado" }),
      fila({ id: "b", tier: "free" }),
      fila({ id: "c" }),
    ]);
    const avisos = await fetchAvisosConVideoLargo({
      supabase: client,
      tenantId: "t",
      viewerId: "yo",
      locale: "es-US",
    });
    expect(avisos.map((a) => a.id)).toEqual(["c"]);
  });
});
