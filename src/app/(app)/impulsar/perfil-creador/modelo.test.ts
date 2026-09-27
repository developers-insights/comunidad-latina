import { describe, expect, it } from "vitest";
import {
  MAX_PATROCINADOS,
  impulsoVigente,
  separarPatrocinados,
  situacionDelCreador,
} from "./modelo";

const AHORA = Date.parse("2026-09-27T12:00:00.000Z");

describe("situacionDelCreador", () => {
  it("sin fila o sin solicitud es alguien que todavía no es creador", () => {
    expect(situacionDelCreador(null)).toBe("sin_perfil");
    expect(situacionDelCreador(undefined)).toBe("sin_perfil");
    expect(situacionDelCreador("not_requested")).toBe("sin_perfil");
  });

  it("sólo el aprobado puede comprar", () => {
    expect(situacionDelCreador("approved")).toBe("aprobado");
  });

  it("los cinco estados intermedios de la solicitud están en camino", () => {
    for (const status of [
      "application_started",
      "documents_pending",
      "stripe_review_pending",
      "platform_review_pending",
      "needs_info",
    ]) {
      expect(situacionDelCreador(status)).toBe("en_camino");
    }
  });

  it("suspendido o rechazado no puede promocionarse", () => {
    expect(situacionDelCreador("suspended")).toBe("no_disponible");
    expect(situacionDelCreador("rejected")).toBe("no_disponible");
  });

  it("un estado desconocido no habilita a pagar", () => {
    expect(situacionDelCreador("algo_nuevo")).toBe("no_disponible");
  });
});

describe("impulsoVigente", () => {
  it("devuelve el fin del impulso activo que todavía corre", () => {
    expect(
      impulsoVigente(
        [
          { status: "expired", ends_at: "2026-09-01T00:00:00.000Z" },
          { status: "active", ends_at: "2026-10-04T00:00:00.000Z" },
        ],
        AHORA,
      ),
    ).toBe("2026-10-04T00:00:00.000Z");
  });

  it("un active con la fecha vencida ya no está vigente", () => {
    expect(
      impulsoVigente([{ status: "active", ends_at: "2026-09-20T00:00:00.000Z" }], AHORA),
    ).toBeNull();
  });

  it("un pago pendiente no cuenta como vigente", () => {
    expect(impulsoVigente([{ status: "pending_payment", ends_at: null }], AHORA)).toBeNull();
  });

  it("con dos vigentes gana el que termina más tarde", () => {
    expect(
      impulsoVigente(
        [
          { status: "active", ends_at: "2026-10-01T00:00:00.000Z" },
          { status: "active", ends_at: "2026-10-10T00:00:00.000Z" },
        ],
        AHORA,
      ),
    ).toBe("2026-10-10T00:00:00.000Z");
  });
});

describe("separarPatrocinados", () => {
  const creadores = [
    { profileId: "a" },
    { profileId: "b" },
    { profileId: "c" },
    { profileId: "d" },
  ];

  it("saca a los patrocinados de la lista y los pone arriba en el orden recibido", () => {
    const { patrocinados, resto } = separarPatrocinados(creadores, ["c", "a"]);
    expect(patrocinados.map((c) => c.profileId)).toEqual(["c", "a"]);
    expect(resto.map((c) => c.profileId)).toEqual(["b", "d"]);
  });

  it("un patrocinado que no está en la lista se ignora sin romper nada", () => {
    const { patrocinados, resto } = separarPatrocinados(creadores, ["z", "b"]);
    expect(patrocinados.map((c) => c.profileId)).toEqual(["b"]);
    expect(resto).toHaveLength(3);
  });

  it("no repite a nadie aunque el id venga dos veces", () => {
    const { patrocinados } = separarPatrocinados(creadores, ["a", "a"]);
    expect(patrocinados.map((c) => c.profileId)).toEqual(["a"]);
  });

  it("topea los lugares pagos y devuelve el sobrante a su lugar orgánico", () => {
    const muchos = Array.from({ length: MAX_PATROCINADOS + 2 }, (_, i) => ({ profileId: `p${i}` }));
    const { patrocinados, resto } = separarPatrocinados(
      muchos,
      muchos.map((c) => c.profileId),
    );
    expect(patrocinados).toHaveLength(MAX_PATROCINADOS);
    expect(resto).toHaveLength(2);
  });
});
