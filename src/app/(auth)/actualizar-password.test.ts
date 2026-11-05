import { beforeEach, describe, expect, it, vi } from "vitest";
import { PASSWORD_COPY } from "@/lib/auth/password-policy";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUser: vi.fn(),
  sendRecoveryEmail: vi.fn(),
  canalListo: vi.fn(),
  limit: vi.fn(),
  headers: vi.fn(),
  despues: [] as Array<() => unknown>,
}));

vi.mock("next/headers", () => ({ headers: async () => mocks.headers() }));
// `after` guarda el trabajo: el test decide cuándo "ya salió la respuesta".
vi.mock("next/server", () => ({
  after: (tarea: () => unknown) => {
    mocks.despues.push(tarea);
  },
}));
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
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/auth/recovery", () => ({
  sendRecoveryEmail: mocks.sendRecoveryEmail,
  canalDeRecuperacionListo: mocks.canalListo,
  claveDeLimitePorCuenta: (email: string) => `cuenta:${email}`,
}));
vi.mock("@/lib/auth/confirmation", () => ({
  sendConfirmationEmail: vi.fn(),
  resendConfirmationForCredentials: vi.fn(),
}));

import { requestPasswordResetAction, updatePasswordAction } from "./actions";

/** Corre lo que `after` dejó pendiente, como hace Next al terminar la respuesta. */
async function terminarRespuesta() {
  await Promise.all(mocks.despues.splice(0).map((tarea) => tarea()));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.despues.length = 0;
  mocks.canalListo.mockReturnValue(true);
  mocks.limit.mockReturnValue({ ok: true });
  mocks.headers.mockReturnValue(
    new Headers({ "x-forwarded-host": "dominicanos.com", "x-forwarded-proto": "https" }),
  );
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mocks.updateUser.mockResolvedValue({ error: null });
  mocks.sendRecoveryEmail.mockResolvedValue({ ok: true });
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
    await terminarRespuesta();

    expect(mocks.sendRecoveryEmail).toHaveBeenCalledWith({
      email: "rosa@ejemplo.com",
      tenantName: "Dominicanos",
      brandHex: "#123456",
      origin: "https://dominicanos.com",
    });
  });

  it("un host ajeno no se mete en el enlace", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.comunidadlatina.com");
    vi.stubEnv("VERCEL_ENV", "");
    mocks.headers.mockReturnValue(new Headers({ "x-forwarded-host": "localhost.atacante.example" }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));

    await requestPasswordResetAction({ email: "rosa@ejemplo.com" });
    await terminarRespuesta();

    expect(mocks.sendRecoveryEmail.mock.calls[0][0].origin).toBe(
      "https://www.comunidadlatina.com",
    );
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("el host con usuario y clave no se lleva el token a otro dominio", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.comunidadlatina.com");
    mocks.headers.mockReturnValue(
      new Headers({ "x-forwarded-host": "dominicanos.com:x@evil.com" }),
    );

    await requestPasswordResetAction({ email: "rosa@ejemplo.com" });
    await terminarRespuesta();

    expect(mocks.sendRecoveryEmail.mock.calls[0][0].origin).toBe(
      "https://www.comunidadlatina.com",
    );
    vi.unstubAllEnvs();
  });

  it("en producción sin URL del sitio avisa, y no manda un enlace a localhost", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    mocks.headers.mockReturnValue(new Headers({ "x-forwarded-host": "localhost:3000" }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await requestPasswordResetAction({ email: "rosa@ejemplo.com" });

    expect(result.ok).toBe(false);
    expect(mocks.despues).toHaveLength(0);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("anti-enumeración: si el enlace no se pudo mintear devuelve el mismo éxito", async () => {
    mocks.sendRecoveryEmail.mockResolvedValue({ ok: false, reason: "mint" });

    expect(await requestPasswordResetAction({ email: "nadie@ejemplo.com" })).toEqual({
      ok: true,
    });
  });

  it("responde sin esperar el envío: el tiempo no delata si la cuenta existe", async () => {
    expect(await requestPasswordResetAction({ email: "rosa@ejemplo.com" })).toEqual({ ok: true });

    // La respuesta ya está y el correo todavía no se tocó.
    expect(mocks.sendRecoveryEmail).not.toHaveBeenCalled();
    expect(mocks.despues).toHaveLength(1);

    await terminarRespuesta();
    expect(mocks.sendRecoveryEmail).toHaveBeenCalledOnce();
  });

  it("topa por cuenta antes de mintear, con la misma respuesta", async () => {
    mocks.limit.mockImplementation((key: string) => ({ ok: !key.startsWith("cuenta:") }));

    expect(await requestPasswordResetAction({ email: "rosa@ejemplo.com" })).toEqual({ ok: true });
    expect(mocks.limit).toHaveBeenCalledWith("cuenta:rosa@ejemplo.com", 3, 3_600_000);
    expect(mocks.despues).toHaveLength(0);
  });

  it("el tope por IP sigue avisando", async () => {
    mocks.limit.mockImplementation((key: string) => ({ ok: !key.startsWith("recuperar:") }));

    const result = await requestPasswordResetAction({ email: "rosa@ejemplo.com" });
    expect(result.ok).toBe(false);
    expect(mocks.despues).toHaveLength(0);
  });

  it("sin canal de correo avisa lo mismo para todo correo y no mintea ni gasta el cupo", async () => {
    mocks.canalListo.mockReturnValue(false);

    const existente = await requestPasswordResetAction({ email: "rosa@ejemplo.com" });
    const inexistente = await requestPasswordResetAction({ email: "nadie@ejemplo.com" });

    expect(existente.ok).toBe(false);
    expect(existente).toEqual(inexistente);
    expect(mocks.despues).toHaveLength(0);
    expect(mocks.limit).not.toHaveBeenCalledWith(
      expect.stringContaining("cuenta:"),
      expect.anything(),
      expect.anything(),
    );
  });
});
