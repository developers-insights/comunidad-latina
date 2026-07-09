import { describe, it, expect } from "vitest";
import {
  resolveTenantSlug,
  isActiveCommunitySlug,
  DEFAULT_TENANT_SLUG,
} from "./resolve";

/**
 * Lock single-community (2026-07-09): por ahora la ÚNICA comunidad pública es
 * `dominicanos`. `comunidadlatina` es la marca/admin, no una comunidad — el
 * usuario final nunca debe aterrizar ahí. Cualquier candidato no-activo
 * (dominio de marca, `?t=`, cookie vieja) cae a la comunidad por defecto.
 */
describe("resolveTenantSlug — lock single-community (solo dominicanos por ahora)", () => {
  it("el dominio real de la comunidad activa resuelve a esa comunidad", () => {
    expect(resolveTenantSlug("dominicanos.com", null, null)).toBe("dominicanos");
    expect(resolveTenantSlug("www.dominicanos.com", null, null)).toBe("dominicanos");
  });

  it("?t=comunidadlatina NO cruza: cae a dominicanos", () => {
    expect(
      resolveTenantSlug("comunidad-latina.vercel.app", "comunidadlatina", null),
    ).toBe("dominicanos");
  });

  it("una cookie cl-tenant=comunidadlatina vieja NO cruza: cae a dominicanos", () => {
    expect(
      resolveTenantSlug("comunidad-latina.vercel.app", null, "comunidadlatina"),
    ).toBe("dominicanos");
  });

  it("el dominio de la MARCA comunidadlatina.com cae a dominicanos (por ahora)", () => {
    expect(resolveTenantSlug("comunidadlatina.com", null, null)).toBe("dominicanos");
    expect(resolveTenantSlug("www.comunidadlatina.com", null, null)).toBe("dominicanos");
  });

  it("sin host/param/cookie → comunidad por defecto", () => {
    expect(resolveTenantSlug(null, null, null)).toBe(DEFAULT_TENANT_SLUG);
    expect(DEFAULT_TENANT_SLUG).toBe("dominicanos");
  });

  it("?t=dominicanos (comunidad activa) sí se respeta", () => {
    expect(
      resolveTenantSlug("comunidad-latina.vercel.app", "dominicanos", null),
    ).toBe("dominicanos");
  });

  it("un slug inexistente/basura cae a la comunidad por defecto", () => {
    expect(resolveTenantSlug("comunidad-latina.vercel.app", "no-existe", null)).toBe(
      "dominicanos",
    );
  });

  it("isActiveCommunitySlug distingue comunidad activa de la marca", () => {
    expect(isActiveCommunitySlug("dominicanos")).toBe(true);
    expect(isActiveCommunitySlug("comunidadlatina")).toBe(false);
    expect(isActiveCommunitySlug(null)).toBe(false);
    expect(isActiveCommunitySlug(undefined)).toBe(false);
  });
});
