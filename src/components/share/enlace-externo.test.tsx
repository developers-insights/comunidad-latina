// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ExternalLinkCard, enlaceExternoDelCuerpo } from "./enlace-externo";

afterEach(cleanup);

describe("enlaces externos seguros", () => {
  it("deriva la tarjeta de la URL sin necesitar metadatos remotos", () => {
    expect(enlaceExternoDelCuerpo("https://www.youtube.com/watch?v=abc")).toEqual({
      href: "https://www.youtube.com/watch?v=abc",
      dominio: "youtube.com",
      detalle: "/watch",
    });
  });

  it("rechaza protocolos activos, credenciales y mensajes con texto adicional", () => {
    expect(enlaceExternoDelCuerpo("javascript:alert(1)")).toBeNull();
    expect(enlaceExternoDelCuerpo("data:text/html,hola")).toBeNull();
    expect(enlaceExternoDelCuerpo("https://usuario:clave@example.com/ruta")).toBeNull();
    expect(enlaceExternoDelCuerpo("mirá https://example.com/ruta")).toBeNull();
  });

  it("pinta un enlace externo identificable y aislado de la pestaña original", () => {
    const enlace = enlaceExternoDelCuerpo("https://instagram.com/p/abc")!;
    render(<ExternalLinkCard enlace={enlace} />);

    const link = screen.getByRole("link", { name: "Abrir enlace externo de instagram.com" });
    expect(link.getAttribute("href")).toBe("https://instagram.com/p/abc");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText("/p/abc")).toBeTruthy();
  });
});
