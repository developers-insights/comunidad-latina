import { describe, expect, it } from "vitest";
import {
  decideTenantRouting,
  DOMAIN_UNAVAILABLE_PAGE,
  UNKNOWN_DOMAIN_PAGE,
  type TenantRouting,
  type TenantRoutingInput,
} from "./domain-routing";
import type { TenantDomainLookup } from "./domain-lookup";
import { DEFAULT_TENANT_SLUG } from "./resolve";

/**
 * La REGLA del proxy, sin un solo mock (mismo criterio que ./match.test.ts).
 *
 * Estos casos son el contrato del requisito contractual "sumar un dominio sin
 * reconstruir el código": la base manda, el mapa hardcodeado es respaldo, y un
 * dominio apagado no sirve contenido de nadie.
 */

function match(over: Partial<Extract<TenantDomainLookup, { status: "match" }>> = {}) {
  return {
    status: "match" as const,
    tenantId: "11111111-1111-4111-8111-111111111111",
    slug: "colombianos-miami",
    name: "Colombianos en Miami",
    matchedDomain: "colombianosmiami.com",
    isPrimary: true,
    primaryDomain: "colombianosmiami.com",
    stale: false,
    ...over,
  };
}

function decide(over: Partial<TenantRoutingInput> = {}): TenantRouting {
  return decideTenantRouting({
    hostname: "colombianosmiami.com",
    isPlatform: false,
    lookup: match(),
    hintSlug: DEFAULT_TENANT_SLUG,
    method: "GET",
    pathname: "/",
    search: "",
    ...over,
  });
}

describe("host conocido — la base es la fuente de verdad", () => {
  it("un dominio registrado sirve SU comunidad, sin pasar por el mapa hardcodeado", () => {
    // Este es el caso que antes exigía un commit: `colombianos-miami` no está
    // en DOMAIN_TENANTS y resuelve igual, porque tiene su fila en tenant_domains.
    expect(decide()).toEqual({ kind: "serve", slug: "colombianos-miami", source: "db" });
  });

  it("un match rancio (base caída, caché con la respuesta anterior) sirve igual", () => {
    expect(decide({ lookup: match({ stale: true }) })).toEqual({
      kind: "serve",
      slug: "colombianos-miami",
      source: "stale",
    });
  });

  it("un slug reservado de marca NO se sirve como comunidad, aunque la base lo mapee", () => {
    // Cargar comunidadlatina.com en tenant_domains no puede revertir en
    // silencio una decisión de marca tomada a mano (RESERVED_BRAND_SLUGS).
    expect(
      decide({
        hostname: "comunidadlatina.com",
        lookup: match({ slug: "comunidadlatina", primaryDomain: "comunidadlatina.com" }),
      }),
    ).toEqual({ kind: "serve", slug: DEFAULT_TENANT_SLUG, source: "db" });
  });
});

describe("host desconocido o suspendido — no sirve contenido de nadie", () => {
  const apagado: TenantDomainLookup = { status: "unknown" };

  it("un dominio propio que la base no reconoce da 404, NO la comunidad por defecto", () => {
    expect(decide({ hostname: "desconocido.com", lookup: apagado })).toEqual({
      kind: "unknown-domain",
    });
  });

  it("un dominio suspendido o archivado toma el MISMO camino (la base los devuelve iguales)", () => {
    // El RPC de 0060 devuelve 0 filas por igual para "no existe", "suspended" y
    // "archived". Si acá se distinguieran, el copy filtraría lo que el RPC se
    // cuida de no contar.
    expect(decide({ hostname: "suspendido.com", lookup: apagado })).toEqual({
      kind: "unknown-domain",
    });
    expect(decide({ hostname: "archivado.com", lookup: apagado })).toEqual({
      kind: "unknown-domain",
    });
  });

  it("la página de dominio desconocido es 404, sin caché y sin indexar", () => {
    expect(UNKNOWN_DOMAIN_PAGE.status).toBe(404);
    expect(UNKNOWN_DOMAIN_PAGE.headers["cache-control"]).toBe("no-store");
    expect(UNKNOWN_DOMAIN_PAGE.headers["x-robots-tag"]).toContain("noindex");
  });

  it("un host de la plataforma NUNCA da 404: sigue el comportamiento de siempre", () => {
    // Producción vive hoy en un *.vercel.app que no está en tenant_domains.
    // Si esto se rompe, el cambio baja el sitio entero.
    expect(
      decide({
        hostname: "comunidad-latina-sigma.vercel.app",
        isPlatform: true,
        lookup: { status: "skipped" },
        hintSlug: "dominicanos",
      }),
    ).toEqual({ kind: "serve", slug: "dominicanos", source: "platform" });

    expect(
      decide({
        hostname: "localhost",
        isPlatform: true,
        lookup: apagado,
        hintSlug: "barrio-nuevo",
      }),
    ).toEqual({ kind: "serve", slug: "barrio-nuevo", source: "platform" });
  });
});

