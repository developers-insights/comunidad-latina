import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CANONICAL_SITE_URL,
  SiteUrlConfigError,
  __resetSiteUrlWarning,
  requireSiteUrl,
  siteUrlForMetadata,
} from "./site-url";

function entorno(vars: {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  VERCEL_URL?: string;
  SITE?: string;
}) {
  vi.stubEnv("NODE_ENV", vars.NODE_ENV ?? "test");
  vi.stubEnv("VERCEL_ENV", vars.VERCEL_ENV ?? "");
  vi.stubEnv("VERCEL_URL", vars.VERCEL_URL ?? "");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", vars.SITE ?? "");
}

beforeEach(() => {
  __resetSiteUrlWarning();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("requireSiteUrl — enlaces que salen del sitio", () => {
  it("en desarrollo sin env sigue andando con localhost", () => {
    entorno({ NODE_ENV: "development" });
    expect(requireSiteUrl()).toBe("http://localhost:3000");
  });

  it("en desarrollo respeta la env y le saca la barra final", () => {
    entorno({ NODE_ENV: "development", SITE: "http://localhost:4000/" });
    expect(requireSiteUrl()).toBe("http://localhost:4000");
  });

  it("en producción devuelve la env configurada", () => {
    entorno({
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      SITE: "https://www.comunidadlatina.com/",
    });
    expect(requireSiteUrl()).toBe("https://www.comunidadlatina.com");
  });

  it("en producción sin env falla fuerte", () => {
    entorno({ NODE_ENV: "production", VERCEL_ENV: "production" });
    expect(() => requireSiteUrl()).toThrow(SiteUrlConfigError);
  });

  it("falla aunque Vercel no esté: NODE_ENV=production alcanza", () => {
    entorno({ NODE_ENV: "production" });
    expect(() => requireSiteUrl()).toThrow(SiteUrlConfigError);
  });

  it.each([
    "http://localhost:3000",
    "https://localhost",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
    "http://0.0.0.0:3000",
    "http://mi-app.localhost:3000",
  ])("en producción una env local (%s) también falla", (site) => {
    entorno({ NODE_ENV: "production", VERCEL_ENV: "production", SITE: site });
    expect(() => requireSiteUrl()).toThrow(SiteUrlConfigError);
  });

  it("en producción una env mal formada falla", () => {
    entorno({ NODE_ENV: "production", VERCEL_ENV: "production", SITE: "comunidad latina" });
    expect(() => requireSiteUrl()).toThrow(SiteUrlConfigError);
  });

  it("el mensaje dice qué variable corregir", () => {
    entorno({ NODE_ENV: "production", VERCEL_ENV: "production" });
    expect(() => requireSiteUrl()).toThrow(/NEXT_PUBLIC_SITE_URL/);
  });

  it("un preview sin env usa el host del deploy en vez de fallar", () => {
    entorno({ NODE_ENV: "production", VERCEL_ENV: "preview", VERCEL_URL: "cl-abc.vercel.app" });
    expect(requireSiteUrl()).toBe("https://cl-abc.vercel.app");
  });

  it("un preview con env local también usa el host del deploy", () => {
    entorno({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      VERCEL_URL: "cl-abc.vercel.app",
      SITE: "http://localhost:3000",
    });
    expect(requireSiteUrl()).toBe("https://cl-abc.vercel.app");
  });

  it("en producción NO cae al host efímero del deploy", () => {
    entorno({ NODE_ENV: "production", VERCEL_ENV: "production", VERCEL_URL: "cl-abc.vercel.app" });
    expect(() => requireSiteUrl()).toThrow(SiteUrlConfigError);
  });
});

describe("siteUrlForMetadata — lo que se evalúa en el build", () => {
  it("con la env bien, es la env", () => {
    entorno({ NODE_ENV: "production", SITE: "https://dominicanos.com" });
    expect(siteUrlForMetadata()).toBe("https://dominicanos.com");
  });

  it("sin env en producción NO lanza: el build no se puede romper", () => {
    entorno({ NODE_ENV: "production" });
    expect(siteUrlForMetadata()).toBe(CANONICAL_SITE_URL);
  });

  it("nunca devuelve localhost en producción", () => {
    entorno({ NODE_ENV: "production", SITE: "http://localhost:3000" });
    expect(siteUrlForMetadata()).toBe(CANONICAL_SITE_URL);
  });

  it("avisa una sola vez por proceso, no una por página", () => {
    entorno({ NODE_ENV: "production" });
    siteUrlForMetadata();
    siteUrlForMetadata();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("en desarrollo sigue siendo localhost", () => {
    entorno({ NODE_ENV: "development" });
    expect(siteUrlForMetadata()).toBe("http://localhost:3000");
  });
});

/**
 * El bug no vuelve por la puerta de atrás: nadie puede escribir de nuevo un
 * fallback a localhost a mano, ni llamar al helper estricto mientras se evalúa
 * un módulo (eso rompería el build con la env ausente).
 */
describe("el repo no vuelve a caer a localhost", () => {
  function archivos(dir: string): string[] {
    return readdirSync(dir).flatMap((nombre) => {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) return archivos(ruta);
      return /\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre) ? [ruta] : [];
    });
  }
  const fuentes = archivos(join(process.cwd(), "src")).map((ruta) => ({
    ruta,
    texto: readFileSync(ruta, "utf8"),
  }));

  it("no queda ningún `NEXT_PUBLIC_SITE_URL ?? <url>`", () => {
    const culpables = fuentes
      .filter(({ ruta }) => !ruta.endsWith("site-url.ts"))
      .filter(({ texto }) => /NEXT_PUBLIC_SITE_URL\s*\?\?\s*(["'`]http|new URL)/.test(texto))
      .map(({ ruta }) => ruta);
    expect(culpables).toEqual([]);
  });

  it("nadie llama a requireSiteUrl en el nivel superior de un módulo", () => {
    const culpables = fuentes
      .filter(({ texto }) => /^(export )?const \w+\s*(:\s*\w+\s*)?=\s*requireSiteUrl\(\)/m.test(texto))
      .map(({ ruta }) => ruta);
    expect(culpables).toEqual([]);
  });
});
