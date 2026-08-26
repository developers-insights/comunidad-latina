import { describe, expect, it } from "vitest";
import {
  esOfertaTipo,
  etiquetaDeValor,
  leerValor,
  vencimientoDeOferta,
} from "./ofertas-modelo";

/**
 * El vencimiento es lo que separa una oferta de un precio (por eso la 0106 hizo
 * `expires_at` NOT NULL y sin default). Estos casos fijan los bordes de esa
 * cuenta y el "no inventes un descuento" del valor.
 *
 * Todas las horas se escriben con offset explícito: la app cuenta los días en la
 * zona de la comunidad (`America/New_York`), así que un test con hora local del
 * runner daría distinto según en qué máquina corre.
 */

/** Lunes 2026-08-24, 12:00 de Nueva York (EDT = UTC-4). */
const AHORA = new Date("2026-08-24T12:00:00-04:00");

describe("vencimientoDeOferta", () => {
  it("una oferta que ya pasó su fecha se marca como vencida", () => {
    const v = vencimientoDeOferta("2026-08-24T11:59:00-04:00", AHORA);
    expect(v.estado).toBe("vencida");
    expect(v.etiqueta).toMatch(/venció/i);
  });

  it("mismo día calendario ⇒ 'Vence hoy'", () => {
    const v = vencimientoDeOferta("2026-08-24T23:59:00-04:00", AHORA);
    expect(v).toEqual({ estado: "por_vencer", etiqueta: "Vence hoy" });
  });

  it("el día siguiente ⇒ 'Vence mañana', aunque falten más de 24 horas", () => {
    const v = vencimientoDeOferta("2026-08-25T23:00:00-04:00", AHORA);
    expect(v).toEqual({ estado: "por_vencer", etiqueta: "Vence mañana" });
  });

  it("se cuentan DÍAS de calendario, no bloques de 24 horas", () => {
    // Faltan 13 horas, pero cae en el día siguiente: "mañana", no "hoy".
    const casiMedianoche = new Date("2026-08-24T23:50:00-04:00");
    const v = vencimientoDeOferta("2026-08-25T12:00:00-04:00", casiMedianoche);
    expect(v.etiqueta).toBe("Vence mañana");
  });

  it("hasta dos días queda marcada como 'por vencer'", () => {
    const v = vencimientoDeOferta("2026-08-26T12:00:00-04:00", AHORA);
    expect(v).toEqual({ estado: "por_vencer", etiqueta: "Vence en 2 días" });
  });

  it("de tres a siete días es vigente y se cuenta en días", () => {
    const v = vencimientoDeOferta("2026-08-29T12:00:00-04:00", AHORA);
    expect(v).toEqual({ estado: "vigente", etiqueta: "Vence en 5 días" });
  });

  it("más de una semana se dice con la fecha, que orienta mejor que '23 días'", () => {
    const v = vencimientoDeOferta("2026-09-12T12:00:00-04:00", AHORA);
    expect(v.estado).toBe("vigente");
    expect(v.etiqueta).toMatch(/^Vence el /);
    expect(v.etiqueta).toMatch(/septiembre/i);
  });

  it("una fecha ilegible no afirma que venció ni rompe la tarjeta", () => {
    const v = vencimientoDeOferta("no-es-una-fecha", AHORA);
    expect(v.estado).toBe("vigente");
    expect(v.etiqueta).toMatch(/sin fecha/i);
  });
});

describe("etiquetaDeValor", () => {
  it("un porcentaje redondo se escribe sin decimales", () => {
    // `numeric(12,2)` llega como string desde PostgREST.
    expect(etiquetaDeValor("porcentaje", "20.00", "USD")).toBe("20% de descuento");
  });

  it("un porcentaje con decimal usa coma, como se escribe en español", () => {
    expect(etiquetaDeValor("porcentaje", 12.5, "USD")).toBe("12,5% de descuento");
  });

  it("un monto se formatea con la moneda de la comunidad", () => {
    const etiqueta = etiquetaDeValor("monto", "5.00", "USD");
    expect(etiqueta).toMatch(/de descuento$/);
    expect(etiqueta).toMatch(/5/);
  });

  it("sin valor NO se inventa un descuento — es el caso del menú y del paquete", () => {
    expect(etiquetaDeValor(null, null, "USD")).toBeNull();
    // Y un cero tampoco se convierte en "0% de descuento" (la base ni lo acepta).
    expect(etiquetaDeValor("porcentaje", 0, "USD")).toBeNull();
  });

  it("un valor sin tipo (fila escrita fuera de la app) no adivina si es % o plata", () => {
    expect(etiquetaDeValor(null, 20, "USD")).toBeNull();
    expect(etiquetaDeValor("marciano", 20, "USD")).toBeNull();
  });
});

describe("leerValor y esOfertaTipo — lectura defensiva del CHECK de la 0106", () => {
  it("leerValor normaliza el numeric string y descarta lo que no sirve", () => {
    expect(leerValor("4.50")).toBe(4.5);
    expect(leerValor(0)).toBeNull();
    expect(leerValor(-3)).toBeNull();
    expect(leerValor("hola")).toBeNull();
    expect(leerValor(null)).toBeNull();
  });

  it("esOfertaTipo acepta exactamente los cinco formatos del pedido", () => {
    for (const tipo of ["descuento", "cupon", "promo", "menu", "paquete"]) {
      expect(esOfertaTipo(tipo)).toBe(true);
    }
    expect(esOfertaTipo("oferta")).toBe(false);
    expect(esOfertaTipo(null)).toBe(false);
  });
});