describe("alias → canónico", () => {
  it("redirige al primario preservando path y query", () => {
    expect(
      decide({
        hostname: "cmiami.com",
        lookup: match({
          matchedDomain: "cmiami.com",
          isPrimary: false,
          primaryDomain: "colombianosmiami.com",
        }),
        pathname: "/eventos/salsa",
        search: "?pagina=2&orden=fecha",
      }),
    ).toEqual({
      kind: "redirect",
      location: "https://colombianosmiami.com/eventos/salsa?pagina=2&orden=fecha",
    });
  });

  it("www. → apex sale gratis: el RPC matchea el apex y el canónico es el apex", () => {
    // El RPC de 0060 prueba el host tal cual Y su versión sin `www.`, así que
    // registrar sólo el apex alcanza. Como el canónico devuelto es el apex y el
    // host que entró es el `www.`, la misma regla de alias produce la
    // canonicalización que normalmente hay que escribir a mano.
    expect(
      decide({
        hostname: "www.colombianosmiami.com",
        lookup: match({
          matchedDomain: "colombianosmiami.com",
          isPrimary: true,
          primaryDomain: "colombianosmiami.com",
        }),
        pathname: "/negocios",
      }),
    ).toEqual({ kind: "redirect", location: "https://colombianosmiami.com/negocios" });
  });

  it("estando YA en el canónico no redirige — el corte del bucle", () => {
    // `primaryDomain` viene normalizado por el trigger de la base y `hostname`
    // por normalizeHost(), que espeja ese mismo trigger: la comparación es
    // entre iguales, así que el segundo request apaga la condición.
    expect(
      decide({
        hostname: "colombianosmiami.com",
        lookup: match({ isPrimary: true, primaryDomain: "colombianosmiami.com" }),
      }),
    ).toEqual({ kind: "serve", slug: "colombianos-miami", source: "db" });
  });

  it("un tenant sin canónico activo no redirige a ningún lado", () => {
    expect(
      decide({
        hostname: "cmiami.com",
        lookup: match({ isPrimary: false, primaryDomain: null }),
      }),
    ).toEqual({ kind: "serve", slug: "colombianos-miami", source: "db" });
  });

  it("nunca redirige un host de la plataforma: no rompe previews ni localhost", () => {
    // Un preview saltando al dominio de producción del cliente convertiría cada
    // revisión de rama en una visita al sitio real.
    expect(
      decide({
        hostname: "comunidad-latina-git-rama.vercel.app",
        isPlatform: true,
        lookup: match({ isPrimary: false, primaryDomain: "colombianosmiami.com" }),
        hintSlug: "dominicanos",
      }),
    ).toEqual({ kind: "serve", slug: "colombianos-miami", source: "db" });
  });

  it("no redirige métodos con cuerpo: un 308 sobre POST lo reenviaría a otro host", () => {
    expect(
      decide({
        hostname: "cmiami.com",
        method: "POST",
        lookup: match({ isPrimary: false, primaryDomain: "colombianosmiami.com" }),
      }),
    ).toEqual({ kind: "serve", slug: "colombianos-miami", source: "db" });
  });

  it("no redirige hacia el canónico de un tenant reservado de marca", () => {
    expect(
      decide({
        hostname: "alias-de-marca.com",
        lookup: match({
          slug: "comunidadlatina",
          isPrimary: false,
          primaryDomain: "comunidadlatina.com",
        }),
      }),
    ).toEqual({ kind: "serve", slug: DEFAULT_TENANT_SLUG, source: "db" });
  });
});

describe("la base no responde — respaldo, nunca la comunidad equivocada", () => {
  const caida: TenantDomainLookup = { status: "unavailable" };

  it("un dominio del respaldo DOMAIN_TENANTS sigue resolviendo a su comunidad", () => {
    expect(decide({ hostname: "dominicanos.com", lookup: caida })).toEqual({
      kind: "serve",
      slug: "dominicanos",
      source: "fallback",
    });
    expect(decide({ hostname: "www.dominicanos.com", lookup: caida })).toEqual({
      kind: "serve",
      slug: "dominicanos",
      source: "fallback",
    });
  });

  it("un host de la plataforma cae a las pistas de siempre (?t=, cookie, default)", () => {
    expect(
      decide({
        hostname: "comunidad-latina-sigma.vercel.app",
        isPlatform: true,
        lookup: caida,
        hintSlug: "dominicanos",
      }),
    ).toEqual({ kind: "serve", slug: "dominicanos", source: "fallback" });
  });

  it("un dominio propio que ningún respaldo conoce da 503, NO la comunidad por defecto", () => {
    // Misma decisión que `classifyTenantMatch` para "tenant-unavailable": ante
    // una caída de infra no se afirma de más. Servirle a colombianosmiami.com el
    // contenido de dominicanos sería convertir un error de infra en "estás en la
    // comunidad equivocada" — el bug que ya nos comimos una vez.
    expect(decide({ hostname: "colombianosmiami.com", lookup: caida })).toEqual({
      kind: "unavailable-domain",
    });
  });

  it("la página de base caída es 503 y pide reintentar", () => {
    expect(DOMAIN_UNAVAILABLE_PAGE.status).toBe(503);
    expect(DOMAIN_UNAVAILABLE_PAGE.headers["retry-after"]).toBe("30");
  });

  it("el respaldo de marca también queda clampeado a la comunidad por defecto", () => {
    expect(decide({ hostname: "comunidadlatina.com", lookup: caida })).toEqual({
      kind: "serve",
      slug: DEFAULT_TENANT_SLUG,
      source: "fallback",
    });
  });
});

describe("las páginas de error no reflejan el Host", () => {
  it("ninguna de las dos interpola datos del request (sería un XSS regalado)", () => {
    // El `Host` lo elige quien visita. Meterlo en el HTML de una página que se
    // sirve sin escapar es la forma más barata de estrenar un XSS.
    for (const page of [UNKNOWN_DOMAIN_PAGE, DOMAIN_UNAVAILABLE_PAGE]) {
      expect(page.html).not.toMatch(/\$\{/);
      expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
    }
  });
});
