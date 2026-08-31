import { describe, expect, it } from "vitest";

import {
  casoEsPublicable,
  etiquetaDeOrigen,
  formatearMes,
  leerCasos,
  parseCaso,
  riesgosDelCaso,
  riesgosDeReidentificacion,
  type CasoDeSeguridad,
} from "./casos";

/**
 * Dos garantías, y las dos son de las que no se pueden verificar mirando la
 * pantalla: que no se publique un dato que permita reconocer a alguien, y que un
 * patrón documentado no se pueda leer como una estafa que pasó el martes.
 */

/** Una fila de `security_cases` tal como llega por PostgREST. */
const FILA = {
  id: "0199c0de-0000-7000-8000-000000000001",
  slug: "sena-antes-de-ver-el-lugar",
  vertical: "vivienda",
  origin: "patron",
  occurred_month: null,
  title: "La seña que se pide antes de abrir la puerta",
  summary: "Un cuarto con fotos lindas y precio bajo para la zona.",
  signal: "El pedido de plata llegó antes que la dirección.",
  response: "El aviso se pausó solo al acumular denuncias.",
  advice: "No mandes nada y denunciá el aviso.",
} as const;

const caso = (parche: Partial<CasoDeSeguridad> = {}): CasoDeSeguridad => ({
  ...(parseCaso(FILA) as CasoDeSeguridad),
  ...parche,
});

describe("riesgosDeReidentificacion", () => {
  it("un relato anónimo pasa limpio", () => {
    expect(riesgosDeReidentificacion("Pedía una seña de $600 por transferencia en 2026")).toEqual(
      [],
    );
  });

  it("detecta mail y mención por la arroba", () => {
    expect(riesgosDeReidentificacion("escribile a juan@correo.com")).toEqual(["arroba"]);
    expect(riesgosDeReidentificacion("la cuenta @vecino.ny")).toEqual(["arroba"]);
  });

  it("detecta enlaces", () => {
    expect(riesgosDeReidentificacion("mirá https://ejemplo.com/aviso")).toEqual(["enlace"]);
    expect(riesgosDeReidentificacion("HTTP://EJEMPLO.COM")).toEqual(["enlace"]);
  });

  it("detecta un teléfono, y NO confunde precios ni años con uno", () => {
    expect(riesgosDeReidentificacion("llamalo al 9175551234")).toEqual(["numero_largo"]);
    // El falso positivo que arruinaría la sección: los casos hablan de plata.
    expect(riesgosDeReidentificacion("pedía $2,400 y en 2026 seguía publicado")).toEqual([]);
    expect(riesgosDeReidentificacion("un depósito de 1100 dólares")).toEqual([]);
  });

  it("informa TODO lo que encontró, no sólo lo primero", () => {
    expect(riesgosDeReidentificacion("a@b.com o al 9175551234")).toEqual([
      "arroba",
      "numero_largo",
    ]);
  });
});

describe("casoEsPublicable", () => {
  it("el caso limpio se publica", () => {
    expect(casoEsPublicable(caso())).toBe(true);
  });

  it("UN DATO EN CUALQUIERA DE LOS CINCO TEXTOS BLOQUEA LA TARJETA ENTERA", () => {
    // El chequeo se repite en la app aunque la base tenga su CHECK: una fila
    // cargada por service_role, o por un script contra una base sin la 0122,
    // entra sin restricción de ninguna clase.
    expect(casoEsPublicable(caso({ consejo: "escribinos a ayuda@x.com" }))).toBe(false);
    expect(casoEsPublicable(caso({ resumen: "el teléfono era 9175551234" }))).toBe(false);
    expect(casoEsPublicable(caso({ titulo: "mirá https://x.com" }))).toBe(false);
  });

  it("no repite el mismo riesgo aunque aparezca en varios campos", () => {
    expect(riesgosDelCaso(caso({ resumen: "a@b.com", consejo: "c@d.com" }))).toEqual(["arroba"]);
  });
});

