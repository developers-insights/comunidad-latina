import { describe, expect, it } from "vitest";
import { canWriteTenant, effectiveTenantId, firstParam, isUuid } from "./scope";

/**
 * LA PRUEBA DE QUE EL SELECTOR DE COMUNIDAD NO ES UNA FUGA.
 *
 * Estas dos funciones son toda la lógica del cambio de contexto: `scope.ts` no
 * hace más que llamarlas con el rol que salió de `supabase.auth.getUser()`. Si
 * acá un `domain_admin` consigue que le devuelvan un tenant ajeno, la fuga
 * existe en producción; si no lo consigue, no hay parámetro de URL, cookie ni
 * formulario que la abra, porque no hay otra puerta.
 *
 * Todos los casos hostiles se escriben desde el punto de vista del atacante:
 * "soy domain_admin del tenant A y escribo ?comunidad=B a mano".
 */

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const TENANT_C = "33333333-3333-4333-8333-333333333333";
const KNOWN = [TENANT_A, TENANT_B, TENANT_C];

describe("effectiveTenantId · lo que puede mirar cada rol", () => {
  it("un domain_admin que pide otra comunidad sigue viendo la suya", () => {
    expect(
      effectiveTenantId({
        role: "domain_admin",
        jwtTenantId: TENANT_A,
        requested: TENANT_B,
        knownTenantIds: KNOWN,
      }),
    ).toBe(TENANT_A);
  });

  it("un moderator tampoco puede saltar de comunidad", () => {
    expect(
      effectiveTenantId({
        role: "moderator",
        jwtTenantId: TENANT_A,
        requested: TENANT_C,
        knownTenantIds: KNOWN,
      }),
    ).toBe(TENANT_A);
  });

  it("un domain_admin sin tenant en el JWT no hereda uno de la URL", () => {
    // El caso peligroso: si el fallback "primera comunidad de la lista" se
    // aplicara a cualquier rol, un token sin claim entraría a la comunidad A.
    expect(
      effectiveTenantId({
        role: "domain_admin",
        jwtTenantId: null,
        requested: TENANT_B,
        knownTenantIds: KNOWN,
      }),
    ).toBeNull();
  });

  it("un global_admin sí cambia de comunidad con el parámetro", () => {
    expect(
      effectiveTenantId({
        role: "global_admin",
        jwtTenantId: TENANT_A,
        requested: TENANT_B,
        knownTenantIds: KNOWN,
      }),
    ).toBe(TENANT_B);
  });

  it("un uuid con forma válida pero inexistente NO se usa como filtro", () => {
    // Sin este chequeo, `?comunidad=<uuid inventado>` viajaría tal cual a un
    // `.eq('tenant_id', …)`. No filtraría datos ajenos, pero convertiría la URL
    // en una sonda para descubrir qué ids existen.
    expect(
      effectiveTenantId({
        role: "global_admin",
        jwtTenantId: TENANT_A,
        requested: "99999999-9999-4999-8999-999999999999",
        knownTenantIds: KNOWN,
      }),
    ).toBe(TENANT_A);
  });

  it("basura en el parámetro cae a la comunidad propia", () => {
    for (const hostile of ["", "todas", "' or 1=1--", "../../etc/passwd", "null"]) {
      expect(
        effectiveTenantId({
          role: "global_admin",
          jwtTenantId: TENANT_A,
          requested: hostile,
          knownTenantIds: KNOWN,
        }),
      ).toBe(TENANT_A);
    }
  });

  it("un global_admin sin comunidad propia cae a la primera, no a lo que pidan", () => {
    expect(
      effectiveTenantId({
        role: "global_admin",
        jwtTenantId: null,
        requested: "99999999-9999-4999-8999-999999999999",
        knownTenantIds: KNOWN,
      }),
    ).toBe(TENANT_A);
  });

  it("sin comunidades no inventa ninguna", () => {
    expect(
      effectiveTenantId({
        role: "global_admin",
        jwtTenantId: null,
        requested: TENANT_A,
        knownTenantIds: [],
      }),
    ).toBeNull();
  });
});

describe("canWriteTenant · lo que puede TOCAR cada rol", () => {
  it("un domain_admin escribe solo en su comunidad", () => {
    expect(canWriteTenant({ role: "domain_admin", tenantId: TENANT_A }, TENANT_A)).toBe(true);
    expect(canWriteTenant({ role: "domain_admin", tenantId: TENANT_A }, TENANT_B)).toBe(false);
  });

  it("un moderator tampoco escribe fuera de su comunidad", () => {
    expect(canWriteTenant({ role: "moderator", tenantId: TENANT_A }, TENANT_B)).toBe(false);
  });

  it("un staff sin tenant en el JWT no escribe en ningún lado", () => {
    expect(canWriteTenant({ role: "domain_admin", tenantId: null }, TENANT_A)).toBe(false);
    expect(canWriteTenant({ role: "moderator", tenantId: null }, TENANT_A)).toBe(false);
  });

  it("el global_admin sí escribe en cualquiera", () => {
    expect(canWriteTenant({ role: "global_admin", tenantId: TENANT_A }, TENANT_B)).toBe(true);
    expect(canWriteTenant({ role: "global_admin", tenantId: null }, TENANT_C)).toBe(true);
  });

  it("nadie escribe sobre un destino ausente o mal formado", () => {
    // Sin el chequeo de forma, un `tenantId` vacío llegaría a un `.eq(...)`
    // vacío y el update podría alcanzar filas que nadie eligió.
    for (const target of [null, "", "todas", "11111111-1111-4111-8111"]) {
      expect(canWriteTenant({ role: "global_admin", tenantId: TENANT_A }, target)).toBe(false);
    }
  });
});

describe("helpers de URL", () => {
  it("firstParam toma el primer valor de un parámetro repetido", () => {
    // `?comunidad=A&comunidad=B` llega como arreglo: se resuelve UNO solo, y
    // siempre el mismo, para que dos capas no lean valores distintos.
    expect(firstParam([TENANT_A, TENANT_B])).toBe(TENANT_A);
    expect(firstParam(TENANT_A)).toBe(TENANT_A);
    expect(firstParam(undefined)).toBeNull();
    expect(firstParam("")).toBeNull();
  });

  it("isUuid rechaza todo lo que no tenga forma de uuid", () => {
    expect(isUuid(TENANT_A)).toBe(true);
    expect(isUuid("no-soy-un-uuid")).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});
