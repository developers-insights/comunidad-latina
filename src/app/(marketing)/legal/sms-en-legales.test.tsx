/** @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant/resolve", () => ({
  getTenant: async () => ({ id: "t", slug: "dominicanos", name: "Comunidad Latina" }),
}));

import TerminosPage from "./terminos/page";
import PrivacidadPage from "./privacidad/page";

afterEach(cleanup);

async function renderPage(Page: () => Promise<React.ReactElement>) {
  render(await Page());
  return document.body;
}

describe("Términos y Privacidad cubren los SMS", () => {
  it("Términos tiene su sección de SMS con STOP, HELP y enlace a la política", async () => {
    const body = await renderPage(TerminosPage);
    const seccion = body.querySelector("#mensajes-sms");

    expect(seccion?.textContent).toMatch(/STOP/);
    expect(seccion?.textContent).toMatch(/HELP/);
    expect(seccion?.textContent).toMatch(/pueden aplicarse tarifas de mensajes y datos/i);
    expect(seccion?.querySelector('a[href="/legal/sms"]')).not.toBeNull();
  });

  it("Privacidad promete no compartir el número ni el consentimiento de SMS con terceros", async () => {
    const body = await renderPage(PrivacidadPage);
    const seccion = body.querySelector("#tu-telefono");

    expect(seccion?.textContent).toMatch(/no se comparten con terceros/i);
    expect(seccion?.querySelector('a[href="/legal/sms"]')).not.toBeNull();
    expect(body.querySelector("#con-quien-compartimos")?.textContent).toMatch(/Twilio/);
  });
});
