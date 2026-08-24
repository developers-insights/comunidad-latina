import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetTenantSlugCache,
  confirmClientTenantHints,
  decideClientHints,
  lookupTenantSlug,
  type TenantSlugFetcher,
  type TenantSlugStatus,
} from "./slug-lookup";

/**
 * EL BUG QUE ESTE ARCHIVO CIERRA (reproducido en vivo el 2026-08-24).
 *
 * `?t=` tenía DOS significados a la vez: pista de comunidad para el proxy, y
 * parámetro de PESTAÑA en el perfil (`profileTabHref` → `/perfil?t=fotos`).
 * Como `resolveTenantSlug` acepta cualquier slug que no esté reservado —a
 * propósito, para que una comunidad recién creada resuelva sin deploy— hacer
 * click en la pestaña "Fotos" dejaba la cookie `cl-tenant=fotos` por 30 días.
 * Desde ahí TODA la app resolvía a una comunidad inexistente y las secciones se
 * veían VACÍAS SIN UN SOLO ERROR: el síntoma más caro de todos.
 *
 * La regla que lo cierra, y que estos tests custodian: **una pista del cliente
 * se honra sólo si la BASE confirma que ese slug es una comunidad**. Contra la
 * base y no contra un mapa hardcodeado, porque lo segundo reabriría el problema
 * que documenta `RESERVED_BRAND_SLUGS` — una comunidad nacida por
 * `scripts/new-tenant.mjs` tiene que resolver sin tocar código.
 */

/** Fetcher de mentira: devuelve los slugs que "existen" en la base. */
function fakeFetcher(existing: string[] | (() => Promise<never>)) {
  const calls: string[] = [];
  const fn: TenantSlugFetcher = async (slug) => {
    calls.push(slug);
    if (typeof existing === "function") return existing();
    return existing.includes(slug) ? [slug] : [];
  };
  return { fn, calls };
}

beforeEach(() => {
  __resetTenantSlugCache();
  // Las pistas del cliente sólo viven fuera de producción.
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ejemplo.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-de-mentira");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("lookupTenantSlug — ¿este slug es una comunidad de verdad?", () => {
  it("confirma un slug que la base conoce", async () => {
    const { fn } = fakeFetcher(["dominicanos"]);
    await expect(lookupTenantSlug("dominicanos", fn)).resolves.toBe("exists");
  });

  it("un slug que la base no conoce es `missing`, no un tenant nuevo", async () => {
    const { fn } = fakeFetcher(["dominicanos"]);
    await expect(lookupTenantSlug("ofertas", fn)).resolves.toBe("missing");
  });

  it("una comunidad recién nacida resuelve sin tocar código: alcanza con su fila", async () => {
    // El contrato de `scripts/new-tenant.mjs`. Si esto se rompiera, el fix
    // habría cambiado un bug por otro peor.
    const { fn } = fakeFetcher(["colombianos-miami"]);
    await expect(lookupTenantSlug("colombianos-miami", fn)).resolves.toBe("exists");
  });

  it("no gasta un round-trip en lo que NO PUEDE ser una comunidad", async () => {
    const { fn, calls } = fakeFetcher([]);
    // Mal formado (el alfabeto del CHECK de `tenants.slug`), vacío, y el slug
    // RESERVADO de marca: los tres se descartan sin preguntar.
    await expect(lookupTenantSlug("Fotos Y Videos", fn)).resolves.toBe("invalid");
    await expect(lookupTenantSlug("", fn)).resolves.toBe("invalid");
    await expect(lookupTenantSlug("comunidadlatina", fn)).resolves.toBe("invalid");
    expect(calls).toEqual([]);
  });

  it("la base caída es `unknown` — nunca se convierte en un veredicto", async () => {
    const { fn } = fakeFetcher(() => Promise.reject(new Error("timeout")));
    await expect(lookupTenantSlug("dominicanos", fn)).resolves.toBe("unknown");
  });

  it("cachea el sí y el no, y una ráfaga sobre un slug frío dispara UNA consulta", async () => {
    const { fn, calls } = fakeFetcher(["dominicanos"]);
    await Promise.all([
      lookupTenantSlug("dominicanos", fn),
      lookupTenantSlug("dominicanos", fn),
      lookupTenantSlug("ofertas", fn),
    ]);
    await lookupTenantSlug("dominicanos", fn);
    await lookupTenantSlug("ofertas", fn);
    expect(calls).toEqual(["dominicanos", "ofertas"]);
  });

  it("no cachea `unknown`: una base que tosió no puede quedar pegada", async () => {
    let caido = true;
    const calls: string[] = [];
    const fn: TenantSlugFetcher = async (slug) => {
      calls.push(slug);
      if (caido) throw new Error("timeout");
      return [slug];
    };
    await expect(lookupTenantSlug("dominicanos", fn)).resolves.toBe("unknown");
    caido = false;
    await expect(lookupTenantSlug("dominicanos", fn)).resolves.toBe("exists");
    expect(calls).toHaveLength(2);
  });
});

