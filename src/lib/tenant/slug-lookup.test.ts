import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetTenantSlugCache, lookupTenantSlug } from "./slug-lookup";
import { unknownTenantHintPage } from "./domain-routing";

/**
 * La verificación de la pista de dev: existe SÓLO para que un slug inventado
 * deje de dejar la app muda. Ver el encabezado de `./slug-lookup` para el bug.
 *
 * Lo único que de verdad puede estar mal acá es confundir "la base dijo que no
 * existe" con "no pude preguntar". El primero corta la navegación con una
 * página de error; el segundo TIENE que seguir de largo, porque estrenar un
 * error durante una caída de base sería mentir sobre la causa.
 */
describe("lookupTenantSlug", () => {
  beforeEach(() => {
    __resetTenantSlugCache();
  });

  it("la base contestó y hay fila → known", async () => {
    await expect(lookupTenantSlug("dominicanos", async () => true)).resolves.toBe("known");
  });

  it("la base contestó y NO hay fila → unknown", async () => {
    await expect(lookupTenantSlug("ofertas", async () => false)).resolves.toBe("unknown");
  });

  it("la base no contestó → unavailable, NUNCA unknown", async () => {
    const roto = async () => {
      throw new Error("timeout");
    };
    await expect(lookupTenantSlug("dominicanos", roto)).resolves.toBe("unavailable");
  });

  it("un slug vacío no gasta un round-trip", async () => {
    const fetcher = vi.fn(async () => true);
    await expect(lookupTenantSlug("", fetcher)).resolves.toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("cachea la respuesta: dos preguntas seguidas, un solo round-trip", async () => {
    const fetcher = vi.fn(async () => true);
    await lookupTenantSlug("dominicanos", fetcher);
    await lookupTenantSlug("dominicanos", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("una falla NO se cachea: el próximo request reintenta", async () => {
    const roto = vi.fn(async () => {
      throw new Error("timeout");
    });
    await lookupTenantSlug("dominicanos", roto);
    await lookupTenantSlug("dominicanos", roto);
    expect(roto).toHaveBeenCalledTimes(2);
  });

  it("una ráfaga sobre el mismo slug dispara UN solo round-trip", async () => {
    let resolver: ((value: boolean) => void) | null = null;
    const fetcher = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolver = resolve;
        }),
    );
    const rafaga = Promise.all([
      lookupTenantSlug("dominicanos", fetcher),
      lookupTenantSlug("dominicanos", fetcher),
      lookupTenantSlug("dominicanos", fetcher),
    ]);
    resolver!(true);
    await expect(rafaga).resolves.toEqual(["known", "known", "known"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("unknownTenantHintPage", () => {
  it("nombra el slug culpable y el parámetro correcto", () => {
    const pagina = unknownTenantHintPage("ofertas");
    expect(pagina.status).toBe(404);
    expect(pagina.html).toContain("ofertas");
    expect(pagina.html).toContain("cl-tenant");
  });

  it("no se cachea ni se indexa", () => {
    const pagina = unknownTenantHintPage("ofertas");
    expect(pagina.headers["cache-control"]).toBe("no-store");
    expect(pagina.headers["x-robots-tag"]).toContain("noindex");
  });

  it("escapa lo que interpola — nunca un XSS aunque el saneo de arriba se afloje", () => {
    const pagina = unknownTenantHintPage('"><script>alert(1)</script>');
    expect(pagina.html).not.toContain("<script>alert(1)</script>");
    expect(pagina.html).toContain("&lt;script&gt;");
  });
});
