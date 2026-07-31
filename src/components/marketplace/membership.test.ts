import { describe, expect, it } from "vitest";
import {
  daysUntilPeriodEnd,
  EXTERNAL_CHECKOUT_FACTS,
  formatMembershipPrice,
  MEMBERSHIP_EXCLUDES,
  MEMBERSHIP_PRICE_CENTS,
  MEMBERSHIP_STATUSES,
  membershipPresentation,
  parseMembershipStatus,
  statusKeepsStoreOn,
} from "./membership";

const NOW = new Date("2026-07-30T12:00:00.000Z");

describe("statusKeepsStoreOn — espejo de app.mirror_store_active (0048)", () => {
  it("active y past_due dejan la tienda prendida", () => {
    expect(statusKeepsStoreOn("active")).toBe(true);
    // past_due NO apaga: un cobro que rebotó da margen para reintentar.
    expect(statusKeepsStoreOn("past_due")).toBe(true);
  });

  it("canceled y expired la apagan", () => {
    expect(statusKeepsStoreOn("canceled")).toBe(false);
    expect(statusKeepsStoreOn("expired")).toBe(false);
  });

  it("cubre TODOS los estados del CHECK — si la base suma uno, este test cae", () => {
    expect(MEMBERSHIP_STATUSES).toEqual(["active", "past_due", "canceled", "expired"]);
    for (const status of MEMBERSHIP_STATUSES) {
      expect(typeof statusKeepsStoreOn(status)).toBe("boolean");
    }
  });
});

describe("parseMembershipStatus", () => {
  it("acepta los cuatro del CHECK y rechaza cualquier otra cosa", () => {
    expect(parseMembershipStatus("active")).toBe("active");
    expect(parseMembershipStatus("expired")).toBe("expired");
    expect(parseMembershipStatus("trialing")).toBeNull();
    expect(parseMembershipStatus(null)).toBeNull();
    expect(parseMembershipStatus(42)).toBeNull();
  });
});

describe("membershipPresentation", () => {
  it("sin fila es 'sin membresía', NO 'vencida'", () => {
    // Una tienda vieja nunca tuvo membresía: acusarla de morosa sería falso.
    const view = membershipPresentation(null);
    expect(view.view).toBe("none");
    expect(view.tone).toBe("neutral");
    expect(view.canActivate).toBe(true);
  });

  it("activa: visible y sin CTA de reactivación", () => {
    const view = membershipPresentation({ status: "active", currentPeriodEnd: null });
    expect(view.storeVisible).toBe(true);
    expect(view.canActivate).toBe(false);
    expect(view.tone).toBe("success");
  });

  it("past_due avisa pero NO dice que la tienda esté apagada", () => {
    const view = membershipPresentation({ status: "past_due", currentPeriodEnd: null });
    expect(view.storeVisible).toBe(true);
    expect(view.tone).toBe("warning");
    expect(view.canActivate).toBe(true);
  });

  it("vencida y cancelada apagan la tienda y ofrecen volver", () => {
    for (const status of ["expired", "canceled"] as const) {
      const view = membershipPresentation({ status, currentPeriodEnd: null });
      expect(view.storeVisible).toBe(false);
      expect(view.canActivate).toBe(true);
      expect(view.tone).toBe("danger");
    }
  });

  it("un status desconocido degrada a 'sin membresía' en vez de romper", () => {
    expect(membershipPresentation({ status: "loquesea", currentPeriodEnd: null }).view).toBe(
      "none",
    );
  });

  it("listings.store_active manda sobre lo que dice la fila", () => {
    // El espejo es lo que la comunidad ve de verdad; si difiere, gana el espejo.
    const view = membershipPresentation({ status: "active", currentPeriodEnd: null }, false);
    expect(view.storeVisible).toBe(false);
  });
});

describe("daysUntilPeriodEnd", () => {
  it("cuenta los días que faltan", () => {
    expect(daysUntilPeriodEnd("2026-08-09T12:00:00.000Z", NOW)).toBe(10);
  });

  it("da negativo si ya pasó (el cron todavía no corrió)", () => {
    expect(daysUntilPeriodEnd("2026-07-25T12:00:00.000Z", NOW)).toBeLessThan(0);
  });

  it("null si no hay fecha o es ilegible", () => {
    expect(daysUntilPeriodEnd(null, NOW)).toBeNull();
    expect(daysUntilPeriodEnd("nunca", NOW)).toBeNull();
  });
});

describe("formatMembershipPrice", () => {
  it("son 10 dólares", () => {
    expect(MEMBERSHIP_PRICE_CENTS).toBe(1_000);
    expect(formatMembershipPrice()).toContain("10");
  });

  it("respeta el precio de la fila si es otro (precio fundador futuro)", () => {
    expect(formatMembershipPrice(500)).toContain("5");
  });

  it("un precio roto cae al de la spec en vez de mostrar NaN", () => {
    expect(formatMembershipPrice(Number.NaN)).toContain("10");
    expect(formatMembershipPrice(0)).toContain("10");
  });
});

describe("honestidad del copy", () => {
  it("dice que no hay comisión por venta y que se puede cancelar", () => {
    const texto = MEMBERSHIP_EXCLUDES.join(" ").toLowerCase();
    expect(texto).toContain("comisión");
    expect(texto).toContain("cancelar");
  });

  it("le dice al comprador quién cobra, quién envía y que no hay reembolso nuestro", () => {
    const texto = EXTERNAL_CHECKOUT_FACTS.join(" ").toLowerCase();
    expect(texto).toContain("cobra el negocio");
    expect(texto).toContain("devolución");
    expect(texto).toContain("reembolsarte");
  });

  it("no promete protección al comprador en ninguna frase", () => {
    const todo = [...MEMBERSHIP_EXCLUDES, ...EXTERNAL_CHECKOUT_FACTS].join(" ").toLowerCase();
    for (const promesa of ["te protegemos", "compra protegida", "garantizamos", "seguro"]) {
      expect(todo).not.toContain(promesa);
    }
  });
});
