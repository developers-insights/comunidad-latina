import { describe, expect, it } from "vitest";
import {
  ILEGIBLE,
  NO_APLICA,
  armarResumen,
  diasRestantesDe,
  estadoDeCampana,
  medido,
  sumar,
  type BoostRowInput,
  type ListingLite,
  type PostLite,
  type PromoRowInput,
} from "./resumen";

const AHORA = Date.parse("2026-09-15T12:00:00.000Z");
const EN_3_DIAS = "2026-09-18T12:00:00.000Z";
const HACE_2_DIAS = "2026-09-13T12:00:00.000Z";

function boost(over: Partial<BoostRowInput> = {}): BoostRowInput {
  return {
    id: "b1",
    listing_id: "l1",
    status: "active",
    amount_cents: 2500,
    ends_at: EN_3_DIAS,
    created_at: "2026-09-10T00:00:00.000Z",
    ...over,
  };
}

function promo(over: Partial<PromoRowInput> = {}): PromoRowInput {
  return {
    id: "p1",
    post_id: "po1",
    status: "expired",
    amount_cents: 1000,
    ends_at: HACE_2_DIAS,
    created_at: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

const LISTING: ListingLite = { id: "l1", title: "Cuarto en Astoria", photos: null, view_count: 17 };
const POST: PostLite = { id: "po1", body: "Corte y barba esta semana", media: null, view_count: 11 };

function armar(over: Partial<Parameters<typeof armarResumen>[0]> = {}) {
  return armarResumen({
    boosts: [boost()],
    promociones: [promo()],
    listingsPorId: new Map([["l1", LISTING]]),
    postsPorId: new Map([["po1", POST]]),
    impresionesPorBoost: new Map([["b1", 240]]),
    ahoraMs: AHORA,
    ...over,
  });
}

describe("estadoDeCampana", () => {
  it("activa sólo si el status lo dice Y todavía no venció", () => {
    expect(estadoDeCampana("active", EN_3_DIAS, AHORA)).toBe("activa");
  });

  it("un 'active' con fecha pasada ya terminó, aunque la fila no se haya barrido", () => {
    // El barrido que vence campañas corre cada tanto. Mientras tanto la fila
    // sigue diciendo "active" y la pantalla mostraría "activa, 0 días" — justo
    // lo que alguien mira para decidir si renueva.
    expect(estadoDeCampana("active", HACE_2_DIAS, AHORA)).toBe("terminada");
  });

  it("sin fecha de fin no se puede afirmar que está corriendo", () => {
    expect(estadoDeCampana("active", null, AHORA)).toBe("terminada");
  });

  it("cancelada y vencida se distinguen", () => {
    expect(estadoDeCampana("canceled", EN_3_DIAS, AHORA)).toBe("cancelada");
    expect(estadoDeCampana("expired", HACE_2_DIAS, AHORA)).toBe("terminada");
  });
});

describe("diasRestantesDe", () => {
  it("cuenta días enteros hacia arriba", () => {
    expect(diasRestantesDe("activa", EN_3_DIAS, AHORA)).toBe(3);
  });

  it("lo que ya terminó no tiene días restantes (no es 0, es nada)", () => {
    expect(diasRestantesDe("terminada", HACE_2_DIAS, AHORA)).toBeNull();
    expect(diasRestantesDe("cancelada", EN_3_DIAS, AHORA)).toBeNull();
  });
});

describe("sumar", () => {
  it("suma lo que se pudo leer", () => {
    expect(sumar([medido(10), medido(5)])).toEqual(medido(15));
  });

  it("UN solo ilegible vuelve ilegible al total", () => {
    // Un total al que le faltan sumandos, presentado como total, se lee como la
    // cifra completa: es peor que no mostrarlo.
    expect(sumar([medido(100), ILEGIBLE])).toEqual(ILEGIBLE);
  });

  it("los 'no aplica' no contaminan ni restan", () => {
    expect(sumar([medido(7), NO_APLICA])).toEqual(medido(7));
  });

  it("sin ninguna medición real, el total tampoco aplica", () => {
    expect(sumar([NO_APLICA, NO_APLICA])).toEqual(NO_APLICA);
    expect(sumar([])).toEqual(NO_APLICA);
  });

  it("un cero leído es un total válido, no un vacío", () => {
    expect(sumar([medido(0)])).toEqual(medido(0));
  });
});

describe("armarResumen", () => {
  it("junta impulsos y promociones, lo más nuevo primero", () => {
    const { campanas } = armar();
    expect(campanas.map((c) => c.id)).toEqual(["b1", "p1"]);
    expect(campanas[0].tipo).toBe("aviso");
    expect(campanas[1].tipo).toBe("publicacion");
  });

  it("un impulso trae sus veces mostradas y sus vistas", () => {
    const [aviso] = armar().campanas;
    expect(aviso.vecesMostrada).toEqual(medido(240));
    expect(aviso.vistas).toEqual(medido(17));
    expect(aviso.estado).toBe("activa");
    expect(aviso.diasRestantes).toBe(3);
    expect(aviso.href).toBe("/impulsar/l1/estadisticas");
  });

  it("EL CASO: si la lectura de impresiones se cayó, es hueco y NO cero", () => {
    const { campanas, totales } = armar({ impresionesPorBoost: null });
    expect(campanas[0].vecesMostrada).toEqual(ILEGIBLE);
    expect(totales.vecesMostrada).toEqual(ILEGIBLE);
  });

  it("un impulso servido cero veces SÍ es un cero real", () => {
    // Distinto del anterior: acá la consulta anduvo y devolvió que no se sirvió
    // nunca. Ese cero es información y se muestra.
    const { campanas } = armar({ impresionesPorBoost: new Map() });
    expect(campanas[0].vecesMostrada).toEqual(medido(0));
  });

  it("una publicación no tiene veces mostradas: no aplica, no es cero", () => {
    const [, post] = armar().campanas;
    expect(post.vecesMostrada).toEqual(NO_APLICA);
    expect(post.vistas).toEqual(medido(11));
    expect(post.estado).toBe("terminada");
  });

  it("si lo promocionado ya no está, la campaña se lista igual y el gasto se conserva", () => {
    const { campanas, totales } = armar({
      listingsPorId: new Map(),
      postsPorId: new Map(),
    });
    expect(campanas).toHaveLength(2);
    expect(campanas[0].titulo).toBe("Ya no está disponible");
    expect(campanas[0].vistas).toEqual(NO_APLICA);
    expect(campanas[0].href).toBe("");
    // Borrar el aviso no borra lo que se pagó.
    expect(totales.pagadoCents).toBe(3500);
  });

  it("los totales cuentan activas, gasto y suman lo legible", () => {
    const { totales } = armar();
    expect(totales.activas).toBe(1);
    expect(totales.pagadoCents).toBe(3500);
    // Sólo el impulso aporta veces mostradas; el post no aplica y no contamina.
    expect(totales.vecesMostrada).toEqual(medido(240));
    expect(totales.vistas).toEqual(medido(28));
  });

  it("sin campañas, los totales no inventan números", () => {
    const { campanas, totales } = armar({ boosts: [], promociones: [] });
    expect(campanas).toHaveLength(0);
    expect(totales.activas).toBe(0);
    expect(totales.pagadoCents).toBe(0);
    expect(totales.vecesMostrada).toEqual(NO_APLICA);
    expect(totales.vistas).toEqual(NO_APLICA);
  });

  it("un importe nulo no rompe el total", () => {
    const { totales } = armar({
      boosts: [boost({ amount_cents: null })],
      promociones: [],
    });
    expect(totales.pagadoCents).toBe(0);
  });
});
