import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { estaAbiertoAhora, estadosDeApertura, fetchHorariosDeNegocios } from "./horarios";

/**
 * Lo que se fija acá son las dos cosas que hacen que "Abiertos ahora" sea
 * confiable en un listado:
 *
 *   1. QUE NO SEA UN N+1. Treinta tarjetas no pueden ser sesenta consultas. Se
 *      ancla que `from()` se llama DOS veces (cabecera + tramos) sin importar
 *      cuántos negocios haya, y que sin ids no se consulta nada.
 *   2. EL BORDE DEL HORARIO. El minuto de apertura está dentro y el de cierre no
 *      (intervalo semiabierto), la zona que manda es la DEL NEGOCIO, y un
 *      negocio sin horario cargado NO cuenta como abierto.
 */

type StubResult = { data?: unknown; error?: unknown };

/**
 * Devuelve el resultado que corresponda según la tabla pedida. Un stub que
 * responde lo mismo a las dos consultas no probaría nada: el bug interesante es
 * justamente cruzar mal las cabeceras con los tramos.
 */
function createStub(porTabla: Record<string, StubResult>) {
  const from = vi.fn((tabla: string) => {
    const resultado = porTabla[tabla] ?? { data: [], error: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      select: vi.fn(() => builder),
      in: vi.fn(() => builder),
      order: vi.fn(() => builder),
      then: (resolve: (v: StubResult) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(resultado).then(resolve, reject),
    };
    return builder;
  });
  return { client: { from } as unknown, fromSpy: from };
}

const NEGOCIO_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NEGOCIO_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchHorariosDeNegocios — sin N+1", () => {
  it("sin ids no consulta nada", async () => {
    const stub = createStub({});
    const horarios = await fetchHorariosDeNegocios(stub.client, []);

    expect(horarios.size).toBe(0);
    expect(stub.fromSpy).not.toHaveBeenCalled();
  });

  it("DOS consultas para toda la página, sin importar cuántos negocios sean", async () => {
    const stub = createStub({
      listing_hours: {
        data: [
          { listing_id: NEGOCIO_A, time_zone: "America/New_York" },
          { listing_id: NEGOCIO_B, time_zone: "America/Los_Angeles" },
        ],
        error: null,
      },
      listing_hours_slots: {
        data: [
          { listing_id: NEGOCIO_A, weekday: 1, opens_at: "09:00:00", closes_at: "18:00:00" },
          { listing_id: NEGOCIO_A, weekday: 2, opens_at: "09:00:00", closes_at: "18:00:00" },
          { listing_id: NEGOCIO_B, weekday: 1, opens_at: "20:00:00", closes_at: "02:00:00" },
        ],
        error: null,
      },
    });

    const ids = Array.from({ length: 30 }, (_, i) =>
      i === 0 ? NEGOCIO_A : i === 1 ? NEGOCIO_B : `id-${i}`,
    );
    const horarios = await fetchHorariosDeNegocios(stub.client, ids);

    // Una por tabla. Treinta negocios, dos consultas.
    expect(stub.fromSpy).toHaveBeenCalledTimes(2);
    expect(stub.fromSpy).toHaveBeenCalledWith("listing_hours");
    expect(stub.fromSpy).toHaveBeenCalledWith("listing_hours_slots");

    expect(horarios.get(NEGOCIO_A)?.timeZone).toBe("America/New_York");
    expect(horarios.get(NEGOCIO_A)?.tramos).toHaveLength(2);
    expect(horarios.get(NEGOCIO_B)?.tramos).toHaveLength(1);
    // Un negocio sin fila en listing_hours no entra al Map: no publicó horarios.
    expect(horarios.has("id-5")).toBe(false);
  });

  it("un tramo sin cabecera legible se descarta: sin zona no hay cómo interpretarlo", async () => {
    const stub = createStub({
      listing_hours: { data: [{ listing_id: NEGOCIO_A, time_zone: "" }], error: null },
      listing_hours_slots: {
        data: [
          { listing_id: NEGOCIO_A, weekday: 1, opens_at: "09:00:00", closes_at: "18:00:00" },
        ],
        error: null,
      },
    });

    const horarios = await fetchHorariosDeNegocios(stub.client, [NEGOCIO_A]);
    expect(horarios.size).toBe(0);
  });

  it("si la consulta falla, degrada a Map vacío en vez de romper el directorio", async () => {
    const stub = createStub({
      listing_hours: { data: null, error: { code: "500" } },
      listing_hours_slots: { data: [], error: null },
    });

    const horarios = await fetchHorariosDeNegocios(stub.client, [NEGOCIO_A]);
    expect(horarios.size).toBe(0);
  });
});

