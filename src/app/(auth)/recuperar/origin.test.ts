import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetTenantDomainCache, type TenantDomainRow } from "@/lib/tenant/domain-lookup";
import {
  isAllowedOriginHost,
  isAllowedOriginHostAsync,
  resolveOrigin,
  resolveOriginAsync,
} from "./origin";

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

/**
 * =============================================================================
 * LOS DOMINIOS QUE EL CÓDIGO NO PUEDE CONOCER (auditoría 2026-08-13)
 * =============================================================================
 *
 * La allowlist de arriba sale de `DOMAIN_TENANTS`, el mapa HARDCODEADO. Desde
 * la migración 0060 los dominios se dan de alta en `public.tenant_domains`
 * desde el panel admin, sin deploy — y el comentario de ese mapa dice, con
 * todas las letras, que ahí NO hay que agregar los dominios nuevos.
 *
 * Consecuencia medida: una comunidad con dominio recién dado de alta se servía
 * perfecta, pero sus correos de confirmación y de reset salían con el host
 * canónico de Vercel en vez del suyo. La persona recibe un enlace a un dominio
 * que no reconoce, o directamente no lo encuentra. No hay error en ningún log.
 *
 * Lo que estos tests anclan es la MISMA asimetría que la de `robots.ts`, y por
 * una razón más dura: la base sólo puede SUMAR hosts propios. Que no conteste,
 * o que conteste que el host no existe, nunca puede terminar en honrar un host
 * ajeno — el enlace de `/confirmar` lleva un token que abre sesión sin pedir la
 * contraseña, así que un origin permisivo es una toma de cuenta, no un bug de
 * ruteo.
 */
describe("resolveOriginAsync — los dominios que sólo viven en tenant_domains", () => {
  const original: Record<string, string | undefined> = {};

  function row(host: string): TenantDomainRow {
    return {
      tenant_id: "11111111-1111-4111-8111-111111111111",
      tenant_slug: "colombianos-miami",
      tenant_name: "Colombianos en Miami",
      matched_domain: host,
      is_primary: true,
      primary_domain: host,
    };
  }

  /** Se stubea el transporte real: lo que puede romperse es el cableado. */
  function stubDb(responder: () => Response | Promise<Response>) {
    const fetchMock = vi.fn(async () => responder());
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const ok = (rows: TenantDomainRow[]) =>
    new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      original[key] = process.env[key];
      delete process.env[key];
    }
    process.env.NEXT_PUBLIC_SITE_URL = "https://comunidad-latina-sigma.vercel.app";
    __resetTenantDomainCache();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proyecto.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-de-mentira");
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("honra un dominio dado de alta desde el panel, que no está en el código", async () => {
    stubDb(() => ok([row("colombianosmiami.com")]));
    const h = new Headers({ "x-forwarded-host": "colombianosmiami.com" });

    // La versión síncrona todavía no lo conoce: por eso hace falta la otra.
    expect(resolveOrigin(h)).toBe("https://comunidad-latina-sigma.vercel.app");
    expect(await resolveOriginAsync(h)).toBe("https://colombianosmiami.com");
  });

  it("un host ajeno sigue sin pasar aunque la base esté sana", async () => {
    stubDb(() => ok([]));
    const h = new Headers({ "x-forwarded-host": "atacante.example" });

    expect(await resolveOriginAsync(h)).toBe("https://comunidad-latina-sigma.vercel.app");
  });

  it("con la base caída, un host desconocido NO se honra (fail-closed)", async () => {
    // Es el escenario donde una degradación mal pensada abriría el agujero:
    // "la base no contesta, dejemos pasar el host y ya". No.
    stubDb(() => Promise.reject(new Error("base caída")));
    const h = new Headers({ "x-forwarded-host": "atacante.example" });

    expect(await resolveOriginAsync(h)).toBe("https://comunidad-latina-sigma.vercel.app");
  });

  it("con la base caída, los dominios del respaldo hardcodeado siguen andando", async () => {
    stubDb(() => Promise.reject(new Error("base caída")));
    const h = new Headers({ "x-forwarded-host": "dominicanos.com" });

    expect(await resolveOriginAsync(h)).toBe("https://dominicanos.com");
  });

  it("lo que ya conocía el código no gasta una consulta", async () => {
    // localhost, los hosts de la plataforma y el mapa hardcodeado se resuelven
    // sin red: el registro no puede depender de que la base conteste a tiempo.
    const fetchMock = stubDb(() => ok([]));

    expect(await isAllowedOriginHostAsync("dominicanos.com")).toBe(true);
    expect(await isAllowedOriginHostAsync("localhost:3000")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un host sin forma de hostname no llega ni a consultarse", async () => {
    const fetchMock = stubDb(() => ok([]));

    expect(await isAllowedOriginHostAsync("no_es_un_host!")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
