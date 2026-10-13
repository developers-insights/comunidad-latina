/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant/resolve", () => ({
  getTenant: async () => ({ id: "t", slug: "dominicanos", name: "Comunidad Latina" }),
}));

import { COPY } from "@/components/marketing/copy";
import { SUPPORT_EMAIL } from "@/lib/support/contact";
import ReembolsosPage from "./page";
import TerminosPage from "../terminos/page";

afterEach(cleanup);

async function texto() {
  render(await ReembolsosPage());
  return document.body.textContent ?? "";
}

function seccion(id: string) {
  return document.getElementById(id)?.textContent ?? "";
}

describe("/legal/reembolsos — lo que Stripe busca en la política de reembolsos", () => {
  it("dice quién opera, la moneda y que Stripe procesa los pagos", async () => {
    const t = await texto();
    expect(t).toContain("Comunidad Latina LLC");
    expect(t).toMatch(/dólares estadounidenses \(USD\)/);
    expect(t).toMatch(/nunca vemos ni guardamos los datos de tu tarjeta/i);
  });

  it("explica cómo cancelar una suscripción y que el beneficio sigue hasta fin del período", async () => {
    await texto();
    const s = seccion("suscripciones");
    expect(s).toMatch(/Presencia Verificada/);
    expect(s).toMatch(/Check azul/);
    expect(s).toMatch(/Membresía de tienda/);
    expect(s).toMatch(/Publicación premium/);
    expect(s).toMatch(/panel de facturación/i);
    expect(s).toMatch(/hasta el último día del\s+período que ya pagaste/i);
    expect(s).toMatch(/No devolvemos la parte que queda/i);
  });

  it("separa los pagos únicos: completo si no empezó, sin reembolso de lo ya usado", async () => {
    await texto();
    const s = seccion("pagos-unicos");
    expect(s).toMatch(/Impulso/);
    expect(s).toMatch(/Campaña/);
    expect(s).toMatch(/7,\s*14 o 30 días/);
    expect(s).toMatch(/todavía no empezó a mostrarse/i);
    expect(s).toMatch(/no devolvemos\s+la parte que ya se usó/i);
  });

  it("da los plazos reales: 30 días para pedir, 3 días hábiles para responder, 5 a 10 para el banco", async () => {
    await texto();
    const s = seccion("como-pedir");
    expect(s).toContain(SUPPORT_EMAIL);
    expect(s).toMatch(/«Pagos y membresía»/);
    expect(s).toMatch(/30\s+días del cobro/);
    expect(s).toMatch(/hasta 3 días hábiles/);
    expect(s).toMatch(/5 a 10\s+días hábiles/);
  });

  it("cubre cobros duplicados, no reconocidos y fallas técnicas", async () => {
    await texto();
    const s = seccion("siempre-devolvemos");
    expect(s).toMatch(/Cobro duplicado/);
    expect(s).toMatch(/no reconocés/);
    expect(s).toMatch(/falla técnica/i);
  });

  it("describe el pago protegido de colaboraciones con creadores", async () => {
    await texto();
    const s = seccion("colaboraciones");
    expect(s).toMatch(/72 horas/);
    expect(s).toMatch(/se aprueba sola/);
    expect(s).toMatch(/comisión/);
    expect(s).toMatch(/reembolso es completo y automático/);
    expect(s).toMatch(/se abre una disputa/);
  });

  it("aclara lo que no se devuelve y los contracargos", async () => {
    await texto();
    expect(seccion("sin-reembolso")).toMatch(/Compras entre usuarios/);
    expect(seccion("sin-reembolso")).toMatch(/Stripe Identity es gratis/);
    expect(seccion("contracargos")).toMatch(/lo revisamos junto con Stripe/);
  });

  it("no inventa datos que no existen: ni teléfono ni dirección postal", async () => {
    const t = await texto();
    expect(t).not.toMatch(/\(\d{3}\)\s?\d{3}-\d{4}|\+1\s?\d{3}/);
    expect(t).not.toMatch(/\bSuite\b|\bStreet\b|\bAve\b/);
  });

  it("enlaza a Términos y Contacto", async () => {
    render(await ReembolsosPage());
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/legal/terminos");
    expect(hrefs).toContain("/contacto");
  });

  it("Términos tiene su sección de pagos con enlace a esta política", async () => {
    render(await TerminosPage());
    expect(document.querySelector('#pagos a[href="/legal/reembolsos"]')).not.toBeNull();
  });

  it("está en el pie del sitio, junto a Contacto y Precios", () => {
    expect(COPY.footer.legal.map((item) => item.href)).toContain("/legal/reembolsos");
    const resto = [...COPY.footer.explore, ...COPY.footer.community].map((item) => item.href);
    expect(resto).toContain("/contacto");
    expect(resto).toContain("/precios");
  });
});
