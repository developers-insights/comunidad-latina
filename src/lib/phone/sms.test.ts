import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("getSmsSender", () => {
  it("falla cerrado en producción si falta cualquier credencial", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    vi.stubEnv("TWILIO_API_KEY_SID", "");
    vi.stubEnv("TWILIO_API_KEY_SECRET", "");
    vi.stubEnv("TWILIO_PHONE_NUMBER", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getSmsSender } = await import("./sms");

    const result = await getSmsSender().send({
      to: "+19175550142",
      maskedTo: "+1 ••• 0142",
      body: "123456 es tu código",
    });

    expect(result).toEqual({ ok: false, reason: "proveedor" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("123456");
  });
});
