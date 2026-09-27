import { describe, expect, it } from "vitest";
import {
  REVIEW_WINDOW_HOURS,
  formatTimeLeft,
  isReviewWindowOver,
  revisionsLeft,
  reviewDeadlineFrom,
  timeLeft,
} from "./review-window";

const DELIVERED = new Date("2026-09-20T12:00:00.000Z");

describe("ventana de revisión", () => {
  it("dura 72 horas desde la entrega", () => {
    expect(REVIEW_WINDOW_HOURS).toBe(72);
    expect(reviewDeadlineFrom(DELIVERED).toISOString()).toBe("2026-09-23T12:00:00.000Z");
  });

  it("descompone lo que falta en días, horas y minutos", () => {
    const now = new Date("2026-09-20T17:30:00.000Z");
    expect(timeLeft("2026-09-23T12:00:00.000Z", now)).toEqual({
      expired: false,
      days: 2,
      hours: 18,
      minutes: 30,
    });
  });

  it("vencida no devuelve números negativos", () => {
    const now = new Date("2026-09-24T00:00:00.000Z");
    expect(timeLeft("2026-09-23T12:00:00.000Z", now)).toEqual({
      expired: true,
      days: 0,
      hours: 0,
      minutes: 0,
    });
    expect(isReviewWindowOver("2026-09-23T12:00:00.000Z", now)).toBe(true);
  });

  it("sin fecha límite (revisión pausada) no está vencida", () => {
    expect(isReviewWindowOver(null, new Date())).toBe(false);
  });

  it("el texto es el de la pantalla del cliente", () => {
    expect(formatTimeLeft({ expired: false, days: 2, hours: 18, minutes: 5 })).toBe("2 días 18 horas");
    expect(formatTimeLeft({ expired: false, days: 1, hours: 1, minutes: 0 })).toBe("1 día 1 hora");
    expect(formatTimeLeft({ expired: false, days: 0, hours: 3, minutes: 12 })).toBe("3 horas 12 min");
    expect(formatTimeLeft({ expired: false, days: 0, hours: 0, minutes: 7 })).toBe("7 min");
    expect(formatTimeLeft({ expired: true, days: 0, hours: 0, minutes: 0 })).toBe("Vencido");
  });
});

describe("revisiones incluidas", () => {
  it("resta las usadas y nunca da negativo", () => {
    expect(revisionsLeft(2, 0)).toBe(2);
    expect(revisionsLeft(2, 1)).toBe(1);
    expect(revisionsLeft(2, 2)).toBe(0);
    expect(revisionsLeft(1, 3)).toBe(0);
  });

  it("valores inválidos cuentan como cero revisiones disponibles", () => {
    expect(revisionsLeft(Number.NaN, 0)).toBe(0);
    expect(revisionsLeft(-1, 0)).toBe(0);
  });
});
