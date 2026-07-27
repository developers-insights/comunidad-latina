// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { JobCardModel } from "@/app/(app)/empleos/queries";
import { JobCard } from "./job-card";
import { COPY } from "./copy";

/**
 * La card de empleo tiene que aguantar el caso que MÁS se va a dar: un aviso
 * SIN foto (nadie le saca una foto a "busco niñera"). Lo que se fija acá es que
 * sin foto la card no se vacía — el pago y el puesto siguen siendo lo que se
 * lee — y que el monto está siempre presente, aunque el aviso no traiga número.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

const C = COPY.list;

const BASE: JobCardModel = {
  id: "job-1",
  title: "Niñera para dos nenes, tardes",
  salaryLabel: "US$ 18/hora",
  employmentType: "part_time",
  areaLabel: "Washington Heights",
  photoUrl: null,
  publisherName: "Rosa Medina",
};

describe("JobCard", () => {
  afterEach(cleanup);

  it("con foto: la muestra y mantiene el pago como dato protagonista", () => {
    const { container } = render(
      <JobCard job={{ ...BASE, photoUrl: "https://cdn.example.com/local.webp" }} />,
    );

    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.example.com/local.webp");
    expect(screen.getByText("US$ 18/hora")).toBeTruthy();
    expect(screen.getByRole("heading", { name: BASE.title })).toBeTruthy();
  });

  it("sin foto: no hay <img> pero el pago y el puesto siguen a la vista", () => {
    const { container } = render(<JobCard job={BASE} />);

    // El fallback del módulo es un gradiente + ícono (svg), nunca un <img> roto.
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("US$ 18/hora")).toBeTruthy();
    expect(screen.getByRole("heading", { name: BASE.title })).toBeTruthy();
    expect(screen.getByText("Washington Heights")).toBeTruthy();
  });

  it("sin monto cargado dice 'Pago a convenir' en vez de dejar el hueco", () => {
    render(<JobCard job={{ ...BASE, salaryLabel: null }} />);
    expect(screen.getByText(C.salaryToAgree)).toBeTruthy();
  });

  it("muestra la jornada del aviso y omite el chip si no la tiene", () => {
    const { unmount } = render(<JobCard job={BASE} />);
    expect(screen.getByText("Medio tiempo")).toBeTruthy();
    unmount();

    render(<JobCard job={{ ...BASE, employmentType: null }} />);
    expect(screen.queryByText("Medio tiempo")).toBeNull();
    expect(screen.queryByText("Tiempo completo")).toBeNull();
  });

  it("tanto la foto como la píldora llevan al detalle del empleo", () => {
    render(<JobCard job={BASE} />);
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe("/empleos/job-1");
    }
  });
});
