// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ExternalPurchaseCta } from "./external-purchase-cta";

/**
 * Dos cosas se testean acá, y las dos son de seguridad, no de estética:
 *
 *  1. Que el destino pase por `safeExternalHref`. Un `cta_purchase_url` lo
 *     carga un comercio, no el código: `javascript:` o `//evil.com` NO pueden
 *     terminar en un href, y el enlace externo no puede salir sin
 *     `rel="noopener noreferrer"`.
 *  2. Que el aviso de "el pago lo cobra el negocio" esté SIEMPRE presente
 *     junto al botón. Si alguien borra ese bloque en un refactor, el botón
 *     queda prometiendo una compra protegida que la plataforma no da — que es
 *     exactamente el reclamo que este componente existe para evitar.
 */

const STORE = "Tienda de Ana";

describe("ExternalPurchaseCta — destino seguro", () => {
  afterEach(cleanup);

  it("abre el sitio externo en otra pestaña, con rel seguro", () => {
    render(<ExternalPurchaseCta purchaseUrl="https://tiendadeana.com/pedido" storeName={STORE} />);
    const link = screen.getByRole("link", { name: /comprar en el sitio de tienda de ana/i });
    expect(link.getAttribute("href")).toBe("https://tiendadeana.com/pedido");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("muestra el dominio real, para que se pueda reconocer antes de salir", () => {
    render(<ExternalPurchaseCta purchaseUrl="https://tiendadeana.com/pedido" storeName={STORE} />);
    expect(screen.getByText("tiendadeana.com")).toBeTruthy();
  });

  it("NO renderiza botón con un protocolo peligroso", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,<b>x", "file:///etc/passwd"]) {
      const { container } = render(<ExternalPurchaseCta purchaseUrl={url} storeName={STORE} />);
      expect(container.querySelector("a")).toBeNull();
      cleanup();
    }
  });

  it("NO renderiza botón para un destino interno disfrazado", () => {
    // `/\evil.com` y `//evil.com` engañan a un `startsWith("/")`; safeExternalHref
    // clasifica por origen resuelto, así que uno es interno (no es "comprar
    // afuera") y el otro no llega acá como interno.
    const { container } = render(<ExternalPurchaseCta purchaseUrl="/marketplace" storeName={STORE} />);
    expect(container.querySelector("a")).toBeNull();
  });

  it("NO renderiza nada sin URL", () => {
    for (const url of [null, undefined, "", "   "]) {
      const { container } = render(<ExternalPurchaseCta purchaseUrl={url} storeName={STORE} />);
      expect(container.textContent).toBe("");
      cleanup();
    }
  });
});

describe("ExternalPurchaseCta — honestidad antes de salir", () => {
  afterEach(cleanup);

  it("dice quién cobra, quién responde por el envío y que no reembolsamos", () => {
    render(<ExternalPurchaseCta purchaseUrl="https://tiendadeana.com" storeName={STORE} />);
    const texto = document.body.textContent?.toLowerCase() ?? "";
    expect(texto).toContain("cobra el negocio");
    expect(texto).toContain("devolución");
    expect(texto).toContain("reembolsarte");
  });

  it("lleva la regla de oro y el enlace a las reglas del Marketplace", () => {
    render(<ExternalPurchaseCta purchaseUrl="https://tiendadeana.com" storeName={STORE} />);
    expect(document.body.textContent).toContain("Nunca envíes dinero por adelantado");
    const policy = screen.getByRole("link", { name: /reglas del marketplace/i });
    expect(policy.getAttribute("href")).toBe("/legal/marketplace");
  });

  it("el aviso va ANTES del botón en el orden del documento", () => {
    // Orden del DOM = orden de lectura y de foco. Si el aviso terminara
    // debajo, sería letra chica — que es justo lo que la spec prohíbe.
    const { container } = render(
      <ExternalPurchaseCta purchaseUrl="https://tiendadeana.com" storeName={STORE} />,
    );
    const html = container.innerHTML;
    expect(html.indexOf("cobra el negocio")).toBeLessThan(html.indexOf("Comprar en el sitio"));
  });

  it("sin nombre de tienda usa un genérico, no un hueco", () => {
    render(<ExternalPurchaseCta purchaseUrl="https://tiendadeana.com" storeName={null} />);
    const link = screen.getByRole("link", { name: /comprar en el sitio de/i });
    expect(link.getAttribute("aria-label")).not.toContain("null");
  });
});
