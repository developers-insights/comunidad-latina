import { describe, expect, it } from "vitest";
import {
  classifyTenantMatch,
  tenantMismatchBanner,
  tenantMismatchMessage,
  type TenantMatchInput,
} from "./match";

const HOME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
/** Los ids de DEFAULT_TENANTS en resolve.ts: nunca vienen de la DB. */
const PLACEHOLDER = "00000000-0000-4000-8000-000000000001";

function input(overrides: Partial<TenantMatchInput> = {}): TenantMatchInput {
  return {
    requestTenantId: HOME,
    requestTenantIsFallback: false,
    jwtTenantId: HOME,
    isAuthenticated: true,
    ...overrides,
  };
}

describe("classifyTenantMatch", () => {
  it("coincide cuando el JWT y el header apuntan al mismo tenant", () => {
    expect(classifyTenantMatch(input())).toBe("match");
  });

  it("es 'anonymous' sin sesión, aunque el header traiga cualquier tenant", () => {
    expect(
      classifyTenantMatch(input({ isAuthenticated: false, jwtTenantId: null })),
    ).toBe("anonymous");
    // Un token viejo sin sesión activa tampoco cuenta como usuario.
    expect(
      classifyTenantMatch(input({ isAuthenticated: false, jwtTenantId: OTHER })),
    ).toBe("anonymous");
  });

  it("detecta la divergencia: usuario de una comunidad navegando otra", () => {
    expect(classifyTenantMatch(input({ jwtTenantId: OTHER }))).toBe("tenant-mismatch");
  });

  it("trata una sesión SIN claim de tenant como divergencia", () => {
    // app.current_tenant_id() devuelve NULL → todo `with check` da false.
    expect(classifyTenantMatch(input({ jwtTenantId: null }))).toBe("tenant-mismatch");
  });

  // ---- La trampa del fallback -------------------------------------------
  // getTenant() degrada a un id PLACEHOLDER cuando la DB no responde o el slug
  // no existe. Compararlo contra el JWT convertiría un hipo de infra en
  // "estás en la comunidad equivocada", que es mentira.

  it("NO acusa divergencia cuando el tenant del request es un fallback", () => {
    expect(
      classifyTenantMatch({
        requestTenantId: PLACEHOLDER,
        requestTenantIsFallback: true,
        jwtTenantId: HOME,
        isAuthenticated: true,
      }),
    ).toBe("tenant-unavailable");
  });

  it("tampoco declara 'match' sobre un fallback aunque los ids coincidan", () => {
    expect(
      classifyTenantMatch({
        requestTenantId: PLACEHOLDER,
        requestTenantIsFallback: true,
        jwtTenantId: PLACEHOLDER,
        isAuthenticated: true,
      }),
    ).toBe("tenant-unavailable");
  });

  it("el anónimo gana sobre el fallback: no hay nada que comparar", () => {
    expect(
      classifyTenantMatch({
        requestTenantId: PLACEHOLDER,
        requestTenantIsFallback: true,
        jwtTenantId: null,
        isAuthenticated: false,
      }),
    ).toBe("anonymous");
  });

  it("distingue ids que solo difieren en un carácter", () => {
    const almost = `${HOME.slice(0, -1)}2`;
    expect(classifyTenantMatch(input({ jwtTenantId: almost }))).toBe("tenant-mismatch");
  });
});

describe("tenantMismatchMessage", () => {
  it("nombra ambas comunidades cuando conoce la del usuario", () => {
    const message = tenantMismatchMessage("Dominicanos", "Comunidad Latina");
    expect(message).toContain("Dominicanos");
    expect(message).toContain("Comunidad Latina");
    // Deja claro que leer sigue permitido: el guard no bloquea navegación.
    expect(message).toContain("Podés leer todo acá");
  });

  it("no inventa un nombre cuando no pudo resolver la comunidad del usuario", () => {
    const message = tenantMismatchMessage("Dominicanos", null);
    expect(message).toContain("otra comunidad");
    expect(message).not.toContain("null");
    expect(message).not.toContain("undefined");
  });

  it("no filtra jerga técnica al usuario", () => {
    for (const message of [
      tenantMismatchMessage("Dominicanos", "Comunidad Latina"),
      tenantMismatchMessage("Dominicanos", null),
    ]) {
      expect(message).not.toMatch(/RLS|JWT|tenant|policy|header|uuid/i);
    }
  });
});

describe("tenantMismatchBanner", () => {
  it("ofrece la vuelta nombrando la comunidad del usuario", () => {
    const copy = tenantMismatchBanner("Dominicanos", "Comunidad Latina");
    expect(copy.title).toContain("Comunidad Latina");
    expect(copy.action).toBe("Volver a Comunidad Latina");
  });

  it("degrada el CTA sin inventar un nombre", () => {
    const copy = tenantMismatchBanner("Dominicanos", null);
    expect(copy.action).toBe("Volver a mi comunidad");
    expect(copy.title).toContain("otra comunidad");
  });

  it("el cuerpo aclara que la lectura sigue abierta (cross-tenant por SEO)", () => {
    const copy = tenantMismatchBanner("Dominicanos", "Comunidad Latina");
    expect(copy.body).toContain("Podés leer todo lo que quieras acá");
  });
});
