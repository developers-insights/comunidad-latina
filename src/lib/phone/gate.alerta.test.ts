import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureMessage = vi.hoisted(() => vi.fn());

vi.mock("@sentry/nextjs", () => ({ captureMessage }));
vi.mock("@/lib/config/services", () => ({
  isPhoneVerificationEnabled: false,
  isPhonePepperConfigured: true,
  isSmsConfigured: true,
  isSentryConfigured: true,
}));

const BLOQUEADA = {
  hasSession: true,
  isStaff: false,
  phoneVerified: false,
  tenantRequires: true,
} as const;

// El tope vive en el módulo, así que cada test necesita un proceso nuevo.
async function gateNuevo() {
  vi.resetModules();
  return import("./gate");
}

beforeEach(() => {
  vi.useFakeTimers();
  captureMessage.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("la alerta de teléfono exigido con el flujo caído", () => {
  it("avisa una sola vez aunque se renderice muchas veces", async () => {
    const { getPhoneGateStatus } = await gateNuevo();

    for (let i = 0; i < 50; i += 1) {
      expect(getPhoneGateStatus(BLOQUEADA)).toBe("sin_salida");
    }

    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("vuelve a avisar recién a los 10 minutos", async () => {
    const { getPhoneGateStatus } = await gateNuevo();

    getPhoneGateStatus(BLOQUEADA);
    vi.advanceTimersByTime(10 * 60 * 1000 - 1);
    getPhoneGateStatus(BLOQUEADA);
    expect(captureMessage).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    getPhoneGateStatus(BLOQUEADA);
    expect(captureMessage).toHaveBeenCalledTimes(2);
  });

  it("quien no está bloqueado no gasta el aviso", async () => {
    const { getPhoneGateStatus } = await gateNuevo();

    getPhoneGateStatus({ ...BLOQUEADA, phoneVerified: true });
    expect(captureMessage).not.toHaveBeenCalled();

    getPhoneGateStatus(BLOQUEADA);
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });
});
