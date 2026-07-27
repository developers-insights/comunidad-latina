// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CreatorsNav } from "./creators-nav";

/**
 * Feedback del cliente (26/7): sacar el acceso a Contratos del segmented nav
 * de /creadores — "de última ponelo en el perfil". El nav ahora es solo
 * Trabajos · Creadores. La ruta /creadores/contratos sigue existiendo (se
 * llega desde "Mis contratos" en /creadores/perfil), pero no debe reaparecer
 * acá — si alguien la reagrega a ITEMS, este test lo agarra.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

describe("CreatorsNav", () => {
  afterEach(cleanup);

  it("no ofrece un acceso a /creadores/contratos", () => {
    render(<CreatorsNav active="gigs" />);
    expect(screen.queryByRole("link", { name: /contratos/i })).toBeNull();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.getAttribute("href"))).not.toContain("/creadores/contratos");
  });

  it("mantiene los otros dos accesos, Trabajos y Creadores", () => {
    render(<CreatorsNav active="creators" />);
    expect(screen.getByRole("link", { name: /trabajos/i }).getAttribute("href")).toBe("/creadores");
    expect(screen.getByRole("link", { name: /creadores/i }).getAttribute("href")).toBe(
      "/creadores/buscar",
    );
  });
});
