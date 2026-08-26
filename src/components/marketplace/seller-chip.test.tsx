// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PresenciaVerificadaBadge, SellerChip, SellerIdentityBadge } from "./seller-chip";
import { COPY } from "./copy";

const C = COPY.seller;

/**
 * El chip de vendedor es la señal que separa TIENDAS de PARTICULARES (call con
 * el cliente 2026-07-24) — y, desde el fix del 2026-08-24, también la señal
 * que separa DOS insignias distintas: identidad verificada (gratis, cualquier
 * vendedor) y Presencia Verificada (plan pago, solo tiendas). Antes del fix,
 * "Verificada" vivía atada SOLO al plan pago y un particular con identidad
 * confirmada no tenía ninguna insignia — lo que se fija acá es exactamente
 * eso: que ahora la tiene, y que las dos insignias nunca se confunden entre sí.
 */
describe("SellerChip", () => {
  afterEach(cleanup);

  it("tienda: dice 'Tienda', muestra el nombre y linkea a su vidriera", () => {
    render(
      <SellerChip seller={{ kind: "store", name: "Sabor Caribeño", storeId: "store-1" }} />,
    );

    const link = screen.getByRole("link", { name: C.storeAriaLabel("Sabor Caribeño") });
    expect(link.getAttribute("href")).toBe("/marketplace/tienda/store-1");
    expect(link.textContent).toContain(C.storeLabel);
    expect(link.textContent).toContain("Sabor Caribeño");
  });

  it("particular: dice 'Particular' con el nombre de quien vende y NO linkea", () => {
    render(<SellerChip seller={{ kind: "private", name: "María Fernández" }} />);

    expect(screen.queryByRole("link")).toBeNull();
    const chip = screen.getByLabelText(C.privateAriaLabel("María Fernández"));
    expect(chip.textContent).toContain(C.privateLabel);
    expect(chip.textContent).toContain("María Fernández");
  });

  it("sin nombre resuelto cae a un texto de reserva por tipo", () => {
    const { unmount } = render(<SellerChip seller={{ kind: "private", name: null }} />);
    expect(screen.getByText(new RegExp(C.fallbackPrivateName))).toBeTruthy();
    unmount();

    render(<SellerChip seller={{ kind: "store", name: null, storeId: "store-9" }} />);
    expect(screen.getByText(new RegExp(C.fallbackStoreName))).toBeTruthy();
  });

  describe("Presencia Verificada — el plan PAGO, solo tiendas", () => {
    it("no aparece sin business_accounts.verified_presence", () => {
      render(
        <SellerChip
          seller={{ kind: "store", name: "Tienda Ana", storeId: "s1", verified: false }}
        />,
      );
      expect(screen.queryByText(C.presenceVerifiedLabel)).toBeNull();
    });

    it("aparece cuando la tienda tiene Presencia Verificada", () => {
      render(
        <SellerChip seller={{ kind: "store", name: "Tienda Ana", storeId: "s1", verified: true }} />,
      );
      expect(screen.getByText(C.presenceVerifiedLabel)).toBeTruthy();
    });

    it("un particular NUNCA la muestra, aunque le llegue el flag por error", () => {
      render(<SellerChip seller={{ kind: "private", name: "Juan", verified: true }} />);
      // El plan es de negocios: si se colara acá, el badge dejaría de
      // significar "pagó una suscripción" y volvería a leerse como identidad.
      expect(screen.queryByText(C.presenceVerifiedLabel)).toBeNull();
    });
  });

  describe("Identidad verificada — GRATIS, cualquier vendedor (el bug que se arregló)", () => {
    it("un particular con identidad verificada SÍ tiene insignia — antes no tenía ninguna", () => {
      render(
        <SellerChip seller={{ kind: "private", name: "Juan", identityVerified: true }} />,
      );
      expect(screen.getByText(C.identityLabel)).toBeTruthy();
    });

    it("una tienda con identidad verificada también la muestra", () => {
      render(
        <SellerChip
          seller={{ kind: "store", name: "Tienda Ana", storeId: "s1", identityVerified: true }}
        />,
      );
      expect(screen.getByText(C.identityLabel)).toBeTruthy();
    });

    it("sin identidad verificada, no aparece (ni para tienda ni para particular)", () => {
      const { unmount } = render(
        <SellerChip seller={{ kind: "private", name: "Juan", identityVerified: false }} />,
      );
      expect(screen.queryByText(C.identityLabel)).toBeNull();
      unmount();

      render(
        <SellerChip
          seller={{ kind: "store", name: "Tienda Ana", storeId: "s1", identityVerified: false }}
        />,
      );
      expect(screen.queryByText(C.identityLabel)).toBeNull();
    });
  });

  it("una tienda con identidad Y plan pago muestra las DOS insignias a la vez, nunca fusionadas", () => {
    render(
      <SellerChip
        seller={{
          kind: "store",
          name: "Tienda Ana",
          storeId: "s1",
          verified: true,
          identityVerified: true,
        }}
      />,
    );
    expect(screen.getByText(C.identityLabel)).toBeTruthy();
    expect(screen.getByText(C.presenceVerifiedLabel)).toBeTruthy();
  });
});

describe("SellerIdentityBadge", () => {
  afterEach(cleanup);

  it("lleva su propio aria-label, distinto del de Presencia Verificada", () => {
    render(<SellerIdentityBadge />);
    expect(screen.getByLabelText(C.identityAriaLabel)).toBeTruthy();
  });
});

describe("PresenciaVerificadaBadge", () => {
  afterEach(cleanup);

  it("acepta un label distinto por contexto (cabecera de la vidriera vs. card)", () => {
    render(<PresenciaVerificadaBadge label="Tienda con presencia verificada" />);
    expect(screen.getByText("Tienda con presencia verificada")).toBeTruthy();
  });

  it("por default usa el nombre real de la feature, nunca un 'Verificado' genérico", () => {
    render(<PresenciaVerificadaBadge />);
    expect(screen.getByText(C.presenceVerifiedLabel)).toBeTruthy();
  });
});
