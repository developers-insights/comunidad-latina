import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAllowedOriginHost, resolveOrigin } from "./origin";

/**
 * De dónde sale el origin absoluto de los enlaces que viajan por correo.
 *
 * Estos tests cambiaron en la auditoría 2026-08-02. Antes afirmaban que
 * CUALQUIER host del request ganaba ("midominio.com", "ejemplo.com"): o sea,
 * codificaban el host-header poisoning como si fuera el contrato. Hoy afirman
 * lo contrario —el host manda sólo si es NUESTRO— porque el enlace de
 * `/confirmar` lleva un token que abre sesión sin pedir la contraseña.
 */

const ENV_KEYS = [
  "NEXT_PUBLIC_SITE_URL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
] as const;

describe("resolveOrigin", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      original[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it("usa el host del request cuando es un dominio propio de un tenant", () => {
    const h = new Headers({
      "x-forwarded-host": "dominicanos.com",
      "x-forwarded-proto": "https",
      host: "internal:3000",
    });
    expect(resolveOrigin(h)).toBe("https://dominicanos.com");
  });

  it("usa el host del request cuando coincide con el deploy de Vercel", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "comunidad-latina-sigma.vercel.app";
    const h = new Headers({ "x-forwarded-host": "comunidad-latina-sigma.vercel.app" });
    expect(resolveOrigin(h)).toBe("https://comunidad-latina-sigma.vercel.app");
  });

  it("acepta el host único de un preview (VERCEL_URL)", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_URL = "cl-git-rama-equipo.vercel.app";
    const h = new Headers({ "x-forwarded-host": "cl-git-rama-equipo.vercel.app" });
    expect(resolveOrigin(h)).toBe("https://cl-git-rama-equipo.vercel.app");
  });

  it("IGNORA un x-forwarded-host ajeno y cae a la URL canónica", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://comunidad-latina-sigma.vercel.app";
    const h = new Headers({
      "x-forwarded-host": "atacante.example",
      host: "comunidad-latina-sigma.vercel.app",
    });
    expect(resolveOrigin(h)).toBe("https://comunidad-latina-sigma.vercel.app");
  });

  it("IGNORA un Host ajeno aunque no venga x-forwarded-host", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://comunidad-latina-sigma.vercel.app";
    const h = new Headers({ host: "atacante.example" });
    expect(resolveOrigin(h)).toBe("https://comunidad-latina-sigma.vercel.app");
  });

  it("acota el esquema: un x-forwarded-proto raro no se copia a la URL", () => {
    const h = new Headers({
      "x-forwarded-host": "dominicanos.com",
      "x-forwarded-proto": "javascript",
    });
    expect(resolveOrigin(h)).toBe("https://dominicanos.com");
  });

  it("toma el primer proto cuando x-forwarded-proto trae varios", () => {
    const h = new Headers({
      "x-forwarded-host": "dominicanos.com",
      "x-forwarded-proto": "https,http",
    });
    expect(resolveOrigin(h)).toBe("https://dominicanos.com");
  });

  it("asume http en localhost", () => {
    const h = new Headers({ host: "localhost:3000" });
    expect(resolveOrigin(h)).toBe("http://localhost:3000");
  });

  it("asume http en 127.0.0.1", () => {
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

describe("isAllowedOriginHost", () => {
  it("acepta los dominios de tenant, con y sin www", () => {
    expect(isAllowedOriginHost("dominicanos.com")).toBe(true);
    expect(isAllowedOriginHost("www.comunidadlatina.com")).toBe(true);
  });

  it("rechaza un host parecido: no hay match por sufijo ni por prefijo", () => {
    expect(isAllowedOriginHost("dominicanos.com.atacante.example")).toBe(false);
    expect(isAllowedOriginHost("evil-dominicanos.com")).toBe(false);
  });

  it("rechaza vacío", () => {
    expect(isAllowedOriginHost("   ")).toBe(false);
  });
});
