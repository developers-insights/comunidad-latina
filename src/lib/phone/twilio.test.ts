import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTwilioSender } from "./twilio";

const mocks = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }));

const MESSAGE = {
  to: "+19175550142",
  body: "123456 es tu código de Comunidad Latina.",
  maskedTo: "+1 ••• 0142",
  code: "123456",
};

beforeEach(() => {
  mocks.fetch.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubEnv("TWILIO_ACCOUNT_SID", "account-sid-de-test");
  vi.stubEnv("TWILIO_API_KEY_SID", "api-key-sid-de-test");
  vi.stubEnv("TWILIO_API_KEY_SECRET", "api-key-secret-de-test");
  vi.stubEnv("TWILIO_PHONE_NUMBER", "+15550000000");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/**
 * Twilio es un borde de red que no participa de la transacción del código. Estos
 * tests fijan su traducción: un rechazo del destinatario se informa como tal, y
 * una caída o una respuesta que no se puede interpretar nunca hace explotar la
 * verificación ni convierte el SMS en PII de los logs.
 */
describe("createTwilioSender", () => {
  it("manda SMS desde el toll-free a un número de EE.UU.", async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 201 }));

    await createTwilioSender().send(MESSAGE);

    const body = mocks.fetch.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("To")).toBe("+19175550142");
    expect(body.get("From")).toBe("+15550000000");
    expect(body.get("Body")).toBe(MESSAGE.body);
    expect(body.get("ContentSid")).toBeNull();
  });

  it("manda por WhatsApp con la plantilla a un número de otro país", async () => {
    vi.stubEnv("TWILIO_WHATSAPP_FROM", "+15550000000");
    vi.stubEnv("TWILIO_WHATSAPP_OTP_CONTENT_SID", "HX-de-test");
    mocks.fetch.mockResolvedValue(new Response(null, { status: 201 }));

    await expect(
      createTwilioSender().send({ ...MESSAGE, to: "+5491134272488", maskedTo: "+54 ••• 2488" }),
    ).resolves.toEqual({ ok: true });

    const body = mocks.fetch.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("To")).toBe("whatsapp:+5491134272488");
    expect(body.get("From")).toBe("whatsapp:+15550000000");
    expect(body.get("ContentSid")).toBe("HX-de-test");
    expect(JSON.parse(body.get("ContentVariables") ?? "{}")).toEqual({ "1": "123456" });
    expect(body.get("Body")).toBeNull();
  });

  it("sin plantilla de WhatsApp no intenta mandar a un número de otro país", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      createTwilioSender().send({ ...MESSAGE, to: "+18095550142", maskedTo: "+1 ••• 0142" }),
    ).resolves.toEqual({ ok: false, reason: "proveedor" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("acepta una respuesta 201", async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 201 }));

    await expect(createTwilioSender().send(MESSAGE)).resolves.toEqual({ ok: true });
  });

  it("traduce un 400 con 21211 a rechazado", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ code: 21211 }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(createTwilioSender().send(MESSAGE)).resolves.toEqual({
      ok: false,
      reason: "rechazado",
    });
  });

  it("traduce un 401 a rechazado", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ code: 20003 }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(createTwilioSender().send(MESSAGE)).resolves.toEqual({
      ok: false,
      reason: "rechazado",
    });
  });

  it.each([21214, 21610, 21612, 21614])(
    "traduce el código Twilio %i a rechazado aunque el status no sea 4xx",
    async (code) => {
      mocks.fetch.mockResolvedValue(
        new Response(JSON.stringify({ code }), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await expect(createTwilioSender().send(MESSAGE)).resolves.toEqual({
        ok: false,
        reason: "rechazado",
      });
    },
  );

  it("traduce un 500 a proveedor", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ code: 20500 }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(createTwilioSender().send(MESSAGE)).resolves.toEqual({
      ok: false,
      reason: "proveedor",
    });
  });

  it("traduce una red caída a proveedor", async () => {
    mocks.fetch.mockRejectedValue(new Error("red caída"));

    await expect(createTwilioSender().send(MESSAGE)).resolves.toEqual({
      ok: false,
      reason: "proveedor",
    });
  });

  it("autentica con la API Key y manda el formulario que espera Twilio", async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 201 }));

    await createTwilioSender().send(MESSAGE);

    const [url, init] = mocks.fetch.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/account-sid-de-test/Messages.json",
    );
    expect(init).toBeDefined();
    if (!init) return;

    expect(new Headers(init.headers).get("Authorization")).toBe(
      `Basic ${Buffer.from("api-key-sid-de-test:api-key-secret-de-test").toString("base64")}`,
    );
    expect(new URLSearchParams(init.body?.toString())).toEqual(
      new URLSearchParams({ To: MESSAGE.to, From: "+15550000000", Body: MESSAGE.body }),
    );
  });

  it("no filtra el número completo a ningún logger", async () => {
    const loggers = ["debug", "error", "info", "log", "warn"] as const;
    const spies = loggers.map((logger) => vi.spyOn(console, logger).mockImplementation(() => {}));
    mocks.fetch.mockRejectedValue(new Error("red caída"));

    await createTwilioSender().send(MESSAGE);

    expect(JSON.stringify(spies.map((spy) => spy.mock.calls))).not.toContain(MESSAGE.to);
  });
});
