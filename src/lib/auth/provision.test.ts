import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  insert: vi.fn(),
  updateUserById: vi.fn(),
  adminThrows: false,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (mocks.adminThrows) throw new Error("sin service key");
    return {
      auth: { admin: { updateUserById: mocks.updateUserById } },
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }),
        insert: mocks.insert,
      }),
    };
  },
}));

import { ensureProfileForOAuthUser } from "./provision";

const TENANT = "tenant-a";

function user(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "rosa@gmail.com",
    app_metadata: { provider: "google", providers: ["google"] },
    user_metadata: { full_name: "Rosa Martínez", avatar_url: "https://lh3.googleusercontent.com/a" },
    aud: "authenticated",
    created_at: "2026-09-28T00:00:00Z",
    ...overrides,
  } as User;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.adminThrows = false;
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.updateUserById.mockResolvedValue({ error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ensureProfileForOAuthUser — alta nueva por Google", () => {
  it("setea app_metadata, crea el perfil con el sello legal y pide refrescar el JWT", async () => {
    const result = await ensureProfileForOAuthUser(user(), TENANT);

    expect(result).toEqual({ ok: true, created: true, claimsChanged: true });
    expect(mocks.updateUserById).toHaveBeenCalledWith("user-1", {
      app_metadata: expect.objectContaining({ tenant_id: TENANT, role: "member" }),
    });
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "user-1",
        tenant_id: TENANT,
        display_name: "Rosa Martínez",
        role: "member",
        terms_version: expect.any(String),
        age_confirmed_at: expect.any(String),
        terms_accepted_at: expect.any(String),
      }),
    );
  });

  it("si no se puede escribir el perfil, falla (el callback cierra la sesión)", async () => {
    mocks.insert.mockResolvedValue({ error: { code: "42501" } });

    expect(await ensureProfileForOAuthUser(user(), TENANT)).toEqual({
      ok: false,
      reason: "error",
    });
  });

  it("sin admin client falla cerrado", async () => {
    mocks.adminThrows = true;

    expect(await ensureProfileForOAuthUser(user(), TENANT)).toEqual({
      ok: false,
      reason: "error",
    });
  });

  it("si no se puede leer el perfil, no inventa un alta", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { code: "PGRST000" } });

    expect(await ensureProfileForOAuthUser(user(), TENANT)).toEqual({
      ok: false,
      reason: "error",
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});

describe("ensureProfileForOAuthUser — cuenta que ya existía", () => {
  /**
   * Cuenta creada con email y contraseña que después entra con Google: Supabase
   * vincula la identidad al MISMO usuario, así que el perfil ya está. No se
   * crea otro ni se manda a /bienvenida.
   */
  it("email+contraseña vinculada a Google, mismo tenant → no crea nada", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: "user-1", tenant_id: TENANT }, error: null });
    const linked = user({
      app_metadata: {
        provider: "email",
        providers: ["email", "google"],
        tenant_id: TENANT,
        role: "member",
      },
    });

    expect(await ensureProfileForOAuthUser(linked, TENANT)).toEqual({
      ok: true,
      created: false,
      claimsChanged: false,
    });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it("perfil de OTRA comunidad → se rechaza sin tocar app_metadata", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { id: "user-1", tenant_id: "tenant-b" },
      error: null,
    });

    expect(await ensureProfileForOAuthUser(user(), TENANT)).toEqual({
      ok: false,
      reason: "otro_tenant",
    });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("perfil sin el claim en el JWT → lo repara y pide refrescar", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: "user-1", tenant_id: TENANT }, error: null });

    expect(await ensureProfileForOAuthUser(user(), TENANT)).toEqual({
      ok: true,
      created: false,
      claimsChanged: true,
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("si la reparación del claim falla, no deja entrar con un JWT sin tenant", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: "user-1", tenant_id: TENANT }, error: null });
    mocks.updateUserById.mockResolvedValue({ error: { code: "unexpected_failure" } });

    expect(await ensureProfileForOAuthUser(user(), TENANT)).toEqual({
      ok: false,
      reason: "error",
    });
  });

  it("nunca degrada un rol existente", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: "user-1", tenant_id: TENANT }, error: null });
    const mod = user({ app_metadata: { provider: "google", role: "moderator" } });

    await ensureProfileForOAuthUser(mod, TENANT);

    expect(mocks.updateUserById).toHaveBeenCalledWith("user-1", {
      app_metadata: expect.objectContaining({ tenant_id: TENANT, role: "moderator" }),
    });
  });
});
