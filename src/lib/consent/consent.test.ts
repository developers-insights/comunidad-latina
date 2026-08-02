// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CATEGORY_META,
  CONSENT_STORAGE_KEY,
  CONSENT_VERSION,
  GATED_CATEGORIES,
  OPT_IN_CATEGORIES,
  TRACKERS,
  acceptAll,
  categoriesNeedingConsent,
  defaultGrants,
  hasConsent,
  isFresh,
  needsDecision,
  parseConsent,
  readConsent,
  rejectAll,
  resolveGrants,
  revokeConsent,
  saveConsent,
  trackersOf,
  whenConsented,
} from "./index";
import { __resetListeners } from "./store";

beforeEach(() => {
  window.localStorage.clear();
  __resetListeners();
});

describe("qué se pide y qué no", () => {
  it("HOY no hay nada que consentir: ni analítica ni marketing tienen trazadores vivos", () => {
    // Este es el hecho que justifica no mostrar banner. Si algún día falla, es
    // porque entró un trazador nuevo — y entonces el banner DEBE aparecer.
    expect(categoriesNeedingConsent()).toEqual([]);
    expect(trackersOf("analitica")).toEqual([]);
    expect(trackersOf("marketing")).toEqual([]);
  });

  it("sin nada que consentir, nunca se le pregunta a nadie", () => {
    expect(needsDecision(null)).toBe(false);
  });

  it("cuando entre un trazador de analítica, habrá que preguntar", () => {
    // Se simula el futuro sin tocar el registro real: si esta derivación se
    // rompiera, el banner nunca aparecería y el gate sería decorativo.
    const conAnalitica = OPT_IN_CATEGORIES.filter((c) =>
      [...TRACKERS, { category: "analitica" as const, dormant: undefined }].some(
        (t) => t.category === c && t.dormant === undefined,
      ),
    );
    expect(conAnalitica).toContain("analitica");
  });

  it("un trazador DORMIDO no dispara el banner", () => {
    // Pedir permiso para algo que no ocurre entrena a aceptar sin leer.
    const dormidos = TRACKERS.filter((t) => t.dormant !== undefined);
    expect(dormidos.length).toBeGreaterThan(0);
    for (const t of dormidos) {
      expect(categoriesNeedingConsent()).not.toContain(t.category);
    }
  });
});

describe("defaults", () => {
  it("las categorías de opt-in NACEN APAGADAS — siempre", () => {
    const grants = defaultGrants();
    for (const category of OPT_IN_CATEGORIES) {
      expect(grants[category]).toBe(false);
    }
  });

  it("sin decisión guardada, no hay permiso de analítica ni de marketing", () => {
    for (const category of OPT_IN_CATEGORIES) {
      expect(hasConsent(category)).toBe(false);
    }
  });

  it("lo necesario siempre está permitido", () => {
    expect(hasConsent("necesarias")).toBe(true);
  });

  it("las preferencias vienen activas: están exentas de consentimiento", () => {
    expect(CATEGORY_META.preferencias.policy).toBe("activa-por-defecto");
    expect(hasConsent("preferencias")).toBe(true);
  });
});

describe("rechazar cuesta lo mismo que aceptar", () => {
  it("rejectAll deja en false todo lo que requiere opt-in", () => {
    acceptAll();
    for (const category of OPT_IN_CATEGORIES) expect(hasConsent(category)).toBe(true);

    rejectAll();
    for (const category of OPT_IN_CATEGORIES) expect(hasConsent(category)).toBe(false);
  });

  it("rejectAll deja una decisión guardada, no un vacío", () => {
    // Si rechazar no guardara nada, se volvería a preguntar en cada visita:
    // el clásico banner que reaparece hasta que cedés.
    rejectAll();
    const record = readConsent();
    expect(record).not.toBeNull();
    expect(record?.version).toBe(CONSENT_VERSION);
  });

  it("rejectAll NO apaga las preferencias, que no son consentibles", () => {
    rejectAll();
    expect(hasConsent("preferencias")).toBe(true);
  });
});

describe("prueba de cuándo se consintió", () => {
  it("guarda versión y fecha ISO", () => {
    const record = acceptAll();
    expect(record.version).toBe(CONSENT_VERSION);
    expect(Number.isNaN(Date.parse(record.decidedAt))).toBe(false);
  });

  it("un consentimiento de más de un año deja de valer", () => {
    const viejo = {
      version: CONSENT_VERSION,
      decidedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
      granted: { analitica: true },
    };
    expect(isFresh(viejo)).toBe(false);
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(viejo));
    expect(readConsent()).toBeNull();
    expect(hasConsent("analitica")).toBe(false);
  });

  it("subir la versión del inventario invalida lo guardado", () => {
    const previo = {
      version: CONSENT_VERSION - 1,
      decidedAt: new Date().toISOString(),
      granted: { analitica: true },
    };
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(previo));
    expect(readConsent()).toBeNull();
    expect(hasConsent("analitica")).toBe(false);
  });
});

