import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  signOut: vi.fn(),
  refreshSession: vi.fn(),
  ensureProfileForOAuthUser: vi.fn(),
  syncEmailVerified: vi.fn(),
  neutralizePreclaimedAccount: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: mocks.exchangeCodeForSession,
      signOut: mocks.signOut,
      refreshSession: mocks.refreshSession,
    },
  }),
}));
vi.mock("@/lib/tenant/resolve", () => ({
  getTenant: async () => ({ id: "tenant-a", name: "Dominicanos", brandHex: "#123456" }),
  KNOWN_TENANT_DOMAINS: new Set(["dominicanos.com"]),
}));
vi.mock("@/lib/auth/provision", () => ({
  ensureProfileForOAuthUser: mocks.ensureProfileForOAuthUser,
}));
vi.mock("@/lib/auth/email-verified", () => ({ syncEmailVerified: mocks.syncEmailVerified }));
vi.mock("@/lib/auth/google-avatar", () => ({ importGoogleAvatarIfMissing: vi.fn(async () => "no-source") }));
vi.mock("@/lib/auth/preclaimed", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/auth/preclaimed")>()),
  neutralizePreclaimedAccount: mocks.neutralizePreclaimedAccount,
}));

import { GET } from "./route";

const ORIGIN = "https://dominicanos.com";

function request(query: string, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/callback${query}`, {
    headers: { host: "dominicanos.com", "x-forwarded-proto": "https", ...headers },
  });
}

function session(appMetadata: Record<string, unknown>, identities: { provider: string }[] = []) {
  return {
    data: {
      user: {
        id: "user-1",
        email: "rosa@gmail.com",
        email_confirmed_at: "2026-09-28T00:00:00Z",
        app_metadata: appMetadata,
        identities,
      },
      session: { access_token: "jwt-1" },
    },
    error: null,
  };
}

const GOOGLE = { provider: "google", providers: ["google"] };
const LINKED = { provider: "email", providers: ["email", "google"], tenant_id: "tenant-a", role: "member" };
const EMAIL_ONLY = { provider: "email", providers: ["email"], tenant_id: "tenant-a", role: "member" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.exchangeCodeForSession.mockResolvedValue(session(GOOGLE));
  mocks.ensureProfileForOAuthUser.mockResolvedValue({
    ok: true,
    created: false,
    claimsChanged: false,
  });
  mocks.refreshSession.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.syncEmailVerified.mockResolvedValue(true);
  mocks.neutralizePreclaimedAccount.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /callback — Google", () => {
  it("usuario nuevo → se provisiona, se refresca el JWT y va a /bienvenida", async () => {
    mocks.ensureProfileForOAuthUser.mockResolvedValue({
      ok: true,
      created: true,
      claimsChanged: true,
    });

    const res = await GET(request("?code=abc&next=%2Fpropiedades"));

    expect(mocks.ensureProfileForOAuthUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-1" }),
      "tenant-a",
    );
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/bienvenida`);
  });

  it("cuenta existente (ya provisionada) → al next, sin /bienvenida ni refresh", async () => {
    const res = await GET(request("?code=abc&next=%2Fpropiedades"));

    expect(mocks.refreshSession).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe(`${ORIGIN}/propiedades`);
  });

  /**
   * Cuenta nacida con email+contraseña que entra con Google: Supabase vincula la
   * identidad y `app_metadata.provider` SIGUE diciendo "email". Si el callback
   * decidiera por ese campo, se saltearía el chequeo de comunidad.
   */
  it("email+contraseña vinculada a Google también pasa por el chequeo de comunidad", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue(session(LINKED));
    mocks.ensureProfileForOAuthUser.mockResolvedValue({ ok: false, reason: "otro_tenant" });

    const res = await GET(request("?code=abc"));

    expect(mocks.ensureProfileForOAuthUser).toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalled();
    expect(res.headers.get("location")).toBe(`${ORIGIN}/entrar?error=otra_comunidad`);
  });

  it("vinculada en la misma comunidad → entra al next sin crear nada", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue(session(LINKED));

    const res = await GET(request("?code=abc&next=%2Ffeed"));

    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe(`${ORIGIN}/feed`);
  });

  it("claim reparado en una cuenta existente → refresca el JWT", async () => {
    mocks.ensureProfileForOAuthUser.mockResolvedValue({
      ok: true,
      created: false,
      claimsChanged: true,
    });

    await GET(request("?code=abc"));

    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("espeja email_verified: Google ya confirmó el correo", async () => {
    await GET(request("?code=abc"));

    expect(mocks.syncEmailVerified).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-1" }),
    );
  });

  it("alta fallida → cierra la sesión y avisa", async () => {
    mocks.ensureProfileForOAuthUser.mockResolvedValue({ ok: false, reason: "error" });

    const res = await GET(request("?code=abc"));

    expect(mocks.signOut).toHaveBeenCalled();
    expect(mocks.syncEmailVerified).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe(`${ORIGIN}/entrar?error=alta`);
  });

  it("la persona cancela en Google → vuelve a /entrar sin aviso", async () => {
    const res = await GET(request("?error=access_denied"));

    expect(res.headers.get("location")).toBe(`${ORIGIN}/entrar`);
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("otro error del proveedor → ?error=proveedor", async () => {
    const res = await GET(request("?error=server_error&error_description=boom"));

    expect(res.headers.get("location")).toBe(`${ORIGIN}/entrar?error=proveedor`);
  });

  it("code vencido → ?error=enlace", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "flow_state_expired" },
    });

    const res = await GET(request("?code=viejo"));

    expect(res.headers.get("location")).toBe(`${ORIGIN}/entrar?error=enlace`);
  });
});

