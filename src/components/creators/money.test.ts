import { describe, expect, it } from "vitest";
import { contractBreakdown, dollarsToCents, formatCents } from "./money";

describe("formatCents", () => {
  it("omite centavos en montos enteros", () => {
    expect(formatCents(100_000)).toBe("$1,000");
    expect(formatCents(20_000)).toBe("$200");
    expect(formatCents(0)).toBe("$0");
  });

  it("muestra centavos cuando el monto no es redondo", () => {
    expect(formatCents(6_667)).toBe("$66.67");
    expect(formatCents(150_50)).toBe("$150.50");
  });

  it("acepta el código de moneda en minúscula (contract.currency = 'usd')", () => {
    expect(formatCents(100_000, "usd")).toBe("$1,000");
  });
});

describe("contractBreakdown — usa los valores GENERADOS por la DB", () => {
  it("reproduce el ejemplo del cliente: $1000 → $200 fee + $800 creador", () => {
    const b = contractBreakdown({
      amountCents: 100_000,
      platformFeeCents: 20_000,
      creatorNetCents: 80_000,
      feePct: 20,
    });
    expect(b.amountLabel).toBe("$1,000");
    expect(b.feeLabel).toBe("$200");
    expect(b.netLabel).toBe("$800");
    expect(b.feePct).toBe(20);
  });

  it("respeta los valores de la DB aunque no coincidan con un recálculo ingenuo", () => {
    // Si la DB dijera otra cosa (p. ej. fee_pct distinto), mandan sus columnas.
    const b = contractBreakdown({
      amountCents: 50_000,
      platformFeeCents: 5_000, // 10%, no 20
      creatorNetCents: 45_000,
      feePct: 10,
    });
    expect(b.feeLabel).toBe("$50");
    expect(b.netLabel).toBe("$450");
  });

  it("cae a un cálculo defensivo solo si la DB manda null (caso imposible)", () => {
    const b = contractBreakdown({
      amountCents: 100_000,
      platformFeeCents: null,
      creatorNetCents: null,
      feePct: 20,
    });
    expect(b.feeLabel).toBe("$200");
    expect(b.netLabel).toBe("$800");
  });
});

describe("dollarsToCents", () => {
  it("convierte a centavos enteros sin arrastrar error de punto flotante", () => {
    expect(dollarsToCents(1000)).toBe(100_000);
    expect(dollarsToCents(150.5)).toBe(15_050);
    expect(dollarsToCents(19.99)).toBe(1_999);
  });
});
