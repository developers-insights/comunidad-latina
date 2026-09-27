import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getRedirectUrl } from "next/experimental/testing/server";

const auth = vi.hoisted(() => ({
  claims: null as null | { sub: string },
  refreshedCookie: null as null | { name: string; value: string },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies: {
        setAll: (c: { name: string; value: string; options: object }[]) => void;
      };
    },
  ) => ({
    auth: {
      async getClaims() {
        if (auth.refreshedCookie) {
          options.cookies.setAll([{ ...auth.refreshedCookie, options: { path: "/" } }]);
        }
        return { data: auth.claims ? { claims: auth.claims } : null, error: null };
      },
    },
  }),
}));

vi.mock("@/lib/tenant/domain-lookup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tenant/domain-lookup")>()),
  lookupTenantDomain: async () => ({ kind: "unavailable" }),
}));

vi.mock("@/lib/tenant/domain-routing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tenant/domain-routing")>()),
  decideTenantRouting: () => ({ kind: "serve", slug: "dominicanos", source: "database" }),
}));

vi.mock("@/lib/tenant/slug-lookup", () => ({
  lookupTenantSlug: async () => "known",
}));

import { middleware } from "./middleware";

function get(path: string) {
  return new NextRequest(`https://www.comunidadlatina.com${path}`);
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proyecto.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  auth.claims = null;
  auth.refreshedCookie = null;
});

describe("middleware — la home pública", () => {
  it("un visitante anónimo en / ve la landing, sin redirección", async () => {
    const response = await middleware(get("/"));

    expect(getRedirectUrl(response)).toBeNull();
    expect(response.headers.get("location")).toBeNull();
  });

  it("una persona con sesión en / va directo al feed", async () => {
    auth.claims = { sub: "user-1" };

    const response = await middleware(get("/"));

    expect(response.status).toBe(307);
    expect(new URL(getRedirectUrl(response)!).pathname).toBe("/feed");
  });

  it("la redirección al feed conserva la sesión refrescada", async () => {
    auth.claims = { sub: "user-1" };
    auth.refreshedCookie = { name: "sb-proyecto-auth-token", value: "renovado" };

    const response = await middleware(get("/"));

    expect(response.cookies.get("sb-proyecto-auth-token")?.value).toBe("renovado");
  });

  it("con sesión, el resto de las páginas públicas no se redirigen", async () => {
    auth.claims = { sub: "user-1" };

    for (const path of ["/guias", "/legal/sms", "/legal/terminos"]) {
      const response = await middleware(get(path));
      expect(getRedirectUrl(response), path).toBeNull();
    }
  });

  it("las páginas legales son públicas para un anónimo", async () => {
    for (const path of ["/legal/sms", "/legal/privacidad", "/legal/terminos"]) {
      const response = await middleware(get(path));
      expect(getRedirectUrl(response), path).toBeNull();
    }
  });
});
