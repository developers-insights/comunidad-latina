import { describe, expect, it, vi } from "vitest";
import { eventDateParts } from "@/components/directory/helpers";
import { DEFAULT_TIME_ZONE, formatDate } from "@/lib/utils";

/**
 * LA ZONA DE QUIEN MIRA, DE PUNTA A PUNTA.
 *
 * `utils.test.ts` ya cuida que el formateo no dependa del reloj del RUNTIME.
 * Esto cuida lo otro: que sí dependa del reloj de la PERSONA, y que haya
 * exactamente una excepción a esa regla.
 *
 *   · Un INSTANTE cerca de la medianoche cae en días distintos según quién lo
 *     lea. Nueva York y Los Ángeles tienen que ver días distintos — si vieran el
 *     mismo, la zona del lector no está llegando a ningún lado.
 *   · Una FECHA SIN HORA (`2026-07-06`) no es un instante: es un día del
 *     calendario, y tiene que salir igual para todo el mundo. Restarle un día a
 *     alguien en Los Ángeles al pie de un trámite oficial es publicar un dato
 *     falso, y es exactamente lo que pasaría si la zona del lector la pisara.
 *
 * Las dos mitades tienen que fallar por separado: un arreglo que gane una y
 * pierda la otra no es un arreglo.
 */

const NUEVA_YORK = DEFAULT_TIME_ZONE;
const LOS_ANGELES = "America/Los_Angeles";

/**
 * 05:30 UTC del 1 de agosto = 01:30 del 1 de agosto en Nueva York y 22:30 del
 * 31 de julio en Los Ángeles. El caso real: alguien publica de noche en la costa
 * oeste y la app le fecha la publicación al día siguiente.
 */
const LATE_NIGHT_IN_LA = "2026-08-01T05:30:00Z";

/** Un día del calendario, sin hora: `checked_at` de las guías, días de métricas. */
const CALENDAR_DAY = "2026-07-06";

describe("un instante se lee con el reloj de quien mira", () => {
  it("Nueva York y Los Ángeles ven DÍAS distintos del mismo instante", () => {
    const enNuevaYork = formatDate(LATE_NIGHT_IN_LA, {
      style: "medium",
      timeZone: NUEVA_YORK,
    });
    const enLosAngeles = formatDate(LATE_NIGHT_IN_LA, {
      style: "medium",
      timeZone: LOS_ANGELES,
    });

    expect(enNuevaYork).toBe("1 ago 2026");
    expect(enLosAngeles).toBe("31 jul 2026");
    expect(enLosAngeles).not.toBe(enNuevaYork);
  });

  it("la hora también, no solo el día", () => {
    const opciones = { style: "short", withTime: true } as const;
    expect(formatDate(LATE_NIGHT_IN_LA, { ...opciones, timeZone: NUEVA_YORK })).toContain("1:30");
    expect(formatDate(LATE_NIGHT_IN_LA, { ...opciones, timeZone: LOS_ANGELES })).toContain("10:30");
  });

  it("sin zona explícita cae a la de la comunidad, nunca al reloj del runtime", () => {
    expect(formatDate(LATE_NIGHT_IN_LA, { style: "medium" })).toBe(
      formatDate(LATE_NIGHT_IN_LA, { style: "medium", timeZone: DEFAULT_TIME_ZONE }),
    );
  });
});

describe("una fecha SIN hora se lee igual en todas partes", () => {
  it("Nueva York y Los Ángeles ven el MISMO día", () => {
    const enNuevaYork = formatDate(CALENDAR_DAY, { style: "medium", timeZone: NUEVA_YORK });
    const enLosAngeles = formatDate(CALENDAR_DAY, { style: "medium", timeZone: LOS_ANGELES });

    expect(enNuevaYork).toBe("6 jul 2026");
    expect(enLosAngeles).toBe(enNuevaYork);
  });

  it("ninguna zona del catálogo le corre el día", () => {
    const zonas = [NUEVA_YORK, LOS_ANGELES, "Pacific/Honolulu", "Europe/Madrid", "Asia/Tokyo"];
    const resultados = new Set(
      zonas.map((timeZone) => formatDate(CALENDAR_DAY, { style: "long", timeZone })),
    );
    expect([...resultados]).toEqual(["6 de julio de 2026"]);
  });
});

describe("eventos: la misma regla, con la hora del evento adentro", () => {
  it("un evento nocturno cae en días distintos según quién lo mire", () => {
    const enNuevaYork = eventDateParts(LATE_NIGHT_IN_LA, "es-US", NUEVA_YORK);
    const enLosAngeles = eventDateParts(LATE_NIGHT_IN_LA, "es-US", LOS_ANGELES);

    expect(enNuevaYork?.day).toBe("1");
    expect(enNuevaYork?.month).toBe("AGO");
    expect(enLosAngeles?.day).toBe("31");
    expect(enLosAngeles?.month).toBe("JUL");
    expect(enLosAngeles?.time).not.toBe(enNuevaYork?.time);
  });

  it("un evento anunciado como día suelto NO se corre para nadie", () => {
    const enNuevaYork = eventDateParts(CALENDAR_DAY, "es-US", NUEVA_YORK);
    const enLosAngeles = eventDateParts(CALENDAR_DAY, "es-US", LOS_ANGELES);

    expect(enNuevaYork?.day).toBe("6");
    expect(enLosAngeles?.day).toBe("6");
    expect(enLosAngeles?.full).toBe(enNuevaYork?.full);
    // Sin hora no se inventa una: el bloque de hora queda vacío.
    expect(enNuevaYork?.time).toBe("");
  });
});

describe("getViewerFormatDate: la elección de la persona manda", () => {
  /** Mock del cliente Supabase: sólo lo que `viewer-zone.ts` realmente toca. */
  function stubSupabase(userId: string | null, timezone: string | null) {
    const maybeSingle = vi.fn(async () => ({
      data: { timezone, account_status: "active", suspended_until: null },
      error: null,
    }));
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const getUser = vi.fn(async () => ({
      data: { user: userId ? { id: userId } : null },
      error: null,
    }));
    return { auth: { getUser }, from };
  }

  async function formatterFor(timezone: string | null) {
    vi.resetModules();
    const createClient = vi.fn(async () => stubSupabase(timezone === null ? null : "u1", timezone));
    vi.doMock("@/lib/supabase/server", () => ({ createClient }));
    const { getViewerFormatDate } = await import("@/lib/time/viewer-zone");
    return getViewerFormatDate();
  }

  it("formatea en la zona que la persona eligió", async () => {
    const format = await formatterFor(LOS_ANGELES);
    expect(format(LATE_NIGHT_IN_LA, { style: "medium" })).toBe("31 jul 2026");
  });

  it("sin elección cae a la zona de la comunidad (el server no ve el navegador)", async () => {
    const format = await formatterFor(null);
    expect(format(LATE_NIGHT_IN_LA, { style: "medium" })).toBe("1 ago 2026");
  });

  it("ni siquiera la zona elegida le corre el día a una fecha sin hora", async () => {
    const format = await formatterFor(LOS_ANGELES);
    expect(format(CALENDAR_DAY, { style: "medium" })).toBe("6 jul 2026");
  });
});