describe("parseCaso", () => {
  it("lee la fila y normaliza los nombres", () => {
    expect(parseCaso(FILA)).toEqual({
      id: FILA.id,
      slug: FILA.slug,
      vertical: "vivienda",
      origen: "patron",
      mes: null,
      titulo: FILA.title,
      resumen: FILA.summary,
      senal: FILA.signal,
      respuesta: FILA.response,
      consejo: FILA.advice,
    });
  });

  it("un caso puntual sin mes se descarta, aunque la base lo tenga", () => {
    // La pantalla no depende de que la 0122 esté aplicada: sin fecha no se puede
    // rotular, y sin rótulo se leería como un patrón.
    expect(parseCaso({ ...FILA, origin: "caso", occurred_month: null })).toBeNull();
  });

  it("una fecha exacta no llega a la pantalla: se exige el día 1", () => {
    expect(parseCaso({ ...FILA, origin: "caso", occurred_month: "2026-05-14" })).toBeNull();
    expect(parseCaso({ ...FILA, origin: "caso", occurred_month: "2026-05-01" })?.mes).toBe(
      "2026-05-01",
    );
  });

  it("un patrón nunca se queda con una fecha, ni si la fila la trae", () => {
    expect(parseCaso({ ...FILA, origin: "patron", occurred_month: "2026-05-01" })?.mes).toBeNull();
  });

  it("rechaza en vez de completar con defaults", () => {
    expect(parseCaso({ ...FILA, signal: "" })).toBeNull();
    expect(parseCaso({ ...FILA, advice: null })).toBeNull();
    expect(parseCaso({ ...FILA, vertical: "inmuebles" })).toBeNull();
    expect(parseCaso({ ...FILA, origin: "inventado" })).toBeNull();
    expect(parseCaso(null)).toBeNull();
    expect(parseCaso([FILA])).toBeNull();
  });
});

describe("leerCasos", () => {
  it("deja pasar lo bueno y cuenta lo que descartó", () => {
    const lectura = leerCasos([
      FILA,
      { ...FILA, id: "b", slug: "otro", advice: "llamá al 9175551234" },
      { ...FILA, id: "c", slug: "roto", vertical: "inmuebles" },
    ]);
    expect(lectura.publicables.map((c) => c.slug)).toEqual(["sena-antes-de-ver-el-lugar"]);
    expect(lectura.descartados).toBe(2);
  });

  it("sin filas no explota: devuelve la sección vacía", () => {
    expect(leerCasos(null)).toEqual({ publicables: [], descartados: 0 });
    expect(leerCasos([])).toEqual({ publicables: [], descartados: 0 });
  });
});

describe("formatearMes", () => {
  it("dice el mes en castellano, sin correrlo por zona horaria", () => {
    // `new Date('2026-05-01')` es medianoche UTC: al oeste de Greenwich eso es
    // el 30 de abril, y la tarjeta mostraría el mes anterior sin que nadie lo
    // note. Por eso se parsea a mano.
    expect(formatearMes("2026-05-01")).toBe("mayo de 2026");
    expect(formatearMes("2026-01-01")).toBe("enero de 2026");
    expect(formatearMes("2026-12-01")).toBe("diciembre de 2026");
  });

  it("no inventa un mes con una entrada rara", () => {
    expect(formatearMes("2026-13-01")).toBeNull();
    expect(formatearMes("2026-05-14")).toBeNull();
    expect(formatearMes("mayo")).toBeNull();
  });
});

describe("etiquetaDeOrigen", () => {
  it("UN PATRÓN Y UN CASO NUNCA SE DICEN CON LAS MISMAS PALABRAS", () => {
    const patron = etiquetaDeOrigen(caso({ origen: "patron", mes: null }));
    const puntual = etiquetaDeOrigen(caso({ origen: "caso", mes: "2026-05-01" }));
    expect(patron).toBe("Patrón documentado por el equipo");
    expect(puntual).toBe("Caso de la comunidad · mayo de 2026");
    expect(patron).not.toBe(puntual);
  });

  it("un caso al que se le perdió el mes sigue diciendo que es un caso", () => {
    expect(etiquetaDeOrigen(caso({ origen: "caso", mes: null }))).toBe("Caso de la comunidad");
  });
});
