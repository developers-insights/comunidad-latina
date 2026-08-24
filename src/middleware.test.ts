import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

/**
 * EL SÍNTOMA, ANCLADO DE PUNTA A PUNTA (bug reproducido en vivo el 2026-08-24).
 *
 * Navegar a `http://localhost:3000/negocios?t=ofertas` dejaba la cookie
 * `cl-tenant=ofertas` por 30 días. A partir de ahí TODA la app resolvía a una
 * comunidad inexistente y las secciones se veían vacías **sin ningún error
 * visible**; la única salida era borrar la cookie a mano.
 *
 * La causa era una colisión de significados: `?t=` es la pista de comunidad del
 * proxy Y el parámetro de pestaña del perfil (`profileTabHref` → `?t=fotos`).
 * Los tests de `lib/tenant/slug-lookup.test.ts` custodian la regla; éstos
 * custodian que el proxy —donde se juntan las tres piezas— la aplique de verdad.
 */

/** Slugs que "existen" en la base de mentira. */
const COMUNIDADES = ["dominicanos", "colombianos-miami"];

/** El slug que el proxy inyectó para este request, capturado por el mock. */
let slugServido: string | null = null;

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: async (request: NextRequest) => {
    slugServido = request.headers.get("x-tenant-slug");
    return NextResponse.next({ request });
  },
}));

const { middleware } = await import("./middleware");
const { TENANT_COOKIE } = await import("@/lib/tenant/resolve");
const { __resetTenantSlugCache } = await import("@/lib/tenant/slug-lookup");
const { __resetTenantDomainCache } = await import("@/lib/tenant/domain-lookup");

/**
 * Red de mentira. `tenants?slug=eq.X` contesta según COMUNIDADES; el RPC de
 * dominios contesta "no hay fila", que es lo correcto para localhost.
 */
function stubRed(): void {
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = String(typeof input === "object" && "url" in input ? input.url : input);
    if (url.includes("/rest/v1/tenants")) {
      const pedido = decodeURIComponent(url.match(/slug=eq\.([^&]+)/)?.[1] ?? "");
      const filas = COMUNIDADES.includes(pedido) ? [{ slug: pedido }] : [];
      return new Response(JSON.stringify(filas), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  });
}

/** Un GET a localhost, con `?t=` y/o cookie, como lo hace el navegador en dev. */
async function pedir(path: string, cookie?: string) {
  const { NextRequest } = await import("next/server");
  const request = new NextRequest(new URL(`http://localhost:3000${path}`), {
    headers: { host: "localhost:3000" },
  });
  if (cookie) request.cookies.set(TENANT_COOKIE, cookie);
  const response = await middleware(request);
  return { response, slug: slugServido, cookie: response.cookies.get(TENANT_COOKIE) };
}

beforeEach(() => {
  slugServido = null;
  __resetTenantSlugCache();
  __resetTenantDomainCache();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ejemplo.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-de-mentira");
  stubRed();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("proxy: `?t=` que NO es una comunidad", () => {
  it("EL BUG: `/negocios?t=ofertas` no cambia de comunidad ni escribe cookie", async () => {
    const { slug, cookie } = await pedir("/negocios?t=ofertas");
    expect(slug).toBe("dominicanos");
    expect(cookie).toBeUndefined();
  });

  it("`/perfil?t=fotos` tampoco: es la pestaña del perfil, un click normal", async () => {
    // El caso que hace al bug alcanzable sin escribir la URL a mano.
    const { slug, cookie } = await pedir("/perfil?t=fotos");
    expect(slug).toBe("dominicanos");
    expect(cookie).toBeUndefined();
  });

  it("una pestaña NO te saca de la comunidad en la que estabas", async () => {
    const { slug, cookie } = await pedir("/perfil?t=seguidores", "colombianos-miami");
    expect(slug).toBe("colombianos-miami");
    // Ni la pisa ni la borra: la cookie buena sigue como estaba.
    expect(cookie).toBeUndefined();
  });
});

describe("proxy: lo que TIENE que seguir andando", () => {
  it("`?t=<comunidad real>` resuelve y se persiste, como siempre", async () => {
    const { slug, cookie } = await pedir("/negocios?t=colombianos-miami");
    expect(slug).toBe("colombianos-miami");
    expect(cookie?.value).toBe("colombianos-miami");
    expect(cookie?.maxAge).toBe(60 * 60 * 24 * 30);
  });

  it("la cookie sola sigue mandando cuando no hay `?t=`", async () => {
    const { slug } = await pedir("/negocios", "colombianos-miami");
    expect(slug).toBe("colombianos-miami");
  });
});

describe("proxy: auto-cura de las cookies ya envenenadas", () => {
  it("`cl-tenant=ofertas` de antes del fix se borra sola", async () => {
    const { slug, cookie } = await pedir("/negocios", "ofertas");
    expect(slug).toBe("dominicanos");
    expect(cookie?.value).toBe("");
    expect(cookie?.maxAge).toBe(0);
  });

  it("un `?t=` bueno reemplaza a la cookie envenenada de una", async () => {
    const { slug, cookie } = await pedir("/negocios?t=colombianos-miami", "ofertas");
    expect(slug).toBe("colombianos-miami");
    expect(cookie?.value).toBe("colombianos-miami");
  });
});
