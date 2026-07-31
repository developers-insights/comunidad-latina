import { describe, expect, it } from "vitest";
import { bucketFor, groupByRecency, RECENCY_ORDER } from "./recency";

/**
 * Reloj fijo: martes 30 de julio de 2026, 15:00 local. Todas las fechas de los
 * casos se construyen relativas a él — nada depende de cuándo corra el test.
 */
const NOW = new Date(2026, 6, 30, 15, 0, 0);

const at = (daysAgo: number, hour = 12) =>
  new Date(2026, 6, 30 - daysAgo, hour, 0, 0).toISOString();

const row = (createdAt: string, read = true) => ({ createdAt, read });

describe("bucketFor", () => {
  it("manda toda notificación SIN LEER a Nuevas, sin importar la fecha", () => {
    expect(bucketFor(row(at(0), false), NOW)).toBe("nuevas");
    expect(bucketFor(row(at(1), false), NOW)).toBe("nuevas");
    expect(bucketFor(row(at(45), false), NOW)).toBe("nuevas");
  });

  it("ubica las leídas por fecha", () => {
    expect(bucketFor(row(at(0)), NOW)).toBe("hoy");
    expect(bucketFor(row(at(1)), NOW)).toBe("ayer");
    expect(bucketFor(row(at(3)), NOW)).toBe("semana");
    expect(bucketFor(row(at(6)), NOW)).toBe("semana");
    expect(bucketFor(row(at(7)), NOW)).toBe("anteriores");
    expect(bucketFor(row(at(30)), NOW)).toBe("anteriores");
  });

  it("cuenta 'hoy' desde la medianoche local, no desde hace 24 horas", () => {
    // 00:30 de hoy es HOY aunque hayan pasado menos de 24 h desde ayer 20:00.
    expect(bucketFor(row(at(0, 0)), NOW)).toBe("hoy");
    // 23:59 de ayer sigue siendo AYER.
    expect(bucketFor(row(at(1, 23)), NOW)).toBe("ayer");
  });

  it("una fecha ilegible cae al fondo y nunca arriba", () => {
    expect(bucketFor(row("no soy una fecha"), NOW)).toBe("anteriores");
  });
});

describe("groupByRecency", () => {
  it("devuelve los tramos en orden y sólo los que tienen contenido", () => {
    const groups = groupByRecency(
      [row(at(0), false), row(at(0)), row(at(20))],
      NOW,
    );
    expect(groups.map((group) => group.bucket)).toEqual(["nuevas", "hoy", "anteriores"]);
  });

  it("no inventa encabezados vacíos", () => {
    const groups = groupByRecency([row(at(0))], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].bucket).toBe("hoy");
  });

  it("conserva el orden de entrada dentro de cada tramo", () => {
    const first = { createdAt: at(0, 14), read: true, id: "a" };
    const second = { createdAt: at(0, 9), read: true, id: "b" };
    const groups = groupByRecency([first, second], NOW);
    expect(groups[0].items.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("con la lista vacía no devuelve tramos", () => {
    expect(groupByRecency([], NOW)).toEqual([]);
  });

  it("reparte cada elemento en exactamente un tramo", () => {
    const items = [
      row(at(0), false),
      row(at(0)),
      row(at(1)),
      row(at(4)),
      row(at(90)),
    ];
    const groups = groupByRecency(items, NOW);
    const total = groups.reduce((sum, group) => sum + group.items.length, 0);
    expect(total).toBe(items.length);
    expect(RECENCY_ORDER).toContain(groups[0].bucket);
  });
});
