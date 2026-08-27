import { describe, expect, it } from "vitest";

import {
  MINIMO_PARA_HISTORIA,
  MINIMO_PARA_MEDIANA,
  cifrasDelPanel,
  describirVentana,
  esperaTipica,
  formatearEntero,
  formatearEspera,
  hayPocaHistoria,
  parseMetricas,
  totalDeSenales,
  type MetricasEscudo,
} from "./transparencia";

/**
 * Lo que se fija acá es UNA sola cosa dicha de varias formas: en esta pantalla,
 * un número inventado hace más daño que no mostrar ninguno. Por eso los tests
 * duros no son los de formato — son los de "cuándo NO hay que mostrar nada".
 */

/** La respuesta completa de la RPC, tal cual llega por PostgREST. */
const CRUDO = {
  ventana_dias: 365,
  generado_at: "2026-08-26T12:00:00Z",
  denuncias_recibidas: 42,
  denuncias_confirmadas: 9,
  denuncias_en_revision: 4,
  avisos_pausados: 7,
  avisos_restituidos: 2,
  verificaciones_activas: 18,
  revisiones_resueltas: 31,
  revision_horas_mediana: 5.4,
} as const;

const metricas = (parche: Partial<MetricasEscudo> = {}): MetricasEscudo => ({
  ...(parseMetricas(CRUDO) as MetricasEscudo),
  ...parche,
});

describe("parseMetricas", () => {
  it("lee la respuesta completa de la RPC", () => {
    expect(parseMetricas(CRUDO)).toEqual({
      ventanaDias: 365,
      denunciasRecibidas: 42,
      denunciasConfirmadas: 9,
      denunciasEnRevision: 4,
      avisosPausados: 7,
      avisosRestituidos: 2,
      verificacionesActivas: 18,
      revisionesResueltas: 31,
      revisionHorasMediana: 5.4,
    });
  });

  it("una base nueva devuelve ceros, y los ceros son un dato válido", () => {
    const vacio = parseMetricas({
      ...CRUDO,
      denuncias_recibidas: 0,
      denuncias_confirmadas: 0,
      denuncias_en_revision: 0,
      avisos_pausados: 0,
      avisos_restituidos: 0,
      verificaciones_activas: 0,
      revisiones_resueltas: 0,
      revision_horas_mediana: null,
    });
    expect(vacio).not.toBeNull();
    expect(vacio?.denunciasRecibidas).toBe(0);
    expect(vacio?.revisionHorasMediana).toBeNull();
  });

  it("UN CAMPO QUE FALTA NO ES UN CERO: se rechaza la lectura entera", () => {
    // La regla que sostiene toda la pantalla. Completar con 0 acá haría que un
    // error de la consulta se leyera como "no pasó nada malo".
    const { avisos_pausados: _omitido, ...incompleto } = CRUDO;
    expect(parseMetricas(incompleto)).toBeNull();
  });

  it("rechaza formas imposibles en vez de convertirlas", () => {
    expect(parseMetricas({ ...CRUDO, denuncias_recibidas: -1 })).toBeNull();
    expect(parseMetricas({ ...CRUDO, denuncias_recibidas: 4.5 })).toBeNull();
    expect(parseMetricas({ ...CRUDO, denuncias_recibidas: true })).toBeNull();
    expect(parseMetricas({ ...CRUDO, denuncias_recibidas: "muchas" })).toBeNull();
    expect(parseMetricas({ ...CRUDO, revision_horas_mediana: -2 })).toBeNull();
    expect(parseMetricas({ ...CRUDO, revision_horas_mediana: undefined })).toBeNull();
  });

  it("acepta el numeric que PostgREST manda como string", () => {
    const leido = parseMetricas({
      ...CRUDO,
      denuncias_recibidas: "42",
      revision_horas_mediana: "5.4",
    });
    expect(leido?.denunciasRecibidas).toBe(42);
    expect(leido?.revisionHorasMediana).toBe(5.4);
  });

  it("una ventana de 0 días invalida todo lo demás", () => {
    expect(parseMetricas({ ...CRUDO, ventana_dias: 0 })).toBeNull();
  });

  it("nada que no sea un objeto es una lectura fallida", () => {
    expect(parseMetricas(null)).toBeNull();
    expect(parseMetricas(undefined)).toBeNull();
    expect(parseMetricas([CRUDO])).toBeNull();
    expect(parseMetricas("{}")).toBeNull();
  });
});

describe("formatearEntero", () => {
  it("agrupa de a mil con punto, sin depender del ICU de Node", () => {
    expect(formatearEntero(0)).toBe("0");
    expect(formatearEntero(999)).toBe("999");
    expect(formatearEntero(1000)).toBe("1.000");
    expect(formatearEntero(1234567)).toBe("1.234.567");
  });

  it("nunca devuelve un negativo ni un decimal", () => {
    expect(formatearEntero(-5)).toBe("0");
    expect(formatearEntero(12.9)).toBe("12");
  });
});

