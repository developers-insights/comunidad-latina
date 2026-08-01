import { describe, expect, it } from "vitest";
import { deltaPercent, isEmptyOverview } from "./queries";
import { metricsOverviewSchema, isMetricsRange, type MetricsOverview } from "./types";

function overview(partial?: Partial<MetricsOverview["totals"]>): MetricsOverview {
  return {
    tenant_id: "019f39cf-5115-70bf-8a9e-8db074bf07d6",
    days: 30,
    from: "2026-07-03",
    to: "2026-08-01",
    generated_at: "2026-08-01T17:52:22.888Z",
    totals: {
      active: 0,
      publishers: 0,
      contacters: 0,
      publications: 0,
      contacts: 0,
      accepted_contacts: 0,
      new_members: 0,
      ...partial,
    },
    previous: { active: 0, publishers: 0, contacters: 0, new_members: 0 },
    series: [],
  };
}

describe("deltaPercent", () => {
  it("calcula la variación contra el período anterior", () => {
    expect(deltaPercent(12, 10)).toBe(20);
    expect(deltaPercent(8, 10)).toBe(-20);
    expect(deltaPercent(10, 10)).toBe(0);
  });

  it("devuelve null cuando el período anterior fue cero", () => {
    // Crecer desde cero no es "+∞ %": es que no hay con qué comparar. La
    // tarjeta tiene que decir eso y no inventar un porcentaje.
    expect(deltaPercent(5, 0)).toBeNull();
    expect(deltaPercent(0, 0)).toBeNull();
  });
});

describe("isEmptyOverview", () => {
  it("una comunidad sin nada es vacía", () => {
    expect(isEmptyOverview(overview())).toBe(true);
  });

  it("con UNA sola señal ya no es vacía", () => {
    // Cada una de estas por sí sola justifica mostrar el tablero con ceros en
    // el resto: el cero es un dato, no la ausencia de datos.
    expect(isEmptyOverview(overview({ active: 1 }))).toBe(false);
    expect(isEmptyOverview(overview({ new_members: 1 }))).toBe(false);
    expect(isEmptyOverview(overview({ publications: 1 }))).toBe(false);
  });

  it("contactos aceptados sin nada más NO alcanza para considerarla activa", () => {
    // accepted_contacts mira el estado de HOY de contactos del período; sin
    // contactos abiertos en la ventana no puede haber aceptados propios de la
    // ventana, así que no se lo usa como señal de vida.
    expect(isEmptyOverview(overview({ accepted_contacts: 3 }))).toBe(true);
  });
});

describe("isMetricsRange", () => {
  it("solo acepta las tres ventanas que la RPC admite", () => {
    expect(isMetricsRange(7)).toBe(true);
    expect(isMetricsRange(30)).toBe(true);
    expect(isMetricsRange(90)).toBe(true);
    expect(isMetricsRange(365)).toBe(false);
    expect(isMetricsRange(0)).toBe(false);
    expect(isMetricsRange(Number.NaN)).toBe(false);
  });
});

describe("metricsOverviewSchema", () => {
  it("acepta el payload real de la RPC", () => {
    expect(metricsOverviewSchema.safeParse(overview({ active: 12 })).success).toBe(true);
  });

  it("rechaza un payload al que le falta una métrica", () => {
    // El punto del schema: si el SQL cambia y deja de mandar `contacters`, esto
    // tiene que romper acá y no pintar "undefined" en una tarjeta.
    const roto = overview() as unknown as Record<string, Record<string, number>>;
    delete roto.totals!.contacters;
    expect(metricsOverviewSchema.safeParse(roto).success).toBe(false);
  });

  it("rechaza conteos negativos", () => {
    expect(metricsOverviewSchema.safeParse(overview({ active: -1 })).success).toBe(false);
  });
});
