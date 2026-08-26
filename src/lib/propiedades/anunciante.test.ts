import { describe, expect, it } from "vitest";
import {
  ADVERTISER_ROLES,
  ADVERTISER_ROLE_ATTR,
  ADVERTISER_ROLE_LABEL,
  ADVERTISER_ROLE_OPTIONS,
  advertiserRoleLabel,
  aggregateAdvertisers,
  isAdvertiserRole,
  parseAdvertiserRole,
  type AdvertiserListingRow,
} from "./anunciante";

/**
 * Estos tests cuidan, en orden de importancia:
 *
 *  1. Que un valor ausente o inventado en `attrs` NUNCA se lea como un rol
 *     default — es "no lo declaró", nunca "Propietario/a".
 *  2. Que `aggregateAdvertisers` tome el rol y la zona del aviso MÁS RECIENTE
 *     de cada persona, y no de cualquier otro de sus avisos.
 *  3. Que nada de esto lance, con nada.
 */

describe("claves y catálogo", () => {
  it("la clave de attrs no cambia de nombre", () => {
    expect(ADVERTISER_ROLE_ATTR).toBe("advertiser_role");
  });

  it("cuatro roles, en el orden del owner primero", () => {
    expect([...ADVERTISER_ROLES]).toEqual(["owner", "agent", "company", "representative"]);
  });

  it("cada opción tiene label y hint no vacíos, y no hay valores repetidos", () => {
    expect(ADVERTISER_ROLE_OPTIONS).toHaveLength(4);
    const values = ADVERTISER_ROLE_OPTIONS.map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
    for (const option of ADVERTISER_ROLE_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(2);
      expect(option.hint.length).toBeGreaterThan(5);
      expect(ADVERTISER_ROLE_LABEL[option.value]).toBe(option.label);
    }
  });
});

describe("isAdvertiserRole", () => {
  it("reconoce los cuatro roles válidos", () => {
    for (const role of ADVERTISER_ROLES) {
      expect(isAdvertiserRole(role)).toBe(true);
    }
  });

  it("rechaza cualquier otra cosa", () => {
    expect(isAdvertiserRole("owner ")).toBe(false); // sin trim: es el guard estricto
    expect(isAdvertiserRole("dueño")).toBe(false);
    expect(isAdvertiserRole("")).toBe(false);
    expect(isAdvertiserRole(null)).toBe(false);
    expect(isAdvertiserRole(undefined)).toBe(false);
    expect(isAdvertiserRole(42)).toBe(false);
  });
});

describe("parseAdvertiserRole", () => {
  it("acepta los cuatro valores tal cual", () => {
    expect(parseAdvertiserRole("owner")).toBe("owner");
    expect(parseAdvertiserRole("agent")).toBe("agent");
    expect(parseAdvertiserRole("company")).toBe("company");
    expect(parseAdvertiserRole("representative")).toBe("representative");
  });

  it("es insensible a mayúsculas y a espacios sobrantes", () => {
    expect(parseAdvertiserRole("  OWNER  ")).toBe("owner");
    expect(parseAdvertiserRole("Agent")).toBe("agent");
  });

  it("un valor ausente, vacío o inventado da null — nunca un default", () => {
    expect(parseAdvertiserRole(undefined)).toBeNull();
    expect(parseAdvertiserRole(null)).toBeNull();
    expect(parseAdvertiserRole("")).toBeNull();
    expect(parseAdvertiserRole("dueño")).toBeNull();
    expect(parseAdvertiserRole("<script>")).toBeNull();
  });

  it("nunca lanza con tipos que no son string", () => {
    expect(parseAdvertiserRole(123)).toBeNull();
    expect(parseAdvertiserRole(true)).toBeNull();
    expect(parseAdvertiserRole({})).toBeNull();
    expect(parseAdvertiserRole(["owner"])).toBeNull();
  });
});

describe("advertiserRoleLabel", () => {
  it("devuelve la etiqueta humana de un rol válido", () => {
    expect(advertiserRoleLabel("agent")).toBe("Agente inmobiliario/a");
    expect(advertiserRoleLabel("company")).toBe("Administradora");
  });

  it("null ante cualquier valor no reconocido — nunca inventa una etiqueta", () => {
    expect(advertiserRoleLabel(undefined)).toBeNull();
    expect(advertiserRoleLabel("broker")).toBeNull();
  });
});

describe("aggregateAdvertisers", () => {
  function row(overrides: Partial<AdvertiserListingRow>): AdvertiserListingRow {
    return {
      createdBy: "user-1",
      createdAt: "2026-08-01T00:00:00Z",
      areaLabel: "Corona",
      attrs: {},
      ...overrides,
    };
  }

  it("sin filas, no hay anunciantes", () => {
    expect(aggregateAdvertisers([])).toEqual([]);
  });

  it("una fila produce un anunciante con activeListingCount 1", () => {
    const result = aggregateAdvertisers([
      row({ createdBy: "user-1", attrs: { advertiser_role: "owner" } }),
    ]);
    expect(result).toEqual([
      { profileId: "user-1", role: "owner", areaLabel: "Corona", activeListingCount: 1 },
    ]);
  });

  it("agrupa varias filas del mismo publicador y cuenta sus avisos", () => {
    const result = aggregateAdvertisers([
      row({ createdBy: "user-1" }),
      row({ createdBy: "user-1" }),
      row({ createdBy: "user-1" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].activeListingCount).toBe(3);
  });

  it("el rol y la zona son los del aviso MÁS RECIENTE (la primera fila de esa persona), no de uno más viejo", () => {
    const result = aggregateAdvertisers([
      // Más reciente primero — mismo orden que produce la query real.
      row({ createdBy: "user-1", areaLabel: "Passaic", attrs: {} }), // no declaró rol en ESTE aviso
      row({ createdBy: "user-1", areaLabel: "Corona", attrs: { advertiser_role: "agent" } }),
    ]);
    expect(result).toHaveLength(1);
    // Gana la fila más reciente: sin rol y con zona "Passaic", aunque un aviso
    // más viejo de la misma persona sí lo hubiera declarado.
    expect(result[0].role).toBeNull();
    expect(result[0].areaLabel).toBe("Passaic");
  });

  it("attrs null, no-objeto o array no revienta — el rol sale null", () => {
    expect(() =>
      aggregateAdvertisers([
        row({ createdBy: "a", attrs: null }),
        row({ createdBy: "b", attrs: "owner" }),
        row({ createdBy: "c", attrs: ["owner"] }),
        row({ createdBy: "d", attrs: 42 }),
      ]),
    ).not.toThrow();

    const result = aggregateAdvertisers([
      row({ createdBy: "a", attrs: null }),
      row({ createdBy: "b", attrs: "owner" }),
    ]);
    expect(result.every((advertiser) => advertiser.role === null)).toBe(true);
  });

  it("preserva el orden de aparición: quien publicó más recientemente encabeza la lista", () => {
    const result = aggregateAdvertisers([
      row({ createdBy: "reciente" }),
      row({ createdBy: "viejo" }),
      row({ createdBy: "reciente" }), // segundo aviso de la misma persona: no mueve su posición
    ]);
    expect(result.map((advertiser) => advertiser.profileId)).toEqual(["reciente", "viejo"]);
  });

  it("un rol inventado en attrs (payload armado a mano) sale como null, no como texto crudo", () => {
    const result = aggregateAdvertisers([
      row({ createdBy: "user-1", attrs: { advertiser_role: "broker-supremo" } }),
    ]);
    expect(result[0].role).toBeNull();
  });
});