describe("describirVentana", () => {
  it("el copy sale de la ventana que devolvió la base, no de una constante", () => {
    expect(describirVentana(365)).toBe("los últimos 12 meses");
    expect(describirVentana(90)).toBe("los últimos 3 meses");
    expect(describirVentana(30)).toBe("el último mes");
    expect(describirVentana(45)).toBe("los últimos 45 días");
  });
});

describe("formatearEspera", () => {
  it("redondea a la unidad que se lee", () => {
    expect(formatearEspera(0.4)).toBe("menos de 1 hora");
    expect(formatearEspera(1)).toBe("1 hora");
    expect(formatearEspera(5.4)).toBe("5 horas");
    expect(formatearEspera(47)).toBe("47 horas");
    expect(formatearEspera(48)).toBe("2 días");
    expect(formatearEspera(24 * 9)).toBe("9 días");
  });
});

describe("esperaTipica", () => {
  it("con muestra suficiente publica la mediana", () => {
    const espera = esperaTipica(metricas());
    expect(espera.estado).toBe("conocida");
    if (espera.estado === "conocida") expect(espera.texto).toBe("5 horas");
  });

  it("CON POCA MUESTRA NO HAY NÚMERO — ni siquiera si la mediana existe", () => {
    // Dos revisiones resueltas dan una mediana matemáticamente correcta y
    // completamente insignificante. Publicarla sería una anécdota con forma de
    // estadística.
    const espera = esperaTipica(
      metricas({ revisionesResueltas: MINIMO_PARA_MEDIANA - 1, revisionHorasMediana: 1 }),
    );
    expect(espera).toEqual({ estado: "sin_muestra", resueltas: MINIMO_PARA_MEDIANA - 1 });
  });

  it("sin ninguna revisión resuelta tampoco dice 'cero horas'", () => {
    // Cero horas sería una afirmación sobre la velocidad del equipo. No tenemos
    // ninguna que hacer todavía.
    expect(
      esperaTipica(metricas({ revisionesResueltas: 0, revisionHorasMediana: null })).estado,
    ).toBe("sin_muestra");
  });
});

describe("hayPocaHistoria", () => {
  it("una comunidad con actividad real no lleva el cartel", () => {
    expect(hayPocaHistoria(metricas())).toBe(false);
  });

  it("una base recién sembrada sí", () => {
    const nueva = metricas({
      denunciasRecibidas: 1,
      avisosPausados: 0,
      verificacionesActivas: 0,
      revisionesResueltas: 0,
    });
    expect(totalDeSenales(nueva)).toBe(1);
    expect(hayPocaHistoria(nueva)).toBe(true);
  });

  it("las restituciones no inflan el total: ya están implicadas en las pausas", () => {
    const base = metricas({
      denunciasRecibidas: 4,
      avisosPausados: 2,
      avisosRestituidos: 99,
      verificacionesActivas: 1,
      revisionesResueltas: 1,
    });
    expect(totalDeSenales(base)).toBe(8);
    expect(hayPocaHistoria(base)).toBe(true);
  });

  it("justo en el umbral ya cuenta como historia", () => {
    const justo = metricas({
      denunciasRecibidas: MINIMO_PARA_HISTORIA,
      avisosPausados: 0,
      verificacionesActivas: 0,
      revisionesResueltas: 0,
    });
    expect(hayPocaHistoria(justo)).toBe(false);
  });
});

describe("cifrasDelPanel", () => {
  it("cada cifra dice en su nota la ventana real que se contó", () => {
    const cifras = cifrasDelPanel(metricas());
    expect(cifras.map((c) => c.clave)).toEqual([
      "denuncias",
      "confirmadas",
      "pausados",
      "restituidos",
      "verificaciones",
    ]);
    for (const cifra of cifras) expect(cifra.nota).toContain("los últimos 12 meses");
  });

  it("si la base cambia la ventana, el copy la sigue sin tocar el front", () => {
    const cifras = cifrasDelPanel(metricas({ ventanaDias: 90 }));
    for (const cifra of cifras) expect(cifra.nota).toContain("los últimos 3 meses");
  });

  it("marca los ceros como 'todavía', no como falla", () => {
    const cifras = cifrasDelPanel(
      metricas({ denunciasRecibidas: 0, denunciasEnRevision: 0, avisosPausados: 3 }),
    );
    expect(cifras.find((c) => c.clave === "denuncias")?.todavia).toBe(true);
    expect(cifras.find((c) => c.clave === "pausados")?.todavia).toBe(false);
  });

  it("cuando hay denuncias sin resolver, la nota lo dice en vez de esconderlo", () => {
    const conPendientes = cifrasDelPanel(metricas({ denunciasEnRevision: 4 }));
    expect(conPendientes.find((c) => c.clave === "denuncias")?.nota).toContain(
      "4 sin resolver",
    );
  });

  it("y cuando no las hay, aclara que sólo cuenta lo que la comunidad avisó", () => {
    const sinPendientes = cifrasDelPanel(metricas({ denunciasEnRevision: 0 }));
    expect(sinPendientes.find((c) => c.clave === "denuncias")?.nota).toContain(
      "no todo lo que pasó",
    );
  });
});