describe("estadosDeApertura — el borde del horario", () => {
  const horarios = new Map([
    [
      NEGOCIO_A,
      {
        timeZone: "America/New_York",
        tramos: [{ weekday: 1 as const, opensAt: "09:00", closesAt: "18:00" }],
      },
    ],
  ]);

  /** Lunes 2026-08-24, a la hora de Nueva York que se indique (EDT = UTC-4). */
  const lunesNY = (hora: string) => new Date(`2026-08-24T${hora}:00-04:00`);

  it("el minuto de APERTURA ya está abierto (intervalo semiabierto)", () => {
    const estados = estadosDeApertura(horarios, lunesNY("09:00"));
    expect(estados.get(NEGOCIO_A)?.estado).toBe("abierto");
    expect(estaAbiertoAhora(estados.get(NEGOCIO_A))).toBe(true);
  });

  it("un minuto ANTES de abrir todavía está cerrado", () => {
    const estados = estadosDeApertura(horarios, lunesNY("08:59"));
    expect(estados.get(NEGOCIO_A)?.estado).toBe("cerrado");
    expect(estaAbiertoAhora(estados.get(NEGOCIO_A))).toBe(false);
  });

  it("el último minuto antes del cierre sigue abierto", () => {
    const estados = estadosDeApertura(horarios, lunesNY("17:59"));
    expect(estados.get(NEGOCIO_A)?.estado).toBe("abierto");
  });

  it("el minuto de CIERRE ya está cerrado", () => {
    const estados = estadosDeApertura(horarios, lunesNY("18:00"));
    expect(estados.get(NEGOCIO_A)?.estado).toBe("cerrado");
    expect(estaAbiertoAhora(estados.get(NEGOCIO_A))).toBe(false);
  });

  it("manda el reloj DEL NEGOCIO, no el de quien mira", () => {
    // Las 09:30 de Nueva York son las 06:30 en Los Ángeles. El mismo instante,
    // con el mismo horario declarado, da ABIERTO en NY y CERRADO en LA.
    const enNuevaYork = new Map([[NEGOCIO_A, horarios.get(NEGOCIO_A)!]]);
    const enLosAngeles = new Map([
      [
        NEGOCIO_A,
        { timeZone: "America/Los_Angeles", tramos: horarios.get(NEGOCIO_A)!.tramos },
      ],
    ]);
    const instante = lunesNY("09:30");

    expect(estadosDeApertura(enNuevaYork, instante).get(NEGOCIO_A)?.estado).toBe("abierto");
    expect(estadosDeApertura(enLosAngeles, instante).get(NEGOCIO_A)?.estado).toBe("cerrado");
  });

  it("un tramo que cruza la medianoche sigue abierto pasada la medianoche", () => {
    const nocturno = new Map([
      [
        NEGOCIO_B,
        {
          timeZone: "America/New_York",
          tramos: [{ weekday: 1 as const, opensAt: "20:00", closesAt: "02:00" }],
        },
      ],
    ]);
    // Martes 01:30 de NY: dentro del tramo que arrancó el lunes a las 20:00.
    const estados = estadosDeApertura(nocturno, new Date("2026-08-25T01:30:00-04:00"));
    expect(estados.get(NEGOCIO_B)?.estado).toBe("abierto");
  });
});

describe("estaAbiertoAhora — qué cuenta para el filtro", () => {
  it("sólo 'abierto' cuenta como abierto", () => {
    expect(estaAbiertoAhora({ estado: "abierto", cierraA: "18:00", tramo: { weekday: 1, opensAt: "09:00", closesAt: "18:00" } })).toBe(true);
    expect(estaAbiertoAhora({ estado: "cerrado", abreA: "09:00", abreDia: 1 })).toBe(false);
    // "No cargó horarios" NO es "abierto": no se sabe nada de ese negocio.
    expect(estaAbiertoAhora({ estado: "sin_horario" })).toBe(false);
    expect(estaAbiertoAhora({ estado: "zona_desconocida" })).toBe(false);
    expect(estaAbiertoAhora(null)).toBe(false);
    expect(estaAbiertoAhora(undefined)).toBe(false);
  });
});
