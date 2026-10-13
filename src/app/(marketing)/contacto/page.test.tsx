/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant/resolve", () => ({
  getTenant: async () => ({ id: "t", slug: "dominicanos", name: "Comunidad Latina" }),
}));

import { SUPPORT_EMAIL, SUPPORT_TOPICS } from "@/lib/support/contact";
import ContactoPage from "./page";

afterEach(cleanup);

async function renderPage() {
  render(await ContactoPage());
  return document.body;
}

function hrefs() {
  return screen.getAllByRole("link").map((a) => a.getAttribute("href") ?? "");
}

describe("/contacto — página pública de contacto", () => {
  it("dice quién opera la plataforma y muestra el correo de soporte", async () => {
    const body = await renderPage();
    expect(body.textContent).toContain("Comunidad Latina LLC");
    expect(body.textContent).toContain(SUPPORT_EMAIL);
    expect(hrefs()).toContain(`mailto:${SUPPORT_EMAIL}`);
  });

  it("da el plazo de respuesta", async () => {
    const body = await renderPage();
    expect(body.textContent).toMatch(/hasta 3 días hábiles/);
  });

  it("tiene un botón de pagos con el asunto ya puesto", async () => {
    await renderPage();
    const pago = screen.getByRole("link", { name: "Consulta sobre un pago" });
    const href = pago.getAttribute("href") ?? "";
    expect(href.startsWith(`mailto:${SUPPORT_EMAIL}?`)).toBe(true);
    expect(decodeURIComponent(href)).toContain("Pagos y membresía");
  });

  it("ofrece un correo por cada tipo de consulta", async () => {
    await renderPage();
    for (const topic of SUPPORT_TOPICS) {
      expect(screen.getAllByText(topic.label).length).toBeGreaterThan(0);
    }
    const mailtos = hrefs().filter((h) => h.startsWith("mailto:"));
    expect(mailtos.length).toBeGreaterThanOrEqual(SUPPORT_TOPICS.length);
  });

  it("enlaza a reembolsos, términos, privacidad y al soporte con cuenta", async () => {
    await renderPage();
    const links = hrefs();
    expect(links).toContain("/legal/reembolsos");
    expect(links).toContain("/legal/terminos");
    expect(links).toContain("/legal/privacidad");
    expect(links).toContain("/ajustes/soporte");
  });

  it("no inventa teléfono ni dirección postal", async () => {
    const body = await renderPage();
    expect(body.textContent).not.toMatch(/\(\d{3}\)\s?\d{3}-\d{4}|\+1\s?\d{3}/);
    expect(body.textContent).not.toMatch(/\bSuite\b|\bStreet\b|\bAve\b/);
  });
});