describe("parseo tolerante — ante la duda, NO consintió", () => {
  it.each([
    ["nulo", null],
    ["basura", "no soy json"],
    ["array", "[]"],
    ["sin versión", '{"decidedAt":"2026-01-01T00:00:00.000Z","granted":{}}'],
    ["sin fecha", '{"version":1,"granted":{}}'],
    ["fecha inválida", '{"version":1,"decidedAt":"ayer","granted":{}}'],
    ["granted nulo", '{"version":1,"decidedAt":"2026-01-01T00:00:00.000Z","granted":null}'],
  ])("%s → null", (_caso, raw) => {
    expect(parseConsent(raw)).toBeNull();
  });

  it("descarta categorías inventadas y valores no booleanos", () => {
    const record = parseConsent(
      JSON.stringify({
        version: CONSENT_VERSION,
        decidedAt: new Date().toISOString(),
        granted: { analitica: "sí", inventada: true, marketing: true },
      }),
    );
    expect(record?.granted).toEqual({ marketing: true });
    // "sí" no es `true`: un string no puede colarse como consentimiento.
    expect(resolveGrants(record).analitica).toBe(false);
  });
});

describe("el gate", () => {
  it("whenConsented no ejecuta nada sin permiso", () => {
    const cargarScript = vi.fn();
    whenConsented("analitica", cargarScript);
    expect(cargarScript).not.toHaveBeenCalled();
  });

  it("whenConsented dispara cuando llega el permiso, sin recargar", () => {
    const cargarScript = vi.fn();
    whenConsented("analitica", cargarScript);
    expect(cargarScript).not.toHaveBeenCalled();

    acceptAll();
    expect(cargarScript).toHaveBeenCalledTimes(1);
  });

  it("whenConsented ejecuta UNA sola vez aunque se vuelva a guardar", () => {
    const cargarScript = vi.fn();
    whenConsented("analitica", cargarScript);
    acceptAll();
    saveConsent({ marketing: true });
    acceptAll();
    // Dos cargas del mismo script = cada evento contado dos veces.
    expect(cargarScript).toHaveBeenCalledTimes(1);
  });

  it("lo necesario corre siempre, sin esperar a nadie", () => {
    const run = vi.fn();
    whenConsented("necesarias", run);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("snapshot estable (regresión: bucle infinito de render)", () => {
  // `useSyncExternalStore` compara POR IDENTIDAD. Cuando `readConsent()`
  // devolvía un objeto nuevo en cada llamada, React re-renderizaba sin parar y
  // la app se caía con "Maximum update depth exceeded" — pero SÓLO después de
  // que alguien tocara Aceptar o Rechazar, porque sin decisión devuelve `null`,
  // que sí es estable. Lo encontró el test del banner, no la lectura del código.
  it("dos lecturas seguidas devuelven LA MISMA referencia", () => {
    acceptAll();
    expect(readConsent()).toBe(readConsent());
  });

  it("pero cambia de referencia cuando cambia la decisión", () => {
    acceptAll();
    const antes = readConsent();
    rejectAll();
    expect(readConsent()).not.toBe(antes);
    expect(readConsent()?.granted.analitica).toBe(false);
  });

  it("se entera de un cambio hecho por otra pestaña", () => {
    acceptAll();
    const antes = readConsent();
    // Otra pestaña escribe directo en el storage, sin pasar por este módulo.
    window.localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({
        version: CONSENT_VERSION,
        decidedAt: new Date().toISOString(),
        granted: { analitica: false },
      }),
    );
    expect(readConsent()).not.toBe(antes);
    expect(hasConsent("analitica")).toBe(false);
  });
});

describe("revocar", () => {
  it("borra la decisión y vuelve a los defaults", () => {
    acceptAll();
    expect(hasConsent("analitica")).toBe(true);

    revokeConsent();
    expect(readConsent()).toBeNull();
    expect(hasConsent("analitica")).toBe(false);
  });
});

describe("el registro no puede mentir", () => {
  it("toda categoría declarada tiene metadatos con etiqueta y resumen", () => {
    for (const category of GATED_CATEGORIES) {
      expect(CATEGORY_META[category].label.length).toBeGreaterThan(0);
      expect(CATEGORY_META[category].summary.length).toBeGreaterThan(0);
    }
  });

  it("cada trazador declara nombre, propósito y duración — sin campos vacíos", () => {
    for (const tracker of TRACKERS) {
      expect(tracker.name.trim()).not.toBe("");
      expect(tracker.purpose.trim()).not.toBe("");
      expect(tracker.duration.trim()).not.toBe("");
    }
  });

  it("no hay trazadores duplicados", () => {
    const nombres = TRACKERS.map((t) => t.name);
    expect(new Set(nombres).size).toBe(nombres.length);
  });

  it("la cookie de sesión de Supabase está declarada como necesaria", () => {
    // Es la única cookie que existe siempre. Si desapareciera del inventario,
    // la política de cookies estaría ocultando la más importante.
    const auth = TRACKERS.find((t) => t.name.includes("auth-token"));
    expect(auth).toBeDefined();
    expect(auth?.category).toBe("necesarias");
  });

  it("no se declara ningún trazador de terceros", () => {
    // Verificado en vivo el 2026-08-02: ninguna petición de la carga sale del
    // propio origen. Si esto falla, entró un tercero y hay que revisar el
    // banner, la política de cookies Y las transferencias internacionales.
    expect(TRACKERS.filter((t) => !t.firstParty)).toEqual([]);
  });
});
