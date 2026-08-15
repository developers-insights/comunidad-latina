import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetTenantDomainCache, type TenantDomainRow } from "@/lib/tenant/domain-lookup";
import robots from "./robots";

/**
 * =============================================================================
 * QUIÉN DECIDE SI UNA COMUNIDAD ENTRA A GOOGLE
 * =============================================================================
 *
 * Este archivo existe por un defecto que no se ve hasta semanas después de
 * cometerlo (auditoría 2026-08-13).
 *
 * El panel admin da de alta dominios en la tabla `tenant_domains`. El proxy los
 * lee de ahí desde la migración 0060, así que el dominio nuevo SE SIRVE
 * perfecto: la comunidad abre, la marca es la que corresponde, todo bien. Pero
 * `robots.txt` decidía contra `INDEXABLE_HOSTS`, cuatro hosts escritos a mano
 * en el propio archivo — y un host que no estaba ahí recibía `Disallow: /`. O
 * sea: la comunidad entera fuera del índice, sin ningún síntoma visible, hasta
 * que alguien pregunta por qué no aparece en Google.
 *
 * Lo que estos tests anclan es la asimetría, que es la parte fácil de romper al
 * "mejorar" esto: la base sólo puede SUMAR hosts indexables. Ninguna respuesta
 * de la base —ni un error, ni un timeout, ni una fila que no está— puede
 * convertir un `Disallow: /` en un `Allow: /`. Un robots.txt permisivo de más
 * indexa un preview que le compite al dominio real, y eso no se deshace
 * pidiéndolo.
 */

/** Fila como la devuelve `public.resolve_tenant_domain(text)` (0060). */
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

/**
 * `robots()` llama a `lookupTenantDomain` sin fetcher, así que acá se stubea el
 * transporte de verdad (PostgREST por `fetch`) en vez de inyectar un doble.
 * Es a propósito: lo que puede romperse es el CABLEADO —que robots consulte de
 * verdad y lea bien cada estado—, no la aritmética del caché, que ya tiene sus
 * propios tests en `lib/tenant/domain-lookup.test.ts`.
 */
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
  __resetTenantDomainCache();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proyecto.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-de-mentira");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** ¿El robots.txt resultante deja crawlear? */
function permite(result: Awaited<ReturnType<typeof robots>>): boolean {
  const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
  return rules.some((rule) => Boolean(rule.allow));
}

describe("robots.txt — qué se indexa", () => {
  it("un dominio que SOLO existe en tenant_domains ya se indexa", async () => {
    // El caso entero del arreglo: `colombianosmiami.com` no está en ningún mapa
    // hardcodeado del repo. Se dio de alta desde el panel. Antes: Disallow.
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://colombianosmiami.com");
    stubDb(() => ok([row("colombianosmiami.com")]));

    const result = await robots();

    expect(permite(result)).toBe(true);
    expect(result.sitemap).toBe("https://colombianosmiami.com/sitemap.xml");
  });

  it("sigue tapando lo privado, no sólo abriendo la puerta", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://colombianosmiami.com");
    stubDb(() => ok([row("colombianosmiami.com")]));

    const rules = (await robots()).rules;
    const disallow = (Array.isArray(rules) ? rules[0] : rules).disallow;

    expect(disallow).toContain("/admin");
    expect(disallow).toContain("/mensajes");
    expect(disallow).toContain("/perfil");
  });

  it("la base contesta que el host no sirve nada → NO se indexa", async () => {
    // `unknown` cubre cuatro casos indistinguibles a propósito (0060): no
    // registrado, suspendido, archivado y tenant pausado. Un dominio que el
    // cliente suspendió no puede seguir invitando a Googlebot.
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://dominio-suspendido.com");
    stubDb(() => ok([]));

    expect(permite(await robots())).toBe(false);
  });

  it("un preview de Vercel NO se indexa, y ni siquiera consulta la base", async () => {
    // `*.vercel.app` es efímero: cada deploy estrena hostname y ninguno va a ser
    // jamás el dominio de un tenant. Indexarlo sería contenido duplicado
    // compitiéndole al dominio real — el motivo original del fail-closed.
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://comunidad-latina-sigma.vercel.app");
    const fetchMock = stubDb(() => ok([row("comunidad-latina-sigma.vercel.app")]));

    expect(permite(await robots())).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("localhost tampoco", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    stubDb(() => ok([]));

    expect(permite(await robots())).toBe(false);
  });
});

describe("robots.txt — la base caída no puede abrir la puerta (fail-closed)", () => {
  it("con la base caída, un dominio de producción se sostiene por el respaldo", async () => {
    // `dominicanos.com` está en `DOMAIN_TENANTS`, el mapa hardcodeado que quedó
    // como respaldo. Es el MISMO respaldo que usa el proxy en
    // `decideTenantRouting`, no una segunda lista.
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://dominicanos.com");
    stubDb(() => Promise.reject(new Error("base caída")));

    expect(permite(await robots())).toBe(true);
  });

  it("con la base caída, un dominio que NO está en el respaldo se queda afuera", async () => {
    // Acá está la decisión que vale el archivo: el dominio existe y se sirve
    // bien, pero mientras no podamos confirmarlo no se indexa. Perder unas
    // horas de crawl es reversible; indexar de más, no.
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://colombianosmiami.com");
    stubDb(() => Promise.reject(new Error("base caída")));

    expect(permite(await robots())).toBe(false);
  });

  it("un 5xx de PostgREST tampoco alcanza para indexar", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://colombianosmiami.com");
    stubDb(() => new Response("boom", { status: 503 }));

    expect(permite(await robots())).toBe(false);
  });

  it("NEXT_PUBLIC_SITE_URL mal formada → no indexar", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "no-es-una-url");
    stubDb(() => ok([]));

    expect(permite(await robots())).toBe(false);
  });
});
