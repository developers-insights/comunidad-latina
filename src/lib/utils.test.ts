import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_TIME_ZONE, formatDate, formatMoney } from "./utils";

/**
 * Lo que cuidan estos tests no es que la fecha quede linda: es que el resultado
 * NO dependa de la zona horaria del proceso.
 *
 * En Vercel el server corre en UTC y el navegador de la persona corre en su
 * zona. Si el formateo mirara el reloj del runtime, el HTML del server y el
 * primer render del cliente serían strings distintos para el MISMO instante:
 * mismatch de hidratación (React #418) y, peor, una fecha corrida un día.
 *
 * OJO CON EL FALSO VERDE: la máquina de desarrollo está en UTC-3, donde el caso
 * de abajo da la fecha correcta por casualidad. Por eso no alcanza con afirmar
 * el string esperado — hay que ROTAR `process.env.TZ` y exigir un único
 * resultado. Ese es el test que de verdad falla si alguien saca el `timeZone`.
 */
const ZONES = ["UTC", "America/New_York", "Asia/Tokyo", "America/Los_Angeles", "Pacific/Kiritimati"];

/** 02:00 UTC del 1 de agosto = 22:00 del 31 de julio en Nueva York. */
const CROSSES_MIDNIGHT_IN_UTC = "2026-08-01T02:00:00Z";

/** Corre `run` bajo cada zona y devuelve el conjunto de resultados distintos. */
function acrossTimeZones(run: () => string): Set<string> {
  const original = process.env.TZ;
  const seen = new Set<string>();
  try {
    for (const zone of ZONES) {
      process.env.TZ = zone;
      seen.add(run());
    }
  } finally {
    process.env.TZ = original;
  }
  return seen;
}

afterEach(() => {
  delete process.env.TZ;
});

describe("formatDate — instantes", () => {
  it("ancla el instante a la zona de la comunidad, no a la del runtime", () => {
    expect(formatDate(CROSSES_MIDNIGHT_IN_UTC, { style: "medium" })).toBe("31 jul 2026");
  });

  it("da el MISMO string en cualquier zona del proceso", () => {
    const seen = acrossTimeZones(() =>
      formatDate(CROSSES_MIDNIGHT_IN_UTC, { style: "medium" }),
    );
    expect([...seen]).toEqual(["31 jul 2026"]);
  });

  it("también fija la zona cuando se pide la hora", () => {
    const seen = acrossTimeZones(() =>
      formatDate(CROSSES_MIDNIGHT_IN_UTC, { style: "short", withTime: true }),
    );
    expect(seen.size).toBe(1);
  });

  it("acepta Date y number igual que un ISO string", () => {
    const instant = new Date(CROSSES_MIDNIGHT_IN_UTC);
    expect(acrossTimeZones(() => formatDate(instant, { style: "medium" })).size).toBe(1);
    expect(acrossTimeZones(() => formatDate(instant.getTime(), { style: "medium" })).size).toBe(1);
  });

  it("respeta una zona explícita por encima del default", () => {
    // Mismo instante, leído en Tokio: ahí ya es el 1 de agosto.
    expect(
      formatDate(CROSSES_MIDNIGHT_IN_UTC, { style: "medium", timeZone: "Asia/Tokyo" }),
    ).toBe("1 ago 2026");
  });
});

describe("formatDate — fechas SIN hora", () => {
  /**
   * Las guías guardan `checked_at: "2026-07-06"` y lo muestran como "Fuentes
   * consultadas al …" al pie de un trámite oficial. Una fecha sin hora es un día
   * del calendario, no un instante: mostrar el día anterior sería publicar un
   * dato falso. `new Date("2026-07-06")` es medianoche UTC, así que formatearla
   * en una zona al oeste la corre al día 5.
   */
  const CALENDAR_DAY = "2026-07-06";

  it("muestra el MISMO día que dice el dato, sin correrlo", () => {
    expect(formatDate(CALENDAR_DAY, { style: "medium" })).toBe("6 jul 2026");
  });

  it("no se corre en ninguna zona del proceso", () => {
    expect([...acrossTimeZones(() => formatDate(CALENDAR_DAY, { style: "medium" }))]).toEqual([
      "6 jul 2026",
    ]);
  });

  it("un ISO completo a medianoche UTC sí es un instante y se lee en la zona de la comunidad", () => {
    // Contraste deliberado con el caso de arriba: acá el dato SÍ trae hora, así
    // que 00:00Z son las 20:00 del día anterior en Nueva York.
    expect(formatDate("2026-07-06T00:00:00Z", { style: "medium" })).toBe("5 jul 2026");
  });
});

describe("formatDate — bordes", () => {
  it("devuelve vacío ante una fecha inválida en vez de romper la pantalla", () => {
    expect(formatDate("no-es-una-fecha")).toBe("");
    expect(formatDate("")).toBe("");
    expect(formatDate(Number.NaN)).toBe("");
  });
});

describe("DEFAULT_TIME_ZONE", () => {
  it("es una zona IANA que Intl acepta", () => {
    expect(() =>
      new Intl.DateTimeFormat("es-US", { timeZone: DEFAULT_TIME_ZONE }).format(new Date()),
    ).not.toThrow();
  });
});

describe("formatMoney", () => {
  it("omite los centavos cuando el monto es entero", () => {
    expect(formatMoney(1200)).toBe("$1,200");
  });

  it("los muestra si se piden o si el monto los tiene", () => {
    expect(formatMoney(1200, { showCents: true })).toBe("$1,200.00");
    expect(formatMoney(1200.5)).toBe("$1,200.50");
  });
});
