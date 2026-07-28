import { describe, expect, it } from "vitest";

import {
  canStaffResolve,
  discloseApplication,
  jobDisclosure,
  type RawApplication,
} from "./policy";

/**
 * La BARRERA DE PRIVACIDAD del panel de Empleos, testeada donde vive.
 *
 * Este módulo es el único lugar donde se decide si el staff puede leer lo que
 * una persona le escribió a otra. Si estos tests se ponen en verde aflojando la
 * regla, se filtró dato ajeno — no es un test de detalle, es el contrato.
 */

const STAFF = "5f0a0e42-0000-4000-8000-00000000staff".slice(0, 36);
const OTHER = "6f0a0e42-0000-4000-8000-00000000other".slice(0, 36);

const APPLICANT_ID = "a11c4a17-0000-4000-8000-000000000001";

const RAW: RawApplication = {
  id: "app-1",
  applicantId: APPLICANT_ID,
  status: "submitted",
  message: "Puedo empezar el lunes. Mi teléfono es 555-0100.",
  createdAtLabel: "hace 2 días",
};

const ENRICH = {
  displayName: "Rosa M.",
  avatarUrl: "https://cdn.example/rosa.jpg",
  answers: [{ question: "¿Tenés experiencia?", answer: "Sí" }],
};

describe("jobDisclosure", () => {
  it("un aviso sin dueño miembro es de la plataforma", () => {
    expect(jobDisclosure({ createdBy: null, staffId: STAFF })).toBe("platform");
  });

  it("un aviso publicado por el propio staff es de la plataforma", () => {
    expect(jobDisclosure({ createdBy: STAFF, staffId: STAFF })).toBe("platform");
  });

  it("un aviso de OTRA persona es de un miembro, aunque quien mire sea staff", () => {
    expect(jobDisclosure({ createdBy: OTHER, staffId: STAFF })).toBe("member");
  });
});

describe("canStaffResolve", () => {
  it("deja responder solo sobre avisos de la plataforma", () => {
    expect(canStaffResolve({ createdBy: null, staffId: STAFF })).toBe(true);
    expect(canStaffResolve({ createdBy: STAFF, staffId: STAFF })).toBe(true);
  });

  it("NO deja responder por el empleador en un aviso ajeno", () => {
    expect(canStaffResolve({ createdBy: OTHER, staffId: STAFF })).toBe(false);
  });
});

describe("discloseApplication", () => {
  it("en un aviso de la plataforma muestra nombre, nota y respuestas", () => {
    const disclosed = discloseApplication("platform", RAW, ENRICH);

    expect(disclosed.displayName).toBe("Rosa M.");
    expect(disclosed.message).toBe(RAW.message);
    expect(disclosed.answers).toEqual(ENRICH.answers);
  });

  it("en un aviso de un miembro NO deja pasar identidad, nota ni respuestas", () => {
    const disclosed = discloseApplication("member", RAW, ENRICH);

    expect(disclosed.displayName).toBeNull();
    expect(disclosed.avatarUrl).toBeNull();
    expect(disclosed.message).toBeNull();
    expect(disclosed.answers).toEqual([]);

    // Ni siquiera serializado: lo que no está en el objeto no viaja al browser.
    const serialized = JSON.stringify(disclosed);
    expect(serialized).not.toContain("Rosa");
    expect(serialized).not.toContain("555-0100");
    expect(serialized).not.toContain("experiencia");
  });

  it("el metadato operativo sí sobrevive al recorte (id, estado, fecha)", () => {
    const disclosed = discloseApplication("member", RAW, ENRICH);

    expect(disclosed.id).toBe("app-1");
    expect(disclosed.status).toBe("submitted");
    expect(disclosed.createdAtLabel).toBe("hace 2 días");
  });

  it("nunca filtra el applicantId — el id del perfil no viaja al browser", () => {
    const platform = discloseApplication("platform", RAW, ENRICH);
    const member = discloseApplication("member", RAW, ENRICH);

    // Ni siquiera en "platform": el panel no necesita el id de nadie para
    // operar, y un id en el payload es una llave para pedir el perfil entero.
    expect(JSON.stringify(platform)).not.toContain(APPLICANT_ID);
    expect(JSON.stringify(member)).not.toContain(APPLICANT_ID);
  });
});

/*
 * El conteo por aviso ya no se calcula en TS: desde 0042 la app no puede leer
 * las filas de un aviso ajeno, así que lo agrega la RPC `job_application_tally`
 * (total, pending, sin 'withdrawn'). Sus reglas se verifican en la base y en la
 * prueba en vivo del panel, no acá.
 */
