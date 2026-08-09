import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetTenantDomainCache,
  isPlatformHost,
  lookupTenantDomain,
  normalizeHost,
  shouldSkipLookup,
  type TenantDomainFetcher,
  type TenantDomainRow,
} from "./domain-lookup";

/**
 * La capa de I/O de la resolución Host→tenant (migración 0060).
 *
 * Todo lo que se testea acá tiene un costo real si se rompe: este código corre
 * en el proxy, o sea en CADA request de la app. Un caché que no cachea es una
 * consulta por visita; un caché que cachea de más es un dominio dado de alta
 * que "no anda"; un caché sin tope es memoria que crece con el header `Host`,
 * que lo elige quien visita.
 */

function row(over: Partial<TenantDomainRow> = {}): TenantDomainRow {
  return {
    tenant_id: "11111111-1111-4111-8111-111111111111",
    tenant_slug: "colombianos-miami",
    tenant_name: "Colombianos en Miami",
    matched_domain: "colombianosmiami.com",
    is_primary: true,
    primary_domain: "colombianosmiami.com",
    ...over,
  };
}

/** Fetcher de mentira, con contador de llamadas para verificar el caché. */
function fakeFetcher(impl: (host: string) => TenantDomainRow[] | Promise<never>) {
  const calls: string[] = [];
  const fn: TenantDomainFetcher = async (host) => {
    calls.push(host);
    return impl(host) as TenantDomainRow[];
  };
  return { fn, calls };
}

