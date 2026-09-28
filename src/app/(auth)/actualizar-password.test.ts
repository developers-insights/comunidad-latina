import { beforeEach, describe, expect, it, vi } from "vitest";
import { PASSWORD_COPY } from "@/lib/auth/password-policy";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUser: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  limit: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => mocks.headers() }));
vi.mock("@/lib/rate-limit", () => ({
  limit: mocks.limit,
  HOUR_MS: 3_600_000,
  clientIpFromHeaders: () => "1.2.3.4",
}));
vi.mock("@/lib/tenant/resolve", () => ({
  getTenant: async () => ({ id: "tenant-1", name: "Dominicanos", brandHex: "#123456" }),
  KNOWN_TENANT_DOMAINS: new Set(["dominicanos.com"]),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: mocks.getUser,
      updateUser: mocks.updateUser,
      resetPasswordForEmail: mocks.resetPasswordForEmail,
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/auth/confirmation", () => ({
  sendConfirmationEmail: vi.fn(),
  resendConfirmationForCredentials: vi.fn(),
}));

import { requestPasswordResetAction, updatePasswordAction } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockReturnValue({ ok: true });
  mocks.headers.mockReturnValue(
    new Headers({ "x-forwarded-host": "dominicanos.com", "x-forwarded-proto": "https" }),
  );
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mocks.updateUser.mockResolvedValue({ error: null });
  mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
});

describe("updatePasswordAction", () => {
  it("fija la contraseña nueva cuando cumple la política y coincide", async () => {
    const result = await updatePasswordAction({
      password: "Nueva-clave9",
      passwordConfirm: "Nueva-clave9",
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "Nueva-clave9" });
  });

  it("aplica la misma política que el alta", async () => {
    const result = await updatePasswordAction({
      password: "nueva-clave9",
      passwordConfirm: "nueva-clave9",
    });

    expect(result).toEqual({ ok: false, fieldErrors: { password: PASSWORD_COPY.uppercase } });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("confirmación distinta → error en passwordConfirm", async () => {
    const result = await updatePasswordAction({
      password: "Nueva-clave9",
      passwordConfirm: "Nueva-clave8",
    });

    expect(result).toEqual({
      ok: false,
      fieldErrors: { passwordConfirm: PASSWORD_COPY.mismatch },
    });
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("confirmación vacía → pide repetirla", async () => {
    const result = await updatePasswordAction({ password: "Nueva-clave9", passwordConfirm: "" });

    expect(result.ok === false && result.fieldErrors?.passwordConfirm).toBe(
      PASSWORD_COPY.confirmRequired,
    );
  });

  it("sin sesión de recuperación no toca nada", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const result = await updatePasswordAction({
      password: "Nueva-clave9",
      passwordConfirm: "Nueva-clave9",
    });

    expect(result.ok).toBe(false);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
});

describe("requestPasswordResetAction", () => {
  it("el enlace vuelve al host propio validado", async () => {
    await requestPasswordResetAction({ email: "rosa@ejemplo.com" });

    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith("rosa@ejemplo.com", {
      redirectTo: "https://dominicanos.com/callback?next=/recuperar/actualizar",
    });
  });

  it("un host ajeno no se mete en el enlace", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.comunidadlatina.com");
    vi.stubEnv("VERCEL_ENV", "");
    mocks.headers.mockReturnValue(new Headers({ "x-forwarded-host": "localhost.atacante.example" }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));

    await requestPasswordResetAction({ email: "rosa@ejemplo.com" });

    const [, opts] = mocks.resetPasswordForEmail.mock.calls[0];
    expect(opts.redirectTo).toBe(
      "https://www.comunidadlatina.com/callback?next=/recuperar/actualizar",
    );
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("anti-enumeración: un error de Supabase devuelve el mismo éxito", async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({ error: { code: "user_not_found" } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await requestPasswordResetAction({ email: "nadie@ejemplo.com" })).toEqual({
      ok: true,
    });
  });
});
