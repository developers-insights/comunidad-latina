import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREF,
  isNotificationFrequency,
  prefsFromRows,
  resolvePref,
  shouldDeliver,
  shouldDeliverInApp,
  type NotificationPref,
} from "./prefs";

const pref = (overrides: Partial<NotificationPref> = {}): NotificationPref => ({
  ...DEFAULT_PREF,
  ...overrides,
});

describe("la ausencia de fila significa TODO PRENDIDO", () => {
  it("sin preferencias guardadas, entrega", () => {
    expect(resolvePref({}, "social")).toEqual(DEFAULT_PREF);
    expect(shouldDeliver({}, "social", "normal")).toBe(true);
  });

  it("el default de push es false: la columna existe, la entrega todavía no", () => {
    expect(DEFAULT_PREF.push).toBe(false);
    expect(DEFAULT_PREF.inApp).toBe(true);
    expect(DEFAULT_PREF.email).toBe(true);
    expect(DEFAULT_PREF.frequency).toBe("all");
  });
});

describe("frecuencias", () => {
  it("'off' no entrega nada", () => {
    expect(shouldDeliverInApp(pref({ frequency: "off" }), "normal")).toBe(false);
    expect(shouldDeliverInApp(pref({ frequency: "off" }), "high")).toBe(false);
  });

  it("'important' deja pasar sólo high y critical", () => {
    const p = pref({ frequency: "important" });
    expect(shouldDeliverInApp(p, "low")).toBe(false);
    expect(shouldDeliverInApp(p, "normal")).toBe(false);
    expect(shouldDeliverInApp(p, "high")).toBe(true);
    expect(shouldDeliverInApp(p, "critical")).toBe(true);
  });

  it("'digest' SIGUE entregando en la app: es la frecuencia del correo", () => {
    // Si `digest` se comportara como `off`, elegirlo dejaría a la persona sin
    // nada mientras el cron del resumen no exista.
    expect(shouldDeliverInApp(pref({ frequency: "digest" }), "normal")).toBe(true);
  });

  it("apagar el canal in_app gana sobre cualquier frecuencia", () => {
    expect(shouldDeliverInApp(pref({ inApp: false }), "critical")).toBe(false);
    expect(shouldDeliverInApp(pref({ inApp: false, frequency: "all" }), "high")).toBe(false);
  });
});

describe("categorías que no se pueden silenciar", () => {
  it("aunque exista una fila apagada, seguridad/pagos/cuenta entregan igual", () => {
    const silenciadas = {
      seguridad: pref({ inApp: false, frequency: "off" }),
      pagos: pref({ frequency: "off" }),
      cuenta: pref({ inApp: false }),
    };
    expect(shouldDeliver(silenciadas, "seguridad", "critical")).toBe(true);
    expect(shouldDeliver(silenciadas, "pagos", "normal")).toBe(true);
    expect(shouldDeliver(silenciadas, "cuenta", "low")).toBe(true);
  });

  it("una categoría normal SÍ se silencia", () => {
    expect(shouldDeliver({ social: pref({ frequency: "off" }) }, "social", "normal")).toBe(
      false,
    );
  });
});

describe("prefsFromRows", () => {
  it("traduce las filas crudas de PostgREST", () => {
    const prefs = prefsFromRows([
      { category: "social", in_app: false, email: true, push: false, frequency: "important" },
    ]);
    expect(prefs.social).toEqual({
      inApp: false,
      email: true,
      push: false,
      frequency: "important",
    });
  });

  it("una frecuencia desconocida se lee como 'all': ante la duda, entregar", () => {
    const prefs = prefsFromRows([
      { category: "eventos", in_app: true, email: true, push: false, frequency: "semanal" },
    ]);
    expect(prefs.eventos?.frequency).toBe("all");
    expect(shouldDeliver(prefs, "eventos", "low")).toBe(true);
  });

  it("el guard de frecuencia acepta sólo las cuatro del CHECK", () => {
    expect(isNotificationFrequency("all")).toBe(true);
    expect(isNotificationFrequency("digest")).toBe(true);
    expect(isNotificationFrequency("weekly")).toBe(false);
    expect(isNotificationFrequency(undefined)).toBe(false);
  });
});
