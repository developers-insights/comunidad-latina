import { describe, expect, it } from "vitest";
import { ADMIN_TIME_ZONE, formatAdminDate, formatAdminDateTime } from "./format";

/**
 * El punto de estos tests NO es "formatea lindo": es que el resultado NO dependa
 * de la zona horaria del proceso. Vitest corre acá con la zona de la máquina y
 * en Vercel el server corre en UTC; si el formateo mirara el reloj del runtime,
 * el server y el navegador de quien modera desde NY escribirían strings
 * distintos para el mismo instante (React #418) y la fecha mostrada sería la de
 * otro día.
 *
 * `2026-08-01T02:00:00Z` está elegido a propósito: en UTC ya es 1 de agosto,
 * pero en America/New_York (EDT, UTC-4) todavía son las 22:00 del 31 de julio.
 * Un formateo sin `timeZone` fijo contesta distinto según dónde corra.
 */
const CROSSES_MIDNIGHT_IN_UTC = "2026-08-01T02:00:00Z";

describe("formatAdminDate", () => {
  it("usa la zona de la comunidad y no la del runtime", () => {
    // Si alguien saca el timeZone, en un server UTC esto devuelve "1 ago 2026".
    expect(formatAdminDate(CROSSES_MIDNIGHT_IN_UTC)).toBe("31 jul 2026");
  });

  it("da el mismo string sin importar la zona del proceso", () => {
    const original = process.env.TZ;
    const seen = new Set<string>();
    for (const zone of ["UTC", "America/New_York", "Asia/Tokyo", "America/Buenos_Aires"]) {
      process.env.TZ = zone;
      seen.add(formatAdminDate(CROSSES_MIDNIGHT_IN_UTC));
    }
    process.env.TZ = original;
    expect(seen.size).toBe(1);
  });

  it("devuelve vacío con una fecha inválida en vez de romper la fila", () => {
    expect(formatAdminDate("no-es-una-fecha")).toBe("");
  });
});

describe("formatAdminDateTime", () => {
  it("ancla también la hora a la zona de la comunidad", () => {
    // 02:00 UTC = 22:00 del día anterior en Nueva York.
    const formatted = formatAdminDateTime(CROSSES_MIDNIGHT_IN_UTC);
    expect(formatted).toContain("31 jul");
    expect(formatted).toContain("10:00");
  });

  it("devuelve vacío con una fecha inválida", () => {
    expect(formatAdminDateTime("")).toBe("");
  });
});

describe("ADMIN_TIME_ZONE", () => {
  it("es una zona IANA que Intl acepta", () => {
    expect(() =>
      new Intl.DateTimeFormat("es-US", { timeZone: ADMIN_TIME_ZONE }).format(new Date()),
    ).not.toThrow();
  });
});
