import { describe, expect, it } from "vitest";
import {
  MARKETPLACE_REPORT_REASONS,
  REPORT_REASON_MAX_LENGTH,
} from "./report-reasons";

describe("motivos de reporte del Marketplace", () => {
  it("cubre las siete categorías que pide la spec", () => {
    const texto = MARKETPLACE_REPORT_REASONS.join(" | ").toLowerCase();
    expect(texto).toContain("falso");
    expect(texto).toContain("robado");
    expect(texto).toContain("estafa");
    expect(texto).toContain("fraude");
    expect(texto).toContain("engañosa");
    expect(texto).toContain("prohibido");
    expect(texto).toContain("marca"); // propiedad intelectual
  });

  it("siempre ofrece una salida para lo que no encaja", () => {
    expect(MARKETPLACE_REPORT_REASONS.at(-1)).toBe("Otra cosa");
  });

  it("ninguno supera el tope del schema de reportTargetAction", () => {
    for (const reason of MARKETPLACE_REPORT_REASONS) {
      expect(reason.length).toBeLessThanOrEqual(REPORT_REASON_MAX_LENGTH);
      expect(reason.trim()).toBe(reason);
      expect(reason.length).toBeGreaterThan(0);
    }
  });

  it("no repite motivos", () => {
    expect(new Set(MARKETPLACE_REPORT_REASONS).size).toBe(MARKETPLACE_REPORT_REASONS.length);
  });
});
