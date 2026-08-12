import { describe, expect, it, vi, beforeEach } from "vitest";
import { DEFAULT_TAG_POLICY, isTagPolicy, readTagPolicy, TAG_POLICIES } from "./tag-policy";

describe("isTagPolicy", () => {
  it("acepta exactamente los tres valores de la columna (0089)", () => {
    for (const value of TAG_POLICIES) {
      expect(isTagPolicy(value)).toBe(true);
    }
  });

  it("rechaza cualquier otra cosa, incluido el nombre técnico mal escrito", () => {
    expect(isTagPolicy("everyone ")).toBe(false);
    expect(isTagPolicy("Everyone")).toBe(false);
    expect(isTagPolicy(null)).toBe(false);
    expect(isTagPolicy(undefined)).toBe(false);
    expect(isTagPolicy(1)).toBe(false);
  });
});

describe("readTagPolicy", () => {
  const PROFILE_ID = "99999999-9999-4999-8999-999999999999";

  function stubClient(result: { data?: unknown; error?: unknown }) {
    const maybeSingle = vi.fn(() => Promise.resolve(result));
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    return { from, select, eq, maybeSingle };
  }

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("devuelve la preferencia real cuando hay fila", async () => {
    const client = stubClient({ data: { tag_policy: "following" } });
    const result = await readTagPolicy(client as never, PROFILE_ID);
    expect(result).toBe("following");
    expect(client.from).toHaveBeenCalledWith("profiles_private");
    expect(client.eq).toHaveBeenCalledWith("profile_id", PROFILE_ID);
  });

  it("sin fila en profiles_private devuelve el default (mismo criterio que app.tagging_allowed)", async () => {
    const client = stubClient({ data: null });
    expect(await readTagPolicy(client as never, PROFILE_ID)).toBe(DEFAULT_TAG_POLICY);
  });

  it("si la columna todavía no existe (42703, migración sin aplicar) no rompe la pantalla", async () => {
    const client = stubClient({ error: { code: "42703" } });
    expect(await readTagPolicy(client as never, PROFILE_ID)).toBe(DEFAULT_TAG_POLICY);
  });

  it("un valor inesperado en la columna también cae al default, nunca se cuelga", async () => {
    const client = stubClient({ data: { tag_policy: "algo-que-no-existe" } });
    expect(await readTagPolicy(client as never, PROFILE_ID)).toBe(DEFAULT_TAG_POLICY);
  });
});
