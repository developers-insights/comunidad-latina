import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  resolveTenantSlug,
  tenantHintFromSearchParams,
  DEFAULT_TENANT_SLUG,
  TENANT_COOKIE,
  TENANT_QUERY_PARAM,
} from "./resolve";

/**
 * =============================================================================
 * `?t=` NO MUEVE EL TENANT — el parámetro de pestaña y la pista de dev son dos
 * =============================================================================
 *
 * BUG QUE ANCLA (reproducido en local, 2026-08-24). El proxy leía la pista de
 * tenant de `?t=`, y `?t=` es TAMBIÉN el parámetro con el que cuatro módulos
 * —Perfil, Negocios, Profesionales y Marketplace— dicen en qué pestaña está la
 * persona. Abrir `/negocios?t=ofertas` hacía dos cosas: mostrar la pestaña
 * "ofertas" (correcto) y decirle al proxy "servime la comunidad `ofertas`"
 * (desastre). Como `resolveTenantSlug` acepta a propósito cualquier slug no
 * reservado —el contrato que permite que una comunidad nueva resuelva sin
 * deploy— el slug pasaba, `getTenant()` no encontraba fila, degradaba al
 * fallback, y a partir de ahí TODAS las pantallas se veían vacías SIN UN SOLO
 * ERROR. Y el paso 7 del proxy lo persistía en la cookie `cl-tenant` por 30
 * días, así que sacar el `?t=` de la URL no alcanzaba para volver.
 *
 * POR QUÉ SE MOVIÓ LA PISTA Y NO LAS PESTAÑAS: la pista es una ayuda de
 * desarrollo, apagada en producción y en previews por seguridad; las pestañas
 * son URLs que la gente ve, comparte y guarda, están en cuatro módulos y tienen
 * sus propios tests. Se mueve la barata.
 *
 * SI ESTE ARCHIVO SE PONE ROJO no lo "arregles" volviendo a leer `?t=` en el
 * proxy: eso reabre el bug entero.
 */

const VALORES_DE_PESTAÑA_HOY = [
  // negocios/business-tabs.ts
  "publicaciones",
  "ofertas",
  // marketplace/marketplace-tabs.ts
  "tiendas",
  // perfil/profile-tabs.ts
  "fotos",
  "videos",
  "resenas",
  "seguidores",
];

describe("la pista de tenant vive en ?cl-tenant=, no en ?t=", () => {
  it("el nombre del parámetro es el MISMO que el de la cookie", () => {
    // Las dos mitades del mecanismo se llaman igual a propósito: quien ve la
    // cookie sabe cómo pasarla por URL y al revés.
    expect(TENANT_QUERY_PARAM).toBe(TENANT_COOKIE);
    expect(TENANT_QUERY_PARAM).toBe("cl-tenant");
  });

  it("y NO es `t` — ese nombre ya estaba tomado por las pestañas", () => {
    expect(TENANT_QUERY_PARAM).not.toBe("t");
  });

  it("?t=<lo que sea> no es una pista de tenant", () => {
    for (const valor of VALORES_DE_PESTAÑA_HOY) {
      expect(tenantHintFromSearchParams(new URLSearchParams(`t=${valor}`))).toBeNull();
    }
  });

  it("?cl-tenant=<slug> sí lo es", () => {
    expect(tenantHintFromSearchParams(new URLSearchParams("cl-tenant=dominicanos"))).toBe(
      "dominicanos",
    );
  });

  it("los dos juntos no se confunden: la pestaña es pestaña y la pista es pista", () => {
    const params = new URLSearchParams("t=ofertas&cl-tenant=dominicanos");
    expect(tenantHintFromSearchParams(params)).toBe("dominicanos");
    expect(params.get("t")).toBe("ofertas");
  });
});

describe("EL BUG: abrir una pestaña no cambia de comunidad", () => {
  it("`/negocios?t=ofertas` en local deja el tenant donde estaba", () => {
    // Lo que hace el proxy hoy, en el mismo orden: leer la pista de la query
    // (que acá no existe) y resolver. El 4º argumento en true = dev/preview,
    // o sea el entorno donde las pistas SÍ se honran; es el caso peligroso.
    const params = new URLSearchParams("t=ofertas");
    const pista = tenantHintFromSearchParams(params);
    expect(resolveTenantSlug("localhost", pista, null, true)).toBe(DEFAULT_TENANT_SLUG);
  });

  it("ninguna pestaña de hoy puede secuestrar el tenant", () => {
    for (const valor of VALORES_DE_PESTAÑA_HOY) {
      const pista = tenantHintFromSearchParams(new URLSearchParams(`t=${valor}`));
      expect(resolveTenantSlug("localhost", pista, null, true)).toBe(DEFAULT_TENANT_SLUG);
    }
  });
});

/**
 * El test de arriba prueba la FUNCIÓN. Este prueba que el proxy la use: sin
 * esto, alguien podría volver a poner un `searchParams.get("t")` a mano y los
 * casos anteriores seguirían verdes mientras el bug vuelve.
 */
describe("el proxy no lee `t` a mano", () => {
  const middleware = readFileSync(
    fileURLToPath(new URL("../../middleware.ts", import.meta.url)),
    "utf8",
  );

  it("usa `tenantHintFromSearchParams` y no un get('t') suelto", () => {
    expect(middleware).toContain("tenantHintFromSearchParams(request.nextUrl.searchParams)");
    // Sin comentarios: el docblock de esta línea NOMBRA `?t=` para explicar el
    // bug, y eso no puede hacer fallar el test.
    const sinComentarios = middleware
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(sinComentarios).not.toMatch(/searchParams\.get\(\s*["']t["']\s*\)/);
  });
});
