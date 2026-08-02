// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { CONSENT_STORAGE_KEY, hasConsent, saveConsent } from "@/lib/consent";
import {
  addToHistory,
  clearStoredHistory,
  historyStorageKey,
  readHistory,
} from "./history";

/**
 * EL DEFECTO QUE ESTOS TESTS CIERRAN
 * ----------------------------------
 * El historial de búsqueda está declarado como trazador de la categoría
 * "preferencias" y la persona tiene un interruptor para apagarlo en
 * /ajustes/privacidad. Pero el interruptor no mandaba: se podía borrar el
 * historial, apagar el permiso, y a la búsqueda siguiente volvía a escribirse.
 *
 * Un término de búsqueda no es un dato neutro en esta app —"abogado de
 * inmigración", "trabajo sin papeles"— así que el control tiene que valer.
 *
 * Se usa el store de consentimiento REAL (no un mock): lo que se está probando
 * es justamente el cableado entre los dos módulos.
 */

const KEY = historyStorageKey("dominicanos", "u-1");

/** Apaga sólo "preferencias", dejando el resto de la decisión como está. */
function turnPreferencesOff() {
  saveConsent({ preferencias: false });
}

function turnPreferencesOn() {
  saveConsent({ preferencias: true });
}

beforeEach(() => {
  window.localStorage.clear();
  // El historial cachea por clave a nivel de módulo; limpiarlo deja cada caso
  // partiendo del mismo estado.
  clearStoredHistory(KEY);
});

describe("historial de búsqueda y consentimiento", () => {
  it("por defecto SÍ se recuerda: nadie pierde el historial por este cambio", () => {
    // "preferencias" es `activa-por-defecto` — está exenta de consentimiento
    // previo, así que quien nunca vio un banner sigue igual que antes.
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBeNull();
    expect(hasConsent("preferencias")).toBe(true);

    addToHistory(KEY, "cuarto barato");
    expect(readHistory(KEY)).toEqual(["cuarto barato"]);
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
  });

  it("con el interruptor apagado NO escribe nada en el teléfono", () => {
    turnPreferencesOff();

    addToHistory(KEY, "abogado de inmigracion");

    expect(readHistory(KEY)).toEqual([]);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("con el interruptor apagado tampoco muestra lo que ya estaba guardado", () => {
    // Alguien que tenía historial de antes y recién ahora dice que no.
    addToHistory(KEY, "trabajo sin papeles");
    expect(readHistory(KEY)).toEqual(["trabajo sin papeles"]);

    turnPreferencesOff();

    expect(readHistory(KEY)).toEqual([]);
  });

  it("volver a encenderlo reanuda el historial", () => {
    turnPreferencesOff();
    addToHistory(KEY, "no se guarda");
    expect(readHistory(KEY)).toEqual([]);

    turnPreferencesOn();
    addToHistory(KEY, "ahora si");
    expect(readHistory(KEY)).toEqual(["ahora si"]);
  });

  it("borrar SIEMPRE se puede, con permiso o sin él", () => {
    // Quitar datos nunca se gatea: negarle a alguien borrar lo suyo porque
    // apagó un permiso sería exactamente al revés de lo que el permiso protege.
    addToHistory(KEY, "algo");
    expect(window.localStorage.getItem(KEY)).not.toBeNull();

    turnPreferencesOff();
    clearStoredHistory(KEY);

    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("el historial de OTRA persona tampoco se filtra con el permiso apagado", () => {
    const otherKey = historyStorageKey("dominicanos", "u-2");
    addToHistory(otherKey, "lo de la otra persona");
    turnPreferencesOff();

    expect(readHistory(otherKey)).toEqual([]);

    clearStoredHistory(otherKey);
  });
});