beforeEach(() => {
  __resetTenantDomainCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("normalizeHost — espeja app.normalize_tenant_domain() de la base", () => {
  it("baja a minúsculas, saca espacios, puerto y punto final", () => {
    // El caso del comentario de la migración: sin esto, `Host: DOMINICANOS.COM.`
    // sería un host distinto al de la fila y no resolvería.
    expect(normalizeHost("  DOMINICANOS.COM.  ")).toBe("dominicanos.com");
    expect(normalizeHost("dominicanos.com:3000")).toBe("dominicanos.com");
    expect(normalizeHost("LOCALHOST:3000")).toBe("localhost");
    expect(normalizeHost(null)).toBe("");
    expect(normalizeHost(undefined)).toBe("");
  });
});

describe("shouldSkipLookup — qué hosts ni siquiera llegan a la base", () => {
  it("un host con forma de hostname sí se consulta", () => {
    expect(shouldSkipLookup("colombianosmiami.com")).toBe(false);
    expect(shouldSkipLookup("localhost")).toBe(false); // 0060 permite filas `localhost`
  });

  it("los hosts efímeros de Vercel no se consultan (cada deploy estrena uno)", () => {
    expect(shouldSkipLookup("comunidad-latina-sigma.vercel.app")).toBe(true);
    expect(shouldSkipLookup("comunidad-latina-git-rama.vercel.sh")).toBe(true);
  });

  it("basura y hosts sin forma de hostname tampoco: el Host lo elige el cliente", () => {
    // Es el freno al spam de `Host`: lo que no puede existir en la tabla (mismo
    // CHECK que tenant_domains_domain_format) no gasta un round-trip.
    expect(shouldSkipLookup("")).toBe(true);
    expect(shouldSkipLookup("con espacios.com")).toBe(true);
    expect(shouldSkipLookup("-arranca-con-guion.com")).toBe(true);
    expect(shouldSkipLookup("[::1]")).toBe(true);
  });
});

describe("isPlatformHost — los hosts que nunca dan 404 ni redirigen", () => {
  it("localhost, loopback y los dominios de Vercel son de la plataforma", () => {
    // Sin esta lista, tratar "dominio desconocido" como 404 bajaría producción
    // entera: el host real de producción es un *.vercel.app que no está (ni
    // tiene por qué estar) en tenant_domains.
    expect(isPlatformHost("localhost")).toBe(true);
    expect(isPlatformHost("mi-app.localhost")).toBe(true);
    expect(isPlatformHost("127.0.0.1")).toBe(true);
    expect(isPlatformHost("[::1]")).toBe(true);
    expect(isPlatformHost("comunidad-latina-sigma.vercel.app")).toBe(true);
    expect(isPlatformHost("")).toBe(true);
  });

  it("un dominio propio NO es de la plataforma", () => {
    expect(isPlatformHost("colombianosmiami.com")).toBe(false);
    expect(isPlatformHost("dominicanos.com")).toBe(false);
  });

  it("TENANT_PLATFORM_HOSTS suma hosts sin desplegar (válvula de escape operativa)", () => {
    vi.stubEnv("TENANT_PLATFORM_HOSTS", "staging.interno.com, OTRO.COM:8080");
    expect(isPlatformHost("staging.interno.com")).toBe(true);
    expect(isPlatformHost("otro.com")).toBe(true);
    expect(isPlatformHost("ajeno.com")).toBe(false);
  });
});

describe("lookupTenantDomain — host conocido", () => {
  it("devuelve el tenant de la base y su canónico", async () => {
    const { fn } = fakeFetcher(() => [row()]);
    const result = await lookupTenantDomain("colombianosmiami.com", fn);
    expect(result).toEqual({
      status: "match",
      tenantId: "11111111-1111-4111-8111-111111111111",
      slug: "colombianos-miami",
      name: "Colombianos en Miami",
      matchedDomain: "colombianosmiami.com",
      isPrimary: true,
      primaryDomain: "colombianosmiami.com",
      stale: false,
    });
  });

  it("normaliza el host ANTES de consultar (mayúsculas, puerto, punto final)", async () => {
    const { fn, calls } = fakeFetcher(() => [row()]);
    await lookupTenantDomain("COLOMBIANOSMIAMI.COM.:443", fn);
    expect(calls).toEqual(["colombianosmiami.com"]);
  });

  it("descarta filas sin slug o sin id: el payload viene de la red", async () => {
    const { fn } = fakeFetcher(() => [{ tenant_slug: "" } as unknown as TenantDomainRow]);
    expect(await lookupTenantDomain("colombianosmiami.com", fn)).toEqual({ status: "unknown" });
  });
});

describe("lookupTenantDomain — host desconocido, suspendido o archivado", () => {
  it("cero filas es 'unknown' (los tres casos son indistinguibles a propósito)", async () => {
    // La base devuelve 0 filas por igual si el dominio no existe, si está
    // suspended, si está archived o si el tenant está pausado (comentario del
    // RPC en 0060). La app no aprende cuál fue, y un tercero tampoco.
    const { fn } = fakeFetcher(() => []);
    expect(await lookupTenantDomain("suspendido.com", fn)).toEqual({ status: "unknown" });
  });

  it("los hosts que no se consultan devuelven 'skipped', no 'unknown'", async () => {
    const { fn, calls } = fakeFetcher(() => [row()]);
    expect(await lookupTenantDomain("comunidad-latina-sigma.vercel.app", fn)).toEqual({
      status: "skipped",
    });
    expect(calls).toEqual([]);
  });
});

describe("lookupTenantDomain — caché", () => {
  it("un match se sirve del caché: una sola consulta para muchos requests", async () => {
    const { fn, calls } = fakeFetcher(() => [row()]);
    await lookupTenantDomain("colombianosmiami.com", fn);
    await lookupTenantDomain("colombianosmiami.com", fn);
    await lookupTenantDomain("colombianosmiami.com", fn);
    expect(calls).toHaveLength(1);
  });

  it("una ráfaga sobre un host frío dispara UNA consulta (single-flight)", async () => {
    let resolveFetch: (rows: TenantDomainRow[]) => void = () => {};
    const calls: string[] = [];
    const fn: TenantDomainFetcher = (host) => {
      calls.push(host);
      return new Promise((resolve) => {
        resolveFetch = resolve;
      });
    };

    const burst = Promise.all([
      lookupTenantDomain("colombianosmiami.com", fn),
      lookupTenantDomain("colombianosmiami.com", fn),
      lookupTenantDomain("colombianosmiami.com", fn),
    ]);
    resolveFetch([row()]);
    const results = await burst;

    expect(calls).toHaveLength(1);
    expect(results.every((r) => r.status === "match")).toBe(true);
  });

  it("el 'no existe' se cachea 1 minuto, no 5: el alta tiene que sentirse inmediata", async () => {
    vi.useFakeTimers();
    const { fn, calls } = fakeFetcher(() => []);

    await lookupTenantDomain("recien-comprado.com", fn);
    vi.advanceTimersByTime(59_000);
    await lookupTenantDomain("recien-comprado.com", fn);
    expect(calls).toHaveLength(1);

    vi.advanceTimersByTime(2_000);
    await lookupTenantDomain("recien-comprado.com", fn);
    expect(calls).toHaveLength(2);
  });

  it("el match se cachea 5 minutos (mismo número que la caché de `tenants`)", async () => {
    vi.useFakeTimers();
    const { fn, calls } = fakeFetcher(() => [row()]);

    await lookupTenantDomain("colombianosmiami.com", fn);
    vi.advanceTimersByTime(4 * 60_000);
    await lookupTenantDomain("colombianosmiami.com", fn);
    expect(calls).toHaveLength(1);

    vi.advanceTimersByTime(2 * 60_000);
    await lookupTenantDomain("colombianosmiami.com", fn);
    expect(calls).toHaveLength(2);
  });
});

describe("lookupTenantDomain — la base no responde", () => {
  it("sin nada en caché devuelve 'unavailable', nunca un match inventado", async () => {
    const { fn } = fakeFetcher(() => Promise.reject(new Error("ECONNRESET")));
    expect(await lookupTenantDomain("colombianosmiami.com", fn)).toEqual({
      status: "unavailable",
    });
  });

  it("con un match viejo en caché lo sigue sirviendo RANCIO", async () => {
    // Un dominio que ayer resolvía no deja de existir porque la base tosa. Y
    // este respaldo es mejor que DOMAIN_TENANTS: cubre los dominios dados de
    // alta DESPUÉS del último deploy, que es justo lo que el mapa no puede saber.
    vi.useFakeTimers();
    let alive = true;
    const fn: TenantDomainFetcher = async () => {
      if (!alive) throw new Error("base caída");
      return [row()];
    };

    await lookupTenantDomain("colombianosmiami.com", fn);
    alive = false;
    vi.advanceTimersByTime(10 * 60_000); // el caché fresco ya expiró

    const result = await lookupTenantDomain("colombianosmiami.com", fn);
    expect(result).toMatchObject({ status: "match", slug: "colombianos-miami", stale: true });
  });

  it("un 'no existe' viejo NO se sirve rancio: con la base caída no se estrena un 404", async () => {
    vi.useFakeTimers();
    let alive = true;
    const fn: TenantDomainFetcher = async () => {
      if (!alive) throw new Error("base caída");
      return [];
    };

    await lookupTenantDomain("desconocido.com", fn);
    alive = false;
    vi.advanceTimersByTime(10 * 60_000);

    expect(await lookupTenantDomain("desconocido.com", fn)).toEqual({ status: "unavailable" });
  });

  it("una falla no pisa el match ya cacheado", async () => {
    vi.useFakeTimers();
    let alive = true;
    const fn: TenantDomainFetcher = async () => {
      if (!alive) throw new Error("base caída");
      return [row()];
    };

    await lookupTenantDomain("colombianosmiami.com", fn);
    alive = false;
    vi.advanceTimersByTime(10 * 60_000);
    await lookupTenantDomain("colombianosmiami.com", fn); // rancio
    alive = true;

    const result = await lookupTenantDomain("colombianosmiami.com", fn);
    expect(result).toMatchObject({ status: "match", stale: false });
  });
});

describe("lookupTenantDomain — el caché tiene tope", () => {
  it("no crece sin límite aunque le manden hosts distintos en cada request", async () => {
    // El `Host` lo elige el cliente: sin tope, mandar hosts al azar sería un
    // camino directo a comerse la memoria de la instancia.
    const { fn, calls } = fakeFetcher(() => []);
    for (let i = 0; i < 600; i++) {
      await lookupTenantDomain(`spam-${i}.com`, fn);
    }
    // El más viejo ya fue desalojado → vuelve a consultarse.
    await lookupTenantDomain("spam-0.com", fn);
    expect(calls.filter((h) => h === "spam-0.com")).toHaveLength(2);

    // Y uno reciente sigue cacheado.
    const antes = calls.length;
    await lookupTenantDomain("spam-599.com", fn);
    expect(calls).toHaveLength(antes);
  });
});
