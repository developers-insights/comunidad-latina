// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SellerChip, SellerVerifiedBadge } from "./seller-chip";
import { COPY } from "./copy";

const C = COPY.seller;

/**
 * El chip de vendedor es la señal que separa TIENDAS de PARTICULARES (call con
 * el cliente 2026-07-24). Lo que se fija acá: qué palabra se lee, si lleva a la
 * vidriera y cuándo aparece "Verificada" — el badge del plan Presencia
 * Verificada, que hasta ahora no se mostraba en ningún lado.
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

  it("badge 'Verificada' sólo cuando la tienda tiene Presencia Verificada", () => {
    const { unmount } = render(
      <SellerChip seller={{ kind: "store", name: "Tienda Ana", storeId: "s1", verified: false }} />,
    );
    expect(screen.queryByText(C.verifiedLabel)).toBeNull();
    unmount();

    render(
      <SellerChip seller={{ kind: "store", name: "Tienda Ana", storeId: "s1", verified: true }} />,
    );
    expect(screen.getByText(C.verifiedLabel)).toBeTruthy();
  });

  it("un particular nunca se muestra como verificado, aunque le llegue el flag", () => {
    render(<SellerChip seller={{ kind: "private", name: "Juan", verified: true }} />);
    // "Verificada" es de tiendas (business_accounts). Si se colara acá, el badge
    // dejaría de significar lo que dice.
    expect(screen.queryByText(C.verifiedLabel)).toBeNull();
  });
});

describe("SellerVerifiedBadge", () => {
  afterEach(cleanup);

  it("acepta el label largo para la cabecera de la vidriera", () => {
    render(<SellerVerifiedBadge label={C.verifiedStoreLabel} />);
    expect(screen.getByText(C.verifiedStoreLabel)).toBeTruthy();
  });
});
