import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  ensureProfileForOAuthUser: vi.fn(),
  syncEmailVerified: vi.fn(),
  neutralizePreclaimedAccount: vi.fn(),
  importGoogleAvatarIfMissing: vi.fn(),
  signOut: vi.fn(),
  refreshSession: vi.fn(),
}));

vi.mock("@/lib/tenant/resolve", () => ({ getTenant: async () => ({ id: "tenant-a" }) }));
vi.mock("@/lib/auth/provision", () => ({ ensureProfileForOAuthUser: mocks.ensureProfileForOAuthUser }));
vi.mock("@/lib/auth/email-verified", () => ({ syncEmailVerified: mocks.syncEmailVerified }));
vi.mock("@/lib/auth/google-avatar", () => ({
  importGoogleAvatarIfMissing: mocks.importGoogleAvatarIfMissing,
}));
vi.mock("@/lib/auth/preclaimed", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/auth/preclaimed")>()),
  neutralizePreclaimedAccount: mocks.neutralizePreclaimedAccount,
}));

import { finalizeOAuthSession } from "./finalize-oauth";

const supabase = { auth: { signOut: mocks.signOut, refreshSession: mocks.refreshSession } };

function user(appMetadata: Record<string, unknown>, identities: { provider: string }[] = []): User {
  return {
    id: "user-1",
    email: "rosa@gmail.com",
    email_confirmed_at: "2026-09-28T00:00:00Z",
    app_metadata: appMetadata,
    user_metadata: { avatar_url: "https://lh3.googleusercontent.com/a=s96-c" },
    identities,
    aud: "authenticated",
    created_at: "2026-09-28T00:00:00Z",
  } as unknown as User;
}

const GOOGLE = user({ provider: "google", providers: ["google"] }, [{ provider: "google" }]);
const APPLE = user({ provider: "apple", providers: ["apple"] }, [{ provider: "apple" }]);
const EMAIL = user({ provider: "email", providers: ["email"], tenant_id: "tenant-a", role: "member" }, [
  { provider: "email" },
]);

function run(u: User, next = "/propiedades") {
  return finalizeOAuthSession({ supabase, user: u, accessToken: "jwt-1", next });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.ensureProfileForOAuthUser.mockResolvedValue({ ok: true, created: false, claimsChanged: false });
  mocks.refreshSession.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.syncEmailVerified.mockResolvedValue(true);
  mocks.neutralizePreclaimedAccount.mockResolvedValue(true);
  mocks.importGoogleAvatarIfMissing.mockResolvedValue("imported");
});

describe("finalizeOAuthSession", () => {
  it("cuenta nueva por Google → provisiona, refresca, trae la foto y va a /bienvenida", async () => {
    mocks.ensureProfileForOAuthUser.mockResolvedValue({ ok: true, created: true, claimsChanged: true });

    expect(await run(GOOGLE)).toEqual({ ok: true, redirectTo: "/bienvenida", created: true });
    expect(mocks.ensureProfileForOAuthUser).toHaveBeenCalledWith(GOOGLE, "tenant-a");
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
    expect(mocks.importGoogleAvatarIfMissing).toHaveBeenCalledWith(GOOGLE);
    expect(mocks.syncEmailVerified).toHaveBeenCalledWith(GOOGLE);
  });

  it("cuenta existente → al next y también intenta la foto (cuenta vieja sin avatar)", async () => {
    expect(await run(GOOGLE)).toEqual({ ok: true, redirectTo: "/propiedades", created: false });
    expect(mocks.refreshSession).not.toHaveBeenCalled();
    expect(mocks.importGoogleAvatarIfMissing).toHaveBeenCalledTimes(1);
  });

  it("Apple no intenta traer foto de Google", async () => {
    await run(APPLE);
    expect(mocks.importGoogleAvatarIfMissing).not.toHaveBeenCalled();
  });

  it("cuenta de otra comunidad → cierra la sesión", async () => {
    mocks.ensureProfileForOAuthUser.mockResolvedValue({ ok: false, reason: "otro_tenant" });

    expect(await run(GOOGLE)).toEqual({ ok: false, reason: "otra_comunidad" });
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.importGoogleAvatarIfMissing).not.toHaveBeenCalled();
  });

  it("alta fallida → cierra la sesión", async () => {
    mocks.ensureProfileForOAuthUser.mockResolvedValue({ ok: false, reason: "error" });

    expect(await run(GOOGLE)).toEqual({ ok: false, reason: "alta" });
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it("refresh del JWT fallido → cierra la sesión", async () => {
    mocks.ensureProfileForOAuthUser.mockResolvedValue({ ok: true, created: true, claimsChanged: true });
    mocks.refreshSession.mockResolvedValue({ error: { code: "refresh_token_not_found" } });

    expect(await run(GOOGLE)).toEqual({ ok: false, reason: "alta" });
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it("cuenta pre-reclamada → neutraliza y manda a revisar el perfil", async () => {
    const preclaimed = user({ provider: "email", providers: ["google"] }, [{ provider: "google" }]);

    expect(await run(preclaimed)).toEqual({ ok: true, redirectTo: "/bienvenida", created: true });
    expect(mocks.neutralizePreclaimedAccount).toHaveBeenCalledWith(preclaimed, "jwt-1");
  });

  it("pre-reclamada que no se pudo neutralizar → no deja la sesión abierta", async () => {
    mocks.neutralizePreclaimedAccount.mockResolvedValue(false);
    const preclaimed = user({ provider: "email", providers: ["google"] }, [{ provider: "google" }]);

    expect(await run(preclaimed)).toEqual({ ok: false, reason: "alta" });
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it("cuenta sólo-email (magic link, recuperación) no se provisiona", async () => {
    expect(await run(EMAIL)).toEqual({ ok: true, redirectTo: "/propiedades", created: false });
    expect(mocks.ensureProfileForOAuthUser).not.toHaveBeenCalled();
    expect(mocks.importGoogleAvatarIfMissing).not.toHaveBeenCalled();
    expect(mocks.syncEmailVerified).toHaveBeenCalledWith(EMAIL);
  });
});
