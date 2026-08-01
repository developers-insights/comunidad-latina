import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de la ruta que canjea el enlace de confirmación.
 *
 * Garantías cubiertas:
 *  - Token válido → sesión (verifyOtp con type "signup") y aterrizaje en el
 *    `next` que venía en el enlace.
 *  - Open redirect: un `next` externo se ignora y cae al default interno.
 *  - Token ausente, vencido o ya usado → /entrar?error=confirmacion, que es la
 *    pantalla desde donde se puede pedir otro enlace. Nunca una pantalla muerta.
 *  - La bienvenida se manda recién acá (al confirmar), no en el registro.
 */

const mocks = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  sendEmailInBackground: vi.fn(),
  getTenant: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { verifyOtp: mocks.verifyOtp } }),
}));
vi.mock("@/lib/email", () => ({ sendEmailInBackground: mocks.sendEmailInBackground }));
vi.mock("@/lib/tenant/resolve", () => ({ getTenant: mocks.getTenant }));

import { GET } from "./route";

const ORIGIN = "https://comunidad-latina-sigma.vercel.app";

function request(query: string): Request {
  return new Request(`${ORIGIN}/confirmar${query}`);
}

function confirmedUser() {
  return {
    data: {
      user: {
        id: "user-1",
        email: "rosa@ejemplo.com",
        user_metadata: { display_name: "Rosa" },
      },
    },
    error: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getTenant.mockResolvedValue({
    name: "Dominicanos en Chile",
    brandHex: "#123456",
  });
  mocks.verifyOtp.mockResolvedValue(confirmedUser());
});

describe("GET /confirmar", () => {
  it("canjea el token y manda al destino que venía en el enlace", async () => {
    const res = await GET(
      request("?token_hash=hash-123&type=signup&next=%2Fpropiedades%3Fzona%3DNu%C3%B1oa"),
    );

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      type: "signup",
      token_hash: "hash-123",
    });
    expect(res.status).toBe(307);
    // El acento viaja percent-encoded, como corresponde en un Location.
    expect(res.headers.get("location")).toBe(
      `${ORIGIN}/propiedades?zona=Nu%C3%B1oa`,
    );
  });

  it("manda la bienvenida recién al confirmar", async () => {
    await GET(request("?token_hash=hash-123"));

    expect(mocks.sendEmailInBackground).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmailInBackground.mock.calls[0][0].to).toBe("rosa@ejemplo.com");
  });

  it("ignora un next externo (open redirect)", async () => {
    const res = await GET(request("?token_hash=hash-123&next=https%3A%2F%2Fmalo.com"));

    expect(res.headers.get("location")).toBe(`${ORIGIN}/bienvenida`);
  });

  it("sin token no toca Supabase y manda a pedir otro enlace", async () => {
    const res = await GET(request(""));

    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe(`${ORIGIN}/entrar?error=confirmacion`);
  });

  it("con el token vencido o ya usado manda a pedir otro enlace", async () => {
    mocks.verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { code: "otp_expired" },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(request("?token_hash=usado"));

    expect(res.headers.get("location")).toBe(`${ORIGIN}/entrar?error=confirmacion`);
    expect(mocks.sendEmailInBackground).not.toHaveBeenCalled();
  });
});
