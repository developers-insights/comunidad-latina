// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El sello de historial decide si "Volver" retrocede o cae al fallback, y
 * equivocarse tiene un solo modo de falla grave: decir "sí, hay historial"
 * cuando no lo hay expulsa de la app (a Google, al chat de donde vino el link,
 * a la nada en la PWA). Por eso todos los casos ambiguos se prueban acá con la
 * respuesta conservadora.
 *
 * Cada test importa el módulo FRESCO (`resetModules`): el contador de sesión es
 * una variable de módulo, y reiniciarla es exactamente lo que hace una recarga
 * de la página — que es el caso que más se quiere probar.
 */

type Modulo = typeof import("./internal-history");

async function cargar(): Promise<Modulo> {
  vi.resetModules();
  return import("./internal-history");
}

beforeEach(() => {
  // Entrada limpia, sin sello: como llegar por un link que te mandaron.
  window.history.replaceState(null, "", "/empleos");
});

describe("sello de historial interno", () => {
  it("una entrada directa NO tiene historial de la app detrás", async () => {
    const { markInternalNavigation, hasInternalHistory } = await cargar();
    markInternalNavigation();
    expect(hasInternalHistory()).toBe(false);
  });

  it("después de navegar adentro de la app, sí lo tiene", async () => {
    const { markInternalNavigation, hasInternalHistory } = await cargar();
    markInternalNavigation(); // /empleos, puerta de entrada
    window.history.pushState({ __NA: true }, "", "/empleos/publicar");
    markInternalNavigation();
    expect(hasInternalHistory()).toBe(true);
  });

  it("volver a una entrada ya sellada recupera su número, no lo incrementa", async () => {
    const { markInternalNavigation, hasInternalHistory } = await cargar();
    markInternalNavigation();
    const puerta = window.history.state;

    window.history.pushState({ __NA: true }, "", "/empleos/publicar");
    markInternalNavigation();

    // Simulamos el "atrás" del navegador: vuelve la entrada 0 con su sello.
    window.history.replaceState(puerta, "", "/empleos");
    markInternalNavigation();
    expect(hasInternalHistory()).toBe(false);
  });

  it("recargar una pantalla a la que se llegó navegando conserva la respuesta", async () => {
    const primera = await cargar();
    primera.markInternalNavigation();
    window.history.pushState({ __NA: true }, "", "/empleos/publicar");
    primera.markInternalNavigation();

    // La recarga tira el contexto JS pero NO el historial ni su estado.
    const despues = await cargar();
    expect(despues.hasInternalHistory()).toBe(true);
  });

  it("un router.replace() que cambia la URL no inventa una entrada que no existe", async () => {
    const { markInternalNavigation, hasInternalHistory } = await cargar();
    markInternalNavigation(); // entrada directa: sello 0

    // Así se ve un `router.replace()` desde adentro: Next reescribe el estado
    // de la MISMA entrada (no crece el historial) y se lleva puesto el sello.
    window.history.replaceState({ __NA: true }, "", "/feed");
    markInternalNavigation();

    expect(hasInternalHistory()).toBe(false);
  });

  it("preserva el estado que ya tenía Next en la entrada", async () => {
    const { markInternalNavigation } = await cargar();
    window.history.replaceState({ __NA: true, tree: ["x"] }, "", "/empleos");
    markInternalNavigation();
    expect(window.history.state).toMatchObject({ __NA: true, tree: ["x"] });
  });

  it("no toca la URL al sellar (el query string sobrevive)", async () => {
    const { markInternalNavigation } = await cargar();
    window.history.replaceState(null, "", "/empleos?tipo=servicio");
    markInternalNavigation();
    expect(window.location.pathname + window.location.search).toBe("/empleos?tipo=servicio");
  });
});

describe("sello en el pushState mismo — la primera visita a una sección (2026-09-04)", () => {
  // El caso que se vio en vivo: el efecto del tracker ya corrió, Next recién
  // después hace el pushState (trajo los datos del servidor), y la entrada
  // nueva nacía sin sello → "Volver" caía al fallback.
  it("una entrada creada por pushState queda sellada aunque el tracker no la haya visto", async () => {
    const m = await cargar();
    m.markInternalNavigation(); // la carga inicial: profundidad 0
    const deshacer = m.installHistoryStamping();
    window.history.pushState({ __NA: true }, "", "/empleos/publicar");
    expect(window.history.state).toMatchObject({ __NA: true, clNavDepth: 1 });
    expect(m.hasInternalHistory()).toBe(true);
    deshacer();
  });

  it("atrás del navegador (popstate) hasta la entrada inicial vuelve a decir que no hay historial", async () => {
    const m = await cargar();
    m.markInternalNavigation();
    const deshacer = m.installHistoryStamping();
    window.history.pushState({ __NA: true }, "", "/empleos/publicar");
    expect(m.hasInternalHistory()).toBe(true);
    // jsdom no navega de verdad: se restaura el estado de la entrada inicial
    // y se avisa como lo haría el navegador.
    window.history.replaceState({ __NA: true, clNavDepth: 0 }, "", "/empleos");
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    expect(m.hasInternalHistory()).toBe(false);
    deshacer();
  });

  it("si la inicial no llegó a sellarse, la nueva igual cuenta como profundidad 1", async () => {
    const m = await cargar();
    const deshacer = m.installHistoryStamping();
    window.history.pushState({ __NA: true }, "", "/empleos/publicar");
    expect(m.hasInternalHistory()).toBe(true);
    deshacer();
  });

  it("deshacer el envoltorio restaura el pushState original", async () => {
    const m = await cargar();
    const original = window.history.pushState;
    const deshacer = m.installHistoryStamping();
    expect(window.history.pushState).not.toBe(original);
    deshacer();
    expect(window.history.pushState).toBe(original);
  });
});