describe("GET /callback — sesiones de email", () => {
  it("recuperación de una cuenta sólo-email no se provisiona", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue(session(EMAIL_ONLY));

    const res = await GET(request("?code=abc&next=%2Frecuperar%2Factualizar"));

    expect(mocks.ensureProfileForOAuthUser).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe(`${ORIGIN}/recuperar/actualizar`);
  });
});

describe("GET /callback — a dónde vuelve", () => {
  it("un next externo se ignora (open redirect)", async () => {
    const res = await GET(request("?code=abc&next=https%3A%2F%2Fmalo.com"));

    expect(res.headers.get("location")).toBe(`${ORIGIN}/feed`);
  });

  it("un x-forwarded-host ajeno no se usa para el redirect", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "www.comunidadlatina.com");

    const res = await GET(request("?code=abc", { "x-forwarded-host": "atacante.example" }));

    expect(res.headers.get("location")).toBe("https://www.comunidadlatina.com/feed");
  });

  it("detrás de un proxy, request.url interno no se filtra al Location", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "www.comunidadlatina.com");
    const req = new Request("http://localhost:3000/callback?code=abc", {
      headers: { "x-forwarded-host": "dominicanos.com", "x-forwarded-proto": "https" },
    });

    const res = await GET(req);

    expect(res.headers.get("location")).toBe(`${ORIGIN}/feed`);
  });
});

describe("GET /callback — email registrado por otro, sin confirmar", () => {
  const PRECLAIMED = { provider: "email", providers: ["google"], tenant_id: "tenant-a", role: "member" };

  it("rota la contraseña, cierra otras sesiones y manda a revisar el perfil", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue(session(PRECLAIMED, [{ provider: "google" }]));

    const res = await GET(request("?code=abc&next=%2Fpropiedades"));

    expect(mocks.neutralizePreclaimedAccount).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-1" }),
      "jwt-1",
    );
    expect(res.headers.get("location")).toBe(`${ORIGIN}/bienvenida`);
  });

  it("si no se puede neutralizar, no deja la sesión abierta", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue(session(PRECLAIMED, [{ provider: "google" }]));
    mocks.neutralizePreclaimedAccount.mockResolvedValue(false);

    const res = await GET(request("?code=abc"));

    expect(mocks.signOut).toHaveBeenCalled();
    expect(res.headers.get("location")).toBe(`${ORIGIN}/entrar?error=alta`);
  });

  it("cuenta de email confirmada y vinculada no se toca", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue(
      session({ provider: "email", providers: ["email", "google"], tenant_id: "tenant-a", role: "member" }, [
        { provider: "email" },
        { provider: "google" },
      ]),
    );

    await GET(request("?code=abc"));

    expect(mocks.neutralizePreclaimedAccount).not.toHaveBeenCalled();
  });
});