describe("decideClientHints — la regla, en una función pura", () => {
  function hints(over: Partial<Parameters<typeof decideClientHints>[0]> = {}) {
    return decideClientHints({
      tParam: null,
      tStatus: "invalid" as TenantSlugStatus,
      cookie: null,
      cookieStatus: "invalid" as TenantSlugStatus,
      ...over,
    });
  }

  it("honra el `?t=` confirmado", () => {
    expect(hints({ tParam: "dominicanos", tStatus: "exists" })).toEqual({
      tParam: "dominicanos",
      cookie: null,
      discardCookie: false,
    });
  });

  it("EL BUG: `?t=ofertas` no es una comunidad → se ignora y no toca la cookie", () => {
    expect(hints({ tParam: "ofertas", tStatus: "missing" })).toEqual({
      tParam: null,
      cookie: null,
      discardCookie: false,
    });
  });

  it("EL BUG POR CLICK: `?t=fotos` es la pestaña del perfil, no una comunidad", () => {
    expect(hints({ tParam: "fotos", tStatus: "missing" }).tParam).toBeNull();
  });

  it("un `?t=` inválido NO pisa una cookie buena: seguís en tu comunidad", () => {
    // Éste es el caso que se vive todo el día: estás en `?t=colombianos-miami`
    // (ya en cookie) y hacés click en la pestaña Fotos del perfil.
    expect(
      hints({
        tParam: "fotos",
        tStatus: "missing",
        cookie: "colombianos-miami",
        cookieStatus: "exists",
      }),
    ).toEqual({ tParam: null, cookie: "colombianos-miami", discardCookie: false });
  });

  it("una cookie que la base desconoce se descarta: auto-cura las ya envenenadas", () => {
    // Quien ya tiene `cl-tenant=ofertas` de antes del fix no debería tener que
    // borrarla a mano — es exactamente lo que hubo que hacer para desatascarse.
    expect(hints({ cookie: "ofertas", cookieStatus: "missing" })).toEqual({
      tParam: null,
      cookie: null,
      discardCookie: true,
    });
  });

  it("con la base caída no se honra la pista, pero TAMPOCO se borra la cookie", () => {
    // Un hipo de infra no puede condenar una cookie legítima: `unknown` no es
    // un veredicto, y borrar sería afirmar de más (mismo criterio que
    // `classifyTenantMatch` y que el 503 de `domain-routing`).
    expect(hints({ cookie: "colombianos-miami", cookieStatus: "unknown" })).toEqual({
      tParam: null,
      cookie: null,
      discardCookie: false,
    });
  });
});

describe("confirmClientTenantHints — el pegamento que usa el proxy", () => {
  it("en producción no honra NADA y no le pregunta a la base", async () => {
    // La decisión de seguridad de `clientTenantHintsAllowed()` manda por encima
    // de todo esto: en prod `?t=` no existe, así que consultar sería gastar un
    // round-trip en el camino crítico de cada request para nada.
    vi.stubEnv("NODE_ENV", "production");
    const { fn, calls } = fakeFetcher(["dominicanos"]);
    await expect(confirmClientTenantHints("dominicanos", "dominicanos", fn)).resolves.toEqual({
      tParam: null,
      cookie: null,
      discardCookie: false,
    });
    expect(calls).toEqual([]);
  });

  it("en dev confirma las dos pistas contra la base", async () => {
    const { fn } = fakeFetcher(["dominicanos"]);
    await expect(confirmClientTenantHints("ofertas", "dominicanos", fn)).resolves.toEqual({
      tParam: null,
      cookie: "dominicanos",
      discardCookie: false,
    });
  });
});
