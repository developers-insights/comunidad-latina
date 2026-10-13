/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatCents, slotKey, type PriceInterval, type PriceProduct } from "@/lib/pricing";
import { FALLBACK_PRICES } from "@/lib/pricing/defaults";
import { DEFAULT_TENANTS } from "@/lib/tenant/resolve";
import { SUPPORT_EMAIL } from "@/lib/support/contact";

const tenantMock = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

vi.mock("@/lib/tenant/resolve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant/resolve")>();
  return { ...actual, getTenant: async () => tenantMock.current };
});

import PreciosPage, { generateMetadata } from "./page";

function fallback(product: PriceProduct, variant: string, interval: PriceInterval): string {
  const price = FALLBACK_PRICES.get(slotKey({ product, variant, interval }));
  if (!price) throw new Error(`sin respaldo para ${product}:${variant}:${interval}`);
  return formatCents(price.amountCents, price.currency);
}

async function renderPage() {
  render(await PreciosPage());
  return document.body.textContent ?? "";
}

beforeEach(() => {
  tenantMock.current = DEFAULT_TENANTS.dominicanos;
});

afterEach(cleanup);

describe("/precios — lista pública de todo lo que se cobra", () => {
  it("lista cada producto pago", async () => {
    await renderPage();
    for (const title of [
      "Presencia Verificada",
      "Check azul",
      "Membresía de tienda del Marketplace",
      "Publicación premium",
      "Impulso de un aviso",
      "Campaña de una publicación",
      "Perfil de creador patrocinado",
      "Colaboraciones con creadores",
    ]) {
      expect(screen.getByRole("heading", { level: 3, name: title })).toBeTruthy();
    }
  });

  it("muestra los precios del respaldo cuando la comunidad no tiene filas propias", async () => {
    const t = await renderPage();
    const esperados = [
      fallback("presencia", "basico", "mensual"),
      fallback("presencia", "basico", "anual"),
      fallback("presencia", "destacado", "mensual"),
      fallback("presencia", "destacado", "anual"),
      fallback("presencia", "pro", "mensual"),
      fallback("presencia", "pro", "anual"),
      fallback("verificacion", "persona", "mensual"),
      fallback("verificacion", "negocio", "mensual"),
      fallback("verificacion", "profesional", "mensual"),
      fallback("store_membership", "estandar", "mensual"),
      fallback("listing_premium", "estandar", "mensual"),
      fallback("boost", "7d", "unico"),
      fallback("boost", "14d", "unico"),
      fallback("boost", "30d", "unico"),
      fallback("post_promo", "7d", "unico"),
      fallback("post_promo", "14d", "unico"),
      fallback("post_promo", "30d", "unico"),
      fallback("boost_scope", "nacional", "unico"),
      fallback("boost_scope", "global", "unico"),
    ];
    for (const monto of esperados) expect(t).toContain(monto);
  });

  it("aclara moneda, procesador, renovación y lo que es gratis", async () => {
    const t = await renderPage();
    expect(t).toContain("Todo en dólares estadounidenses (USD). Los pagos los procesa Stripe.");
    expect(t).toMatch(/se renueva sola\. cancelás cuando quieras/i);
    expect(t).toMatch(/pago único/i);
    expect(t).toMatch(/confirmar tu identidad/i);
    expect(t).toMatch(/comisión de la plataforma/i);
    expect(t).toMatch(/en el contrato antes de aceptarlo/i);
  });

  it("cada producto lleva a su ruta de compra", async () => {
    await renderPage();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    for (const href of [
      "/negocios/presencia",
      "/verificacion",
      "/marketplace/membresia",
      "/publicar",
      "/impulsar",
      "/impulsar/perfil-creador",
      "/creadores",
    ]) {
      expect(hrefs).toContain(href);
    }
  });

  it("enlaza reembolsos, términos y el correo de soporte", async () => {
    const t = await renderPage();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/legal/reembolsos");
    expect(hrefs).toContain("/legal/terminos");
    expect(hrefs).toContain(`mailto:${SUPPORT_EMAIL}`);
    expect(t).toContain(SUPPORT_EMAIL);
  });

  it("sin configuración de Supabase igual muestra los precios del respaldo", async () => {
    tenantMock.current = { ...DEFAULT_TENANTS.dominicanos, isFallback: false };
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const t = await renderPage();
    expect(t).toContain(fallback("presencia", "basico", "mensual"));
    vi.unstubAllEnvs();
  });

  it("declara canonical /precios", async () => {
    const metadata = await generateMetadata();
    expect(String(metadata.alternates?.canonical)).toMatch(/\/precios$/);
  });
});
