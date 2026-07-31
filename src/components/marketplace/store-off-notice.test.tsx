// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StoreOffNotice } from "./store-off-notice";

/**
 * El estado "tienda apagada" no se puede reproducir en vivo desde la app:
 * `listings.store_active` la escribe SOLO un trigger sobre `store_memberships`
 * (0048), y `app.protect_listing_counters()` bloquea el UPDATE para cualquier
 * cliente autenticado. Estos tests son la verificación de que la pantalla
 * existe, dice lo correcto y —lo más importante— NO le cuenta al visitante el
 * estado de pago de un negocio ajeno.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));

describe("StoreOffNotice — visitante", () => {
  afterEach(cleanup);

  it("dice que no está disponible y ofrece a dónde ir", () => {
    render(<StoreOffNotice isOwner={false} />);
    expect(screen.getByText(/no está disponible por ahora/i)).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/marketplace");
  });

  it("NO filtra el estado de facturación del negocio", () => {
    render(<StoreOffNotice isOwner={false} />);
    const texto = document.body.textContent?.toLowerCase() ?? "";
    for (const filtracion of ["membresía", "venció", "vencida", "pago", "no pagó", "cancelada"]) {
      expect(texto).not.toContain(filtracion);
    }
  });

  it("no es un error técnico ni una página muda", () => {
    const { container } = render(<StoreOffNotice isOwner={false} />);
    expect(container.textContent?.trim().length).toBeGreaterThan(40);
    const texto = container.textContent?.toLowerCase() ?? "";
    expect(texto).not.toContain("error");
    expect(texto).not.toContain("500");
  });
});

describe("StoreOffNotice — dueño", () => {
  afterEach(cleanup);

  it("le dice que no perdió nada y cómo volver, en un toque", () => {
    render(<StoreOffNotice isOwner />);
    expect(screen.getByText(/no se está mostrando/i)).toBeTruthy();
    expect(document.body.textContent).toContain("nada se borró");
    expect(screen.getByRole("link").getAttribute("href")).toBe("/marketplace/membresia");
  });

  it("dueño y visitante ven mensajes distintos", () => {
    const { container: dueno } = render(<StoreOffNotice isOwner />);
    const textoDueno = dueno.textContent;
    cleanup();
    const { container: visitante } = render(<StoreOffNotice isOwner={false} />);
    expect(visitante.textContent).not.toBe(textoDueno);
  });
});
