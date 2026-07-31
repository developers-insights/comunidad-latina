import { describe, expect, it } from "vitest";
import {
  HISTORY_LIMIT,
  historyStorageKey,
  parseHistory,
  pushHistory,
  removeFromHistory,
} from "./history";

describe("historyStorageKey", () => {
  it("separa el cajón por comunidad Y por persona (teléfono compartido)", () => {
    expect(historyStorageKey("dominicanos", "u-1")).toBe(
      "cl:buscar:historial:dominicanos:u-1",
    );
    expect(historyStorageKey("dominicanos", "u-2")).not.toBe(
      historyStorageKey("dominicanos", "u-1"),
    );
    expect(historyStorageKey("venezolanos", "u-1")).not.toBe(
      historyStorageKey("dominicanos", "u-1"),
    );
  });

  it("las sesiones sin login comparten el cajón anónimo", () => {
    expect(historyStorageKey("dominicanos", null)).toBe(
      "cl:buscar:historial:dominicanos:anon",
    );
  });
});

describe("parseHistory", () => {
  it("devuelve vacío ante null, JSON roto o algo que no es arreglo", () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory("{no es json")).toEqual([]);
    expect(parseHistory('{"a":1}')).toEqual([]);
    expect(parseHistory('"cuarto"')).toEqual([]);
  });

  it("descarta las entradas que no son texto usable sin tirar el resto", () => {
    expect(parseHistory('["cuarto", 42, null, "  ", {"x":1}, "silla"]')).toEqual([
      "cuarto",
      "silla",
    ]);
  });

  it("deduplica sin distinguir mayúsculas", () => {
    expect(parseHistory('["Cuarto", "cuarto", "CUARTO"]')).toEqual(["Cuarto"]);
  });

  it("nunca devuelve más de las últimas 8", () => {
    const many = JSON.stringify(Array.from({ length: 30 }, (_, i) => `t${i}`));
    expect(parseHistory(many)).toHaveLength(HISTORY_LIMIT);
  });
});

describe("pushHistory", () => {
  it("agrega al frente", () => {
    expect(pushHistory(["a"], "b")).toEqual(["b", "a"]);
  });

  it("mueve al frente lo repetido en vez de duplicarlo", () => {
    expect(pushHistory(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
  });

  it("conserva la escritura más reciente al repetir con otras mayúsculas", () => {
    expect(pushHistory(["cuarto"], "Cuarto")).toEqual(["Cuarto"]);
  });

  it("normaliza antes de guardar (no entran dos veces por un espacio de más)", () => {
    expect(pushHistory([], "  cuarto   barato ")).toEqual(["cuarto barato"]);
    expect(pushHistory(["cuarto barato"], "cuarto  barato")).toEqual(["cuarto barato"]);
  });

  it("recorta a 8 tirando lo más viejo", () => {
    const full = Array.from({ length: HISTORY_LIMIT }, (_, i) => `t${i}`);
    const next = pushHistory(full, "nuevo");
    expect(next).toHaveLength(HISTORY_LIMIT);
    expect(next[0]).toBe("nuevo");
    expect(next).not.toContain(`t${HISTORY_LIMIT - 1}`);
  });

  it("ignora un término vacío", () => {
    expect(pushHistory(["a"], "   ")).toEqual(["a"]);
  });
});

describe("removeFromHistory", () => {
  it("quita sólo el término pedido", () => {
    expect(removeFromHistory(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("quita sin distinguir mayúsculas ni espacios de más", () => {
    expect(removeFromHistory(["Cuarto barato"], "  cuarto  barato ")).toEqual([]);
  });

  it("no rompe si el término no está", () => {
    expect(removeFromHistory(["a"], "z")).toEqual(["a"]);
  });
});
