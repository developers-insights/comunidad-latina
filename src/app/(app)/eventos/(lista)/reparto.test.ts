import { describe, expect, it } from "vitest";
import type { EventCardModel } from "@/components/directory";
import {
  armarListado,
  corteDeVigencia,
  filtroDeVigentes,
  topeDePasados,
  unirVentanas,
  type EventRow,
} from "./reparto";

/**
 * F02: "Próximos" mostraba un evento que había terminado en agosto. Las tres
 * formas en que eso podía pasar quedan fijadas acá: sin próximos no había título
 * que separara los pasados, un boost activo subía un pasado a la franja de
 * arriba de todo, y el orden dependía de cómo venía la fila de la base.
 */
const NOW = new Date("2026-11-05T17:00:00Z");
const NY = "America/New_York";
const OPCIONES = { now: NOW, timeZone: NY, maxPasados: 5, maxPatrocinados: 4 };

function fila(id: string, startsAt: string | null, endsAt: string | null = null): EventRow {
  const card: EventCardModel = {
    id,
    title: id,
    venueArea: null,
    date: null,
    free: false,
    photoUrl: null,
    publisherTrust: null,
    publisherName: null,
  };
  return { card, startsAt, endsAt };
}

const FESTIVAL = fila("festival", "2026-08-15T16:00:00-04:00", "2026-08-15T22:00:00-04:00");
const MANANA = fila("manana", "2026-11-06T18:00:00-05:00");
const DICIEMBRE = fila("diciembre", "2026-12-20T18:00:00-05:00");
const SIN_FECHA = fila("sin-fecha", null);

const ids = (cards: readonly EventCardModel[]) => cards.map((c) => c.id);

describe("armarListado — vista por defecto", () => {
  it("un evento terminado no cae entre los próximos", () => {
    const listado = armarListado([FESTIVAL, MANANA], "", new Set(), OPCIONES);
    expect(ids(listado.proximos)).toEqual(["manana"]);
    expect(ids(listado.pasados)).toEqual(["festival"]);
  });

  it("si TODOS terminaron, avisa que no hay próximos y rotula los pasados", () => {
    const listado = armarListado([FESTIVAL], "", new Set(), OPCIONES);
    expect(ids(listado.proximos)).toEqual([]);
    expect(listado.sinProximos).toBe(true);
    expect(listado.rotularPasados).toBe(true);
  });

  it("un evento en curso sigue entre los próximos", () => {
    const enCurso = fila("en-curso", "2026-11-04T10:00:00-05:00", "2026-11-06T18:00:00-05:00");
    const listado = armarListado([enCurso], "", new Set(), OPCIONES);
    expect(ids(listado.proximos)).toEqual(["en-curso"]);
  });

  it("un evento sin fecha va al final de los próximos", () => {
    const listado = armarListado([SIN_FECHA, DICIEMBRE, MANANA], "", new Set(), OPCIONES);
    expect(ids(listado.proximos)).toEqual(["manana", "diciembre", "sin-fecha"]);
  });

  it("ordena por el instante real, no por cómo vino la fila", () => {
    // Mismo día, distinto offset: como TEXTO "T19:00-05:00" va antes que
    // "T22:00Z", pero como instante va después (es medianoche UTC).
    const a = fila("primero", "2026-11-06T22:00:00Z");
    const b = fila("segundo", "2026-11-06T19:00:00-05:00");
    const listado = armarListado([b, a], "", new Set(), OPCIONES);
    expect(ids(listado.proximos)).toEqual(["primero", "segundo"]);
  });

  it("los pasados van del más reciente al más viejo y con tope", () => {
    const viejos = [1, 2, 3, 4, 5, 6, 7].map((n) => fila(`v${n}`, `2026-0${n}-10T18:00:00Z`));
    const listado = armarListado(viejos, "", new Set(), OPCIONES);
    expect(ids(listado.pasados)).toEqual(["v7", "v6", "v5", "v4", "v3"]);
  });

  it("con próximos no hay aviso de vacío, pero los pasados siguen rotulados", () => {
    const listado = armarListado([FESTIVAL, MANANA], "", new Set(), OPCIONES);
    expect(listado.sinProximos).toBe(false);
    expect(listado.rotularPasados).toBe(true);
  });

  it("sin pasados no hay nada que rotular", () => {
    const listado = armarListado([MANANA], "", new Set(), OPCIONES);
    expect(listado.rotularPasados).toBe(false);
  });
});

describe("armarListado — patrocinados", () => {
  it("un boost activo no sube un evento terminado a la franja de arriba", () => {
    const listado = armarListado([FESTIVAL, MANANA], "", new Set(["festival"]), OPCIONES);
    expect(ids(listado.patrocinados)).toEqual([]);
    expect(ids(listado.pasados)).toEqual(["festival"]);
  });

  it("un próximo con boost sí va a la franja, y deja de repetirse abajo", () => {
    const listado = armarListado([MANANA, DICIEMBRE], "", new Set(["diciembre"]), OPCIONES);
    expect(ids(listado.patrocinados)).toEqual(["diciembre"]);
    expect(ids(listado.proximos)).toEqual(["manana"]);
  });

  it("un patrocinado cuenta como próximo: no hay aviso de vacío", () => {
    const listado = armarListado([MANANA], "", new Set(["manana"]), OPCIONES);
    expect(listado.sinProximos).toBe(false);
  });
});

