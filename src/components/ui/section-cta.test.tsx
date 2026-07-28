// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { t } from "@/lib/i18n";
import { SectionCta } from "./section-cta";

/**
 * La burbuja "Publicá tu…" que encabeza cada listado (pedido textual del
 * cliente, 27/7). Lo que hay que proteger:
 *
 *  - que sea UN link con nombre accesible completo (acción + motivo). Un
 *    usuario de lector de pantalla tiene que escuchar lo mismo que se lee;
 *  - que apunte al flujo de publicar de ESA sección, ya preseleccionado;
 *  - que el acento entre por el fondo/borde y NUNCA por el color del texto
 *    (el amarillo de Negocios no llega a AA como tinta);
 *  - que las siete variantes de copy existan y sean distintas entre sí.
 */

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: unknown;
    children: React.ReactNode;
  }) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

describe("SectionCta", () => {
  afterEach(cleanup);

  it("es un solo link cuyo nombre accesible dice la acción y el motivo", () => {
    render(
      <SectionCta
        accent="var(--accent-negocios)"
        href="/publicar?kind=business"
        title={t("sections", "publishBusinessTitle")}
        hint={t("sections", "publishBusinessHint")}
      />,
    );

    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/publicar?kind=business");
    expect(link.textContent).toContain("Publicá tu negocio");
    expect(link.textContent).toContain("Que tu gente sepa dónde encontrarte.");
  });

  it("pinta el acento en el relleno y el borde, jamás en el texto", () => {
    render(
      <SectionCta
        accent="var(--accent-negocios)"
        href="/publicar?kind=business"
        title="Publicá tu negocio"
        hint="Que tu gente sepa dónde encontrarte."
      />,
    );

    const link = screen.getByRole("link");
    // Las variables de la cápsula viajan por style; el color del texto sale de
    // los tokens del tema (text-foreground / text-foreground-secondary).
    expect(link.getAttribute("style")).toContain("--bubble-fill");
    expect(link.getAttribute("style")).toContain("var(--accent-negocios)");
    expect(link.querySelector(".text-foreground")).toBeTruthy();
    expect(link.getAttribute("style")).not.toContain("color:");
  });

  it("el ícono decorativo no ensucia el nombre accesible", () => {
    render(
      <SectionCta
        accent="var(--accent-eventos)"
        href="/publicar?kind=event"
        title="Publicá tu evento"
        hint="Contale a la comunidad dónde y cuándo."
      />,
    );
    const ocultos = screen.getByRole("link").querySelectorAll('[aria-hidden="true"]');
    // Chip del más y círculo de la flecha: los dos, decorativos.
    expect(ocultos.length).toBe(2);
  });

  it("las siete secciones tienen su propio par acción + motivo, sin repetirse", () => {
    const titulos = [
      t("sections", "publishPropertyTitle"),
      t("sections", "publishEventTitle"),
      t("sections", "publishBusinessTitle"),
      t("sections", "publishProfessionalTitle"),
      t("sections", "publishJobTitle"),
      t("sections", "publishProductTitle"),
      t("sections", "publishGigTitle"),
    ];
    const pistas = [
      t("sections", "publishPropertyHint"),
      t("sections", "publishEventHint"),
      t("sections", "publishBusinessHint"),
      t("sections", "publishProfessionalHint"),
      t("sections", "publishJobHint"),
      t("sections", "publishProductHint"),
      t("sections", "publishGigHint"),
    ];

    expect(new Set(titulos).size).toBe(7);
    expect(new Set(pistas).size).toBe(7);
    // Copy corto de verdad: entra en una línea en un teléfono de 375px.
    for (const titulo of titulos) expect(titulo.length).toBeLessThanOrEqual(28);
    for (const pista of pistas) expect(pista.length).toBeLessThanOrEqual(52);
  });
});
