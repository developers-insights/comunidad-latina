import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de `checkUsernameAvailabilityAction`: el chequeo en vivo que corre
 * mientras se escribe el handle, ANTES del submit real de `registerAction`.
 *
 * La garantía central: esta acción NUNCA puede tirar ni bloquear el alta. Todo
 * lo que no sea "libre" o "tomado" con certeza vuelve como `unknown`, y el
 * server sigue siendo quien decide de verdad al insertar (ver el comentario en
 * el archivo fuente y en `registro.test.ts`).
 *
 * Bordes mockeados: headers, rate limit, tenant y admin client — igual que
 * `registro.test.ts`, que es la action hermana (`registerAction`).
 */

const mocks = vi.hoisted(() => ({
  limit: vi.fn(),
  limitCall: vi.fn(),
  select: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "9.9.9.9" }),
}));
vi.mock("@/lib/rate-limit", () => ({
  limit: (...args: unknown[]) => {
    mocks.limitCall(...args);
    return mocks.limit();
  },
  clientIpFromHeaders: () => "9.9.9.9",
}));
vi.mock("@/lib/tenant/resolve", () => ({
  getTenant: async () => ({ id: "tenant-1", name: "Dominicanos en Chile" }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: (_col: string, value: string) => ({
            limit: () => mocks.select(table, value),
          }),
        }),
      }),
    }),
  }),
}));

import { checkUsernameAvailabilityAction } from "./username-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockReturnValue({ ok: true });
  mocks.select.mockResolvedValue({ data: [], error: null });
});

describe("checkUsernameAvailabilityAction — formato", () => {
  it("un formato inválido no toca ni el rate limit ni la base", async () => {
    const result = await checkUsernameAvailabilityAction("rosa martinez");

    expect(result).toEqual({
      status: "invalid",
      message: "Solo letras sin acento, números, punto y guion bajo.",
    });
    expect(mocks.limitCall).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("un handle vacío es 'invalid', no 'unknown'", async () => {
    expect(await checkUsernameAvailabilityAction("   ")).toEqual({
      status: "invalid",
      message: "Elegí tu nombre de usuario.",
    });
  });

  it("bordes (empieza con punto) da el mensaje específico, no el genérico de formato", async () => {
    const result = await checkUsernameAvailabilityAction(".rosa");
    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.message).toContain("punto");
  });
});

describe("checkUsernameAvailabilityAction — disponibilidad", () => {
  it("libre en este tenant → available", async () => {
    mocks.select.mockResolvedValue({ data: [], error: null });

    const result = await checkUsernameAvailabilityAction("Rosa.Martinez");

    expect(result).toEqual({ status: "available" });
    // Se consulta con el handle ya normalizado (minúsculas, recortado).
    expect(mocks.select).toHaveBeenCalledWith("profiles", "rosa.martinez");
  });

  it("tomado en este tenant → taken, con el mismo copy que registerAction", async () => {
    mocks.select.mockResolvedValue({ data: [{ id: "otro-user" }], error: null });

    const result = await checkUsernameAvailabilityAction("rosa.martinez");

    expect(result).toEqual({
      status: "taken",
      message: "Ese nombre de usuario ya está en uso en esta comunidad. Probá con otro.",
    });
  });
});

describe("checkUsernameAvailabilityAction — degradación (nunca bloquea el alta)", () => {
  it("rate limit superado → unknown, sin consultar la base", async () => {
    mocks.limit.mockReturnValue({ ok: false, remaining: 0, retryAfterMs: 1000 });

    const result = await checkUsernameAvailabilityAction("rosa");

    expect(result).toEqual({ status: "unknown" });
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("error de la consulta → unknown, y queda logueado", async () => {
    mocks.select.mockResolvedValue({ data: null, error: { code: "57P01" } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await checkUsernameAvailabilityAction("rosa");

    expect(result).toEqual({ status: "unknown" });
  });
});
