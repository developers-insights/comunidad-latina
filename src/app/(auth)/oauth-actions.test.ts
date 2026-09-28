import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
  headers: vi.fn(),
  services: { isGoogleAuthConfigured: true, isAppleAuthConfigured: false },
}));

vi.mock("next/headers", () => ({ headers: async () => mocks.headers() }));
vi.mock("@/lib/config/services", () => mocks.services);
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithOAuth: mocks.signInWithOAuth } }),
}));
vi.mock("@/lib/tenant/resolve", () => ({
  KNOWN_TENANT_DOMAINS: new Set(["dominicanos.com"]),
}));

import { startOAuthAction } from "./oauth-actions";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.headers.mockReturnValue(
    new Headers({ "x-forwarded-host": "dominicanos.com", "x-forwarded-proto": "https" }),
  );
  mocks.signInWithOAuth.mockResolvedValue({
    data: { url: "https://proyecto.supabase.co/auth/v1/authorize?provider=google" },
    error: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("startOAuthAction", () => {
  it("arma el redirectTo con el host propio validado y el next saneado", async () => {
    const result = await startOAuthAction({ provider: "google", next: "/propiedades" });

    expect(result).toEqual({
      ok: true,
      url: "https://proyecto.supabase.co/auth/v1/authorize?provider=google",
    });
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://dominicanos.com/callback?next=%2Fpropiedades",
        queryParams: { prompt: "select_account" },
      },
    });
  });

  it("un next externo no viaja en el redirectTo", async () => {
    await startOAuthAction({ provider: "google", next: "https://malo.com" });

    const [{ options }] = mocks.signInWithOAuth.mock.calls[0];
    expect(options.redirectTo).toBe("https://dominicanos.com/callback?next=%2Ffeed");
  });

  it("en producción, un host loopback forjado no termina en el redirectTo", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "www.comunidadlatina.com");
    mocks.headers.mockReturnValue(new Headers({ "x-forwarded-host": "localhost:3000" }));

    await startOAuthAction({ provider: "google" });

    const [{ options }] = mocks.signInWithOAuth.mock.calls[0];
    expect(options.redirectTo).toBe("https://www.comunidadlatina.com/callback?next=%2Ffeed");
  });

  it("un proveedor sin credenciales no arranca nada", async () => {
    const result = await startOAuthAction({ provider: "apple" });

    expect(result.ok).toBe(false);
    expect(mocks.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("si Supabase no devuelve URL, falla con copy en español", async () => {
    mocks.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: { code: "x" } });

    const result = await startOAuthAction({ provider: "google" });

    expect(result).toEqual({ ok: false, message: expect.stringContaining("Probá de nuevo") });
  });
});
