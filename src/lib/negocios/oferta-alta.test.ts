import { describe, expect, it } from "vitest";
import {
  MAX_DIAS_DE_OFERTA,
  MAX_TITULO_OFERTA,
  diasEntre,
  finDelDiaEnZona,
  hoyEnZona,
  ofertaVacia,
  validarOferta,
  type OfertaBorrador,
} from "./oferta-alta";

/**
 * Lo que se prueba acá es el CONTRATO CON LA 0106: cada rechazo de este módulo
 * espeja un CHECK de la tabla `post_offers`, y el valor de estos tests es que
 * el día que alguien afloje una regla acá sin tocar el SQL, el formulario deje
 * de reventar al final en vez de reventar en el test.
 *
 * La fecha entra por parámetro en todas las funciones que la necesitan, así que
 * ninguna de estas pruebas depende del reloj de la máquina que las corre.
 */

const HOY = "2026-08-25";

function borrador(cambios: Partial<OfertaBorrador> = {}): OfertaBorrador {
  return { ...ofertaVacia(), titulo: "2x1 en empanadas", vence: "2026-09-12", ...cambios };
}

describe("validarOferta", () => {
  it("acepta la oferta mínima: tipo, título y hasta cuándo vale", () => {
    const resultado = validarOferta(borrador(), HOY);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.oferta.titulo).toBe("2x1 en empanadas");
    expect(resultado.oferta.valor).toBeNull();
    expect(resultado.oferta.valorTipo).toBeNull();
  });

  it("recorta el título y rechaza el que queda vacío", () => {
    const conEspacios = validarOferta(borrador({ titulo: "  20% en cortes  " }), HOY);
    expect(conEspacios.ok && conEspacios.oferta.titulo).toBe("20% en cortes");
    expect(validarOferta(borrador({ titulo: "   " }), HOY)).toEqual({
      ok: false,
      motivo: "titulo",
    });
  });

  it("respeta el techo de 120 caracteres del DDL", () => {
    const justo = "a".repeat(MAX_TITULO_OFERTA);
    expect(validarOferta(borrador({ titulo: justo }), HOY).ok).toBe(true);
    expect(validarOferta(borrador({ titulo: `${justo}a` }), HOY)).toEqual({
      ok: false,
      motivo: "titulo",
    });
  });

  it("valor y tipo viajan juntos o no viajan (post_offers_valor_completo)", () => {
    expect(validarOferta(borrador({ valor: 20, valorTipo: null }), HOY)).toEqual({
      ok: false,
      motivo: "valor",
    });
    expect(validarOferta(borrador({ valor: null, valorTipo: "porcentaje" }), HOY)).toEqual({
      ok: false,
      motivo: "valor",
    });
    expect(validarOferta(borrador({ valor: 20, valorTipo: "porcentaje" }), HOY).ok).toBe(true);
  });

  it("no acepta un descuento de cero ni negativo — la base tampoco", () => {
    for (const valor of [0, -5]) {
      expect(validarOferta(borrador({ valor, valorTipo: "monto" }), HOY)).toEqual({
        ok: false,
        motivo: "valor",
      });
    }
  });

  it("un porcentaje no puede pasar de 100; un monto sí puede ser grande", () => {
    expect(validarOferta(borrador({ valor: 101, valorTipo: "porcentaje" }), HOY)).toEqual({
      ok: false,
      motivo: "valor",
    });
    expect(validarOferta(borrador({ valor: 5_000, valorTipo: "monto" }), HOY).ok).toBe(true);
  });

  it("redondea el valor a los dos decimales que guarda numeric(12,2)", () => {
    const resultado = validarOferta(borrador({ valor: 12.345, valorTipo: "monto" }), HOY);
    expect(resultado.ok && resultado.oferta.valor).toBe(12.35);
  });

  it("el cupón se guarda en mayúsculas y respeta el rango 3–40", () => {
    const ok = validarOferta(borrador({ codigoCupon: " verano26 " }), HOY);
    expect(ok.ok && ok.oferta.codigoCupon).toBe("VERANO26");

    expect(validarOferta(borrador({ codigoCupon: "ab" }), HOY)).toEqual({
      ok: false,
      motivo: "cupon",
    });
    expect(validarOferta(borrador({ codigoCupon: "x".repeat(41) }), HOY)).toEqual({
      ok: false,
      motivo: "cupon",
    });
  });

  it("un cupón vacío es 'sin cupón', no un error", () => {
    const resultado = validarOferta(borrador({ codigoCupon: "   " }), HOY);
    expect(resultado.ok && resultado.oferta.codigoCupon).toBeNull();
  });

  it("distingue los tres motivos de una fecha que no sirve", () => {
    expect(validarOferta(borrador({ vence: "" }), HOY)).toEqual({ ok: false, motivo: "vence" });
    expect(validarOferta(borrador({ vence: "12/09/2026" }), HOY)).toEqual({
      ok: false,
      motivo: "vence",
    });
    expect(validarOferta(borrador({ vence: "2026-08-24" }), HOY)).toEqual({
      ok: false,
      motivo: "vence_pasada",
    });
    expect(validarOferta(borrador({ vence: "2028-01-01" }), HOY)).toEqual({
      ok: false,
      motivo: "vence_lejos",
    });
  });

  it("hoy mismo vale: una oferta de un día es una oferta", () => {
    expect(validarOferta(borrador({ vence: HOY }), HOY).ok).toBe(true);
  });

  it("el último día del año permitido entra; el siguiente no", () => {
    const limite = new Date(Date.parse(`${HOY}T00:00:00Z`) + MAX_DIAS_DE_OFERTA * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const pasado = new Date(
      Date.parse(`${HOY}T00:00:00Z`) + (MAX_DIAS_DE_OFERTA + 1) * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    expect(validarOferta(borrador({ vence: limite }), HOY).ok).toBe(true);
    expect(validarOferta(borrador({ vence: pasado }), HOY)).toEqual({
      ok: false,
      motivo: "vence_lejos",
    });
  });

  it("rechaza un tipo inventado", () => {
    expect(validarOferta(borrador({ tipo: "regalo" as never }), HOY)).toEqual({
      ok: false,
      motivo: "tipo",
    });
  });

  it("las condiciones son opcionales y tienen techo", () => {
    expect(validarOferta(borrador({ terminos: "  " }), HOY)).toMatchObject({
      ok: true,
      oferta: { terminos: null },
    });
    expect(validarOferta(borrador({ terminos: "x".repeat(2001) }), HOY)).toEqual({
      ok: false,
      motivo: "terminos",
    });
  });
});

describe("diasEntre", () => {
  it("cuenta días calendario y da negativo hacia atrás", () => {
    expect(diasEntre("2026-08-25", "2026-08-25")).toBe(0);
    expect(diasEntre("2026-08-25", "2026-09-01")).toBe(7);
    expect(diasEntre("2026-09-01", "2026-08-25")).toBe(-7);
  });

  it("cruza un cambio de horario sin perder ni ganar un día", () => {
    // 1 de noviembre de 2026: en Nueva York el DST termina ese domingo.
    expect(diasEntre("2026-10-31", "2026-11-02")).toBe(2);
  });
});

describe("finDelDiaEnZona", () => {
  it("apunta al final del día elegido, no al principio", () => {
    const fin = finDelDiaEnZona("2026-09-12", "America/New_York");
    expect(fin).not.toBeNull();
    // 23:59:59.999 del 12 en Nueva York (UTC-4 en septiembre) = 03:59 UTC del 13.
    expect(fin?.toISOString()).toBe("2026-09-13T03:59:59.999Z");
  });

  it("aplica el horario de invierno cuando corresponde", () => {
    const fin = finDelDiaEnZona("2026-12-12", "America/New_York");
    // UTC-5 en diciembre.
    expect(fin?.toISOString()).toBe("2026-12-13T04:59:59.999Z");
  });

  it("una zona sin cambio de horario también sale bien", () => {
    const fin = finDelDiaEnZona("2026-09-12", "America/Santo_Domingo");
    expect(fin?.toISOString()).toBe("2026-09-13T03:59:59.999Z");
  });

  it("devuelve null antes que inventar una zona", () => {
    expect(finDelDiaEnZona("2026-09-12", "Marte/Olympus")).toBeNull();
    expect(finDelDiaEnZona("mañana", "America/New_York")).toBeNull();
  });
});

describe("hoyEnZona", () => {
  it("a las 22 de Nueva York todavía es el mismo día, y en UTC ya es el siguiente", () => {
    const instante = new Date("2026-08-26T02:30:00Z");
    expect(hoyEnZona(instante, "America/New_York")).toBe("2026-08-25");
    expect(instante.toISOString().slice(0, 10)).toBe("2026-08-26");
  });

  it("cae al día UTC si la zona no existe, en vez de tirar", () => {
    expect(hoyEnZona(new Date("2026-08-26T02:30:00Z"), "Marte/Olympus")).toBe("2026-08-26");
  });
});
