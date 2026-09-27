/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { COPY } from "@/components/marketing/copy";
import SmsPolicyPage from "./page";

afterEach(cleanup);

function texto() {
  render(<SmsPolicyPage />);
  return document.body.textContent ?? "";
}

describe("/legal/sms — lo que pide Twilio para una verificación toll-free", () => {
  it("dice qué se manda y cada cuánto, en español y en inglés", () => {
    const t = texto();
    expect(t).toMatch(/solo códigos de verificación/i);
    expect(t).toMatch(/only one-time verification codes/i);
    expect(t).toMatch(/la frecuencia varía/i);
    expect(t).toMatch(/message frequency varies/i);
  });

  it("avisa de tarifas, STOP y HELP en los dos idiomas", () => {
    const t = texto();
    expect(t).toMatch(/pueden aplicarse tarifas de mensajes y datos/i);
    expect(t).toMatch(/message and data rates may apply/i);
    expect(t).toMatch(/STOP/);
    expect(t).toMatch(/HELP/);
  });

  it("promete no compartir el número ni el consentimiento con terceros para marketing", () => {
    const t = texto();
    expect(t).toMatch(/no se comparten? .*con terceros/i);
    expect(t).toMatch(/will not be shared with third parties/i);
  });

  it("muestra cómo se da el consentimiento, con el texto que ve la persona", () => {
    render(<SmsPolicyPage />);
    const bloque = document.getElementById("consentimiento");
    expect(bloque?.textContent).toMatch(/Al tocar «Enviar código» aceptás recibir un SMS/);
  });

  it("tiene contacto y enlaces a Privacidad y Términos", () => {
    render(<SmsPolicyPage />);
    expect(document.body.textContent).toContain("comunidadlatinallc@gmail.com");
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/legal/privacidad");
    expect(hrefs).toContain("/legal/terminos");
  });

  it("está en el pie del sitio", () => {
    expect(COPY.footer.legal.map((item) => item.href)).toContain("/legal/sms");
  });
});
