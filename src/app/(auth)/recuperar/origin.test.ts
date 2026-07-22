import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveOrigin } from "./origin";

/**
 * Lógica pura: de dónde sale el origin absoluto del enlace de recuperación.
 * Los headers del request mandan; env y localhost son los fallbacks.
 */

describe("resolveOrigin", () => {
  const originalEnv = process.env.NEXT_PUBLIC_SITE_URL;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = originalEnv;
  });

  it("prioriza x-forwarded-host + x-forwarded-proto", () => {
    const h = new Headers({
      "x-forwarded-host": "comunidad-latina.vercel.app",
      "x-forwarded-proto": "https",
      host: "internal:3000",
    });
    expect(resolveOrigin(h)).toBe("https://comunidad-latina.vercel.app");
  });

  it("toma el primer proto cuando x-forwarded-proto trae varios", () => {
    const h = new Headers({
      "x-forwarded-host": "ejemplo.com",
      "x-forwarded-proto": "https,http",
    });
    expect(resolveOrigin(h)).toBe("https://ejemplo.com");
  });

  it("cae a host y asume https fuera de localhost", () => {
    const h = new Headers({ host: "midominio.com" });
    expect(resolveOrigin(h)).toBe("https://midominio.com");
  });

  it("asume http cuando el host es localhost", () => {
    const h = new Headers({ host: "localhost:3000" });
    expect(resolveOrigin(h)).toBe("http://localhost:3000");
  });

  it("asume http cuando el host es 127.0.0.1", () => {
    const h = new Headers({ host: "127.0.0.1:3000" });
    expect(resolveOrigin(h)).toBe("http://127.0.0.1:3000");
  });

  it("sin host usa NEXT_PUBLIC_SITE_URL y le saca la barra final", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://comunidad-latina-sigma.vercel.app/";
    const h = new Headers();
    expect(resolveOrigin(h)).toBe("https://comunidad-latina-sigma.vercel.app");
  });

  it("sin host ni env cae a localhost:3000", () => {
    const h = new Headers();
    expect(resolveOrigin(h)).toBe("http://localhost:3000");
  });
});