describe("armarListado — filtros de fecha", () => {
  it("`pasados` muestra todos, sin tope, sin rótulo y sin aviso", () => {
    const viejos = [1, 2, 3, 4, 5, 6, 7].map((n) => fila(`v${n}`, `2026-0${n}-10T18:00:00Z`));
    const listado = armarListado([...viejos, MANANA], "pasados", new Set(), OPCIONES);
    expect(listado.pasados).toHaveLength(7);
    expect(listado.proximos).toEqual([]);
    expect(listado.rotularPasados).toBe(false);
    expect(listado.sinProximos).toBe(false);
  });

  it("`mes` deja afuera lo terminado y lo que no es de este mes", () => {
    const listado = armarListado([FESTIVAL, MANANA, DICIEMBRE], "mes", new Set(), OPCIONES);
    expect(ids(listado.proximos)).toEqual(["manana"]);
    expect(listado.pasados).toEqual([]);
  });

  it("`mes` decide el mes en la zona de quien mira, no en la del servidor", () => {
    // 20:00 del 30/11 en Nueva York ya es 1/12 en UTC.
    const finDeMes = new Date("2026-12-01T01:00:00Z");
    const evento = fila("fin-de-mes", "2026-12-01T00:30:00-05:00");
    const listado = armarListado([evento], "mes", new Set(), { ...OPCIONES, now: finDeMes });
    expect(ids(listado.proximos)).toEqual([]);
  });

  it("`mes` incluye uno que empezó el mes pasado y sigue en curso", () => {
    const feria = fila("feria", "2026-10-30T10:00:00-04:00", "2026-11-08T18:00:00-05:00");
    const listado = armarListado([feria], "mes", new Set(), OPCIONES);
    expect(ids(listado.proximos)).toEqual(["feria"]);
  });
});

describe("las dos ventanas de la consulta", () => {
  const TOPES = { maxEventos: 40, maxPasados: 5 };

  it("el corte queda 30 días antes: un evento largo que sigue en curso entra", () => {
    expect(corteDeVigencia(NOW)).toBe("2026-10-06T17:00:00.000Z");
  });

  it("los vigentes incluyen a los que no tienen fecha", () => {
    expect(filtroDeVigentes("2026-10-06T17:00:00.000Z")).toBe(
      'attrs->>starts_at.gte."2026-10-06T17:00:00.000Z",attrs->>starts_at.is.null',
    );
  });

  it("el tope de pasados sale del filtro: `mes` no los pide", () => {
    expect(topeDePasados("", TOPES)).toBe(5);
    expect(topeDePasados("pasados", TOPES)).toBe(40);
    expect(topeDePasados("mes", TOPES)).toBe(0);
  });

  it("une sin repetir, por si una fila cambió entre las dos lecturas", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    expect(unirVentanas([a, b], [{ id: "b" }]).map((fila) => fila.id)).toEqual(["a", "b"]);
    expect(unirVentanas(null, null)).toEqual([]);
  });

  /**
   * Lo que hace la base, en memoria. Con 60 eventos futuros, el `descendente` de
   * antes se quedaba con los 40 más lejanos y el de mañana desaparecía.
   */
  it("con más de 40 futuros siguen estando los más cercanos y los últimos pasados", () => {
    const dia = 86_400_000;
    const futuros = Array.from({ length: 60 }, (_, n) =>
      fila(`f${n}`, new Date(NOW.getTime() + (n + 1) * dia).toISOString()),
    );
    const viejos = Array.from({ length: 8 }, (_, n) =>
      fila(`p${n}`, new Date(NOW.getTime() - (40 + n) * dia).toISOString()),
    );
    const corte = corteDeVigencia(NOW);
    const conFecha = [...futuros, ...viejos];
    const vigentes = conFecha
      .filter((row) => row.startsAt! >= corte)
      .sort((a, b) => a.startsAt!.localeCompare(b.startsAt!))
      .slice(0, TOPES.maxEventos);
    const pasados = conFecha
      .filter((row) => row.startsAt! < corte)
      .sort((a, b) => b.startsAt!.localeCompare(a.startsAt!))
      .slice(0, TOPES.maxPasados);

    const filas = unirVentanas(
      vigentes.map((row) => ({ ...row, id: row.card.id })),
      pasados.map((row) => ({ ...row, id: row.card.id })),
    );
    const listado = armarListado(filas, "", new Set(), OPCIONES);

    expect(listado.proximos[0].id).toBe("f0");
    expect(listado.proximos).toHaveLength(40);
    expect(ids(listado.pasados)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  });
});
