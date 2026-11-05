import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateLink: vi.fn(),
  sendEmail: vi.fn(),
  resendConfigured: true,
  sentryConfigured: true,
  adminFalla: false,
  captureException: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({ captureException: mocks.captureException }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (mocks.adminFalla) throw new Error("sin service role");
    return { auth: { admin: { generateLink: mocks.generateLink } } };
  },
}));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/config/services", () => ({
  get isResendConfigured() {
    return mocks.resendConfigured;
  },
  get isSentryConfigured() {
    return mocks.sentryConfigured;
  },
}));

import {
  buildRecoveryUrl,
  canalDeRecuperacionListo,
  claveDeLimitePorCuenta,
  sendRecoveryEmail,
} from "./recovery";

const BASE = {
  email: "persona@example.com",
  tenantName: "Comunidad Latina",
  brandHex: "#123456",
  origin: "https://www.comunidadlatina.com",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resendConfigured = true;
  mocks.sentryConfigured = true;
  mocks.adminFalla = false;
  mocks.generateLink.mockResolvedValue({
    data: { properties: { hashed_token: "hash-1", action_link: "http://localhost:3000/x" } },
    error: null,
  });
  mocks.sendEmail.mockResolvedValue({ ok: true });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

describe("buildRecoveryUrl", () => {
  it("apunta a nuestro /callback en el host de la persona", () => {
    const url = new URL(buildRecoveryUrl("https://dominicanos.com", "hash-1"));
    expect(url.origin).toBe("https://dominicanos.com");
    expect(url.pathname).toBe("/callback");
    expect(url.searchParams.get("token_hash")).toBe("hash-1");
    expect(url.searchParams.get("type")).toBe("recovery");
    expect(url.searchParams.get("next")).toBe("/recuperar/actualizar");
  });
});

describe("claveDeLimitePorCuenta", () => {
  it("no guarda el correo en claro y es estable para la misma cuenta", () => {
    const clave = claveDeLimitePorCuenta("persona@example.com");
    expect(clave).toMatch(/^recuperar-mail:[0-9a-f]{64}$/);
    expect(clave).not.toContain("persona");
    expect(claveDeLimitePorCuenta("persona@example.com")).toBe(clave);
    expect(claveDeLimitePorCuenta("otra@example.com")).not.toBe(clave);
  });
});

describe("canalDeRecuperacionListo", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("con Resend hay canal", () => {
    expect(canalDeRecuperacionListo()).toBe(true);
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it("sin Resend en un deploy no hay canal y queda alerta", () => {
    mocks.resendConfigured = false;
    vi.stubEnv("NODE_ENV", "production");

    expect(canalDeRecuperacionListo()).toBe(false);
    expect(console.error).toHaveBeenCalled();
    expect(mocks.captureException).toHaveBeenCalledOnce();
  });

  it("sin Resend en dev local sigue habiendo camino: el enlace va a la consola", () => {
    mocks.resendConfigured = false;
    expect(canalDeRecuperacionListo()).toBe(true);
  });
});

describe("sendRecoveryEmail", () => {
  it("manda nuestro enlace, nunca el action_link de Supabase", async () => {
    expect(await sendRecoveryEmail(BASE)).toEqual({ ok: true });

    expect(mocks.generateLink).toHaveBeenCalledWith({ type: "recovery", email: BASE.email });
    const { to, html } = mocks.sendEmail.mock.calls[0][0];
    expect(to).toBe(BASE.email);
    expect(html).toContain("https://www.comunidadlatina.com/callback?token_hash=hash-1");
    expect(html).not.toContain("localhost");
  });

  it("un correo que no existe no manda nada, no lanza y no alerta: es lo esperado", async () => {
    mocks.generateLink.mockResolvedValue({
      data: { properties: null },
      error: { code: "user_not_found" },
    });

    expect(await sendRecoveryEmail(BASE)).toEqual({ ok: false, reason: "mint" });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it.each([
    ["un error de Auth que no es user_not_found", { code: "over_request_rate_limit" }],
    ["un error sin código", { message: "boom" }],
  ])("%s va al log y a Sentry", async (_caso, error) => {
    mocks.generateLink.mockResolvedValue({ data: { properties: null }, error });

    expect(await sendRecoveryEmail(BASE)).toEqual({ ok: false, reason: "mint" });
    expect(console.error).toHaveBeenCalled();
    expect(mocks.captureException).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(BASE.email);
  });

  it("una respuesta sin hashed_token también alerta", async () => {
    mocks.generateLink.mockResolvedValue({ data: { properties: {} }, error: null });

    expect(await sendRecoveryEmail(BASE)).toEqual({ ok: false, reason: "mint" });
    expect(mocks.captureException).toHaveBeenCalledOnce();
  });

  it("si generateLink lanza, no se propaga y alerta", async () => {
    mocks.generateLink.mockRejectedValue(new Error("red caída"));

    expect(await sendRecoveryEmail(BASE)).toEqual({ ok: false, reason: "mint" });
    expect(console.error).toHaveBeenCalled();
    expect(mocks.captureException).toHaveBeenCalledOnce();
  });

  it("sin admin client alerta en vez de pasar en silencio", async () => {
    mocks.adminFalla = true;

    expect(await sendRecoveryEmail(BASE)).toEqual({ ok: false, reason: "mint" });
    expect(console.error).toHaveBeenCalled();
    expect(mocks.captureException).toHaveBeenCalledOnce();
  });

  it("sin canal de correo en producción no escribe el token en el log", async () => {
    mocks.resendConfigured = false;
    vi.stubEnv("NODE_ENV", "production");

    expect(await sendRecoveryEmail(BASE)).toEqual({ ok: false, reason: "email" });
    // Sin canal ni se mintea: un token que nadie va a entregar no tiene que existir.
    expect(mocks.generateLink).not.toHaveBeenCalled();
    const logs = JSON.stringify([
      vi.mocked(console.error).mock.calls,
      vi.mocked(console.info).mock.calls,
    ]);
    expect(logs).not.toContain("hash-1");
    vi.unstubAllEnvs();
  });

  it("sin Resend en dev imprime el enlace para poder probar", async () => {
    mocks.resendConfigured = false;

    await sendRecoveryEmail(BASE);
    expect(vi.mocked(console.info).mock.calls.flat().join(" ")).toContain("hash-1");
  });

  describe("reintento del envío", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("si el primer envío falla y el segundo sale, la persona recibe el correo", async () => {
      mocks.sendEmail
        .mockResolvedValueOnce({ ok: false, error: "caído" })
        .mockResolvedValueOnce({ ok: true });

      const envio = sendRecoveryEmail(BASE);
      await vi.runAllTimersAsync();

      expect(await envio).toEqual({ ok: true });
      expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
      expect(mocks.generateLink).toHaveBeenCalledOnce();
    });

    it("si Resend falla las dos veces, avisa sin lanzar", async () => {
      mocks.sendEmail.mockResolvedValue({ ok: false, error: "caído" });

      const envio = sendRecoveryEmail(BASE);
      await vi.runAllTimersAsync();

      expect(await envio).toEqual({ ok: false, reason: "email" });
      expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
    });

    it("no reintenta lo que salió bien", async () => {
      await sendRecoveryEmail(BASE);
      expect(mocks.sendEmail).toHaveBeenCalledOnce();
    });
  });
});
