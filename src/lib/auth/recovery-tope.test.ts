import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  limit: vi.fn(),
  adminFalla: false,
}));

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/config/services", () => ({ isSentryConfigured: false }));
vi.mock("@/lib/rate-limit", () => ({ limit: mocks.limit, HOUR_MS: 3_600_000 }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (mocks.adminFalla) throw new Error("sin service role");
    return { rpc: mocks.rpc };
  },
}));
vi.mock("./recovery", () => ({
  claveDeLimitePorCuenta: (email: string) => `recuperar-mail:hash-de-${email.length}`,
}));

import { cuentaPuedePedirRecuperacion, ipPuedePedirRecuperacion } from "./recovery-tope";

function responde(respuesta: { data?: unknown; error?: unknown }) {
  return { abortSignal: async () => respuesta };
}

const EMAIL = "rosa@ejemplo.com";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.adminFalla = false;
  mocks.rpc.mockReturnValue(responde({ data: true, error: null }));
  mocks.limit.mockReturnValue({ ok: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ipPuedePedirRecuperacion", () => {
  it("cuenta en la base con 5 por hora y sin la IP en claro", async () => {
    expect(await ipPuedePedirRecuperacion("1.2.3.4")).toBe(true);

    const [nombre, args] = mocks.rpc.mock.calls[0];
    expect(nombre).toBe("consumir_tope_de_recuperacion");
    expect(args).toMatchObject({ p_maximo: 5, p_ventana_segundos: 3600 });
    expect(args.p_clave).toMatch(/^recuperar:[0-9a-f]{64}$/);
    expect(args.p_clave).not.toContain("1.2.3.4");
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("respeta el no de la base sin consultar la memoria", async () => {
    mocks.rpc.mockReturnValue(responde({ data: false, error: null }));

    expect(await ipPuedePedirRecuperacion("1.2.3.4")).toBe(false);
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("sin IP real no toca el cupo compartido de la base", async () => {
    expect(await ipPuedePedirRecuperacion("unknown")).toBe(true);

    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.limit).toHaveBeenCalledWith("recuperar:unknown", 5, 3_600_000);
  });
});

describe("cuentaPuedePedirRecuperacion", () => {
  it("pide la espera de 60 s y el cupo de 3 por hora, con claves distintas", async () => {
    expect(await cuentaPuedePedirRecuperacion(EMAIL)).toBe(true);

    const [espera, cupo] = mocks.rpc.mock.calls.map(([, args]) => args);
    expect(espera).toMatchObject({ p_maximo: 1, p_ventana_segundos: 60 });
    expect(cupo).toMatchObject({ p_maximo: 3, p_ventana_segundos: 3600 });
    expect(espera.p_clave).not.toBe(cupo.p_clave);
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(EMAIL);
  });

  it("un pedido dentro de la espera no gasta el cupo de la hora", async () => {
    mocks.rpc.mockReturnValueOnce(responde({ data: false, error: null }));

    expect(await cuentaPuedePedirRecuperacion(EMAIL)).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("corta cuando se acabó el cupo de la hora", async () => {
    mocks.rpc
      .mockReturnValueOnce(responde({ data: true, error: null }))
      .mockReturnValueOnce(responde({ data: false, error: null }));

    expect(await cuentaPuedePedirRecuperacion(EMAIL)).toBe(false);
  });
});

describe("si la base no contesta", () => {
  it("sin la RPC cae a la memoria y lo deja en los logs", async () => {
    mocks.rpc.mockReturnValue(responde({ data: null, error: { code: "PGRST202" } }));

    expect(await ipPuedePedirRecuperacion("1.2.3.4")).toBe(true);

    expect(mocks.limit).toHaveBeenCalledWith("recuperar:1.2.3.4", 5, 3_600_000);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("tope durable"), {
      code: "PGRST202",
    });
  });

  it("la memoria también puede decir que no", async () => {
    mocks.rpc.mockReturnValue(responde({ data: null, error: { code: "PGRST202" } }));
    mocks.limit.mockReturnValue({ ok: false });

    expect(await ipPuedePedirRecuperacion("1.2.3.4")).toBe(false);
  });

  it("una excepción del cliente nunca sale de acá", async () => {
    mocks.adminFalla = true;

    await expect(cuentaPuedePedirRecuperacion(EMAIL)).resolves.toBe(true);
    expect(mocks.limit).toHaveBeenCalledTimes(2);
  });

  it("una base colgada no deja a nadie esperando: el timeout cae a la memoria", async () => {
    mocks.rpc.mockReturnValue({
      abortSignal: async () => {
        throw new DOMException("timeout", "TimeoutError");
      },
    });

    await expect(ipPuedePedirRecuperacion("1.2.3.4")).resolves.toBe(true);
    expect(mocks.limit).toHaveBeenCalledTimes(1);
  });

  it("una respuesta rara no se toma por un sí", async () => {
    mocks.rpc.mockReturnValue(responde({ data: null, error: null }));
    mocks.limit.mockReturnValue({ ok: false });

    expect(await ipPuedePedirRecuperacion("1.2.3.4")).toBe(false);
  });
});
