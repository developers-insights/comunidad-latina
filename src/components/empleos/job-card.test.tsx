// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { JobCardModel } from "@/app/(app)/empleos/queries";
import { JobCard } from "./job-card";
import { COPY } from "./copy";

/**
 * La card de empleo tiene que aguantar el caso que MÁS se va a dar: un aviso
 * SIN foto (nadie le saca una foto a "busco niñera"). Lo que se fija acá es que
 * sin foto la card no se vacía — el pago y el puesto siguen siendo lo que se
 * lee — y que el monto está siempre presente, aunque el aviso no traiga número.
 *
 * Y desde el feedback 2026-07-26, el reparto de gestos de Vivienda: tocar la
 * FOTO abre el visor con todas las fotos del aviso, y al detalle se entra SOLO
 * por la píldora. Sin foto no hay visor que abrir.
 */

const viewer = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock("@/components/feed/media-viewer", () => ({
  useMediaViewer: () => ({ open: viewer.open }),
}));

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
  photos: [],
  publisherName: "Rosa Medina",
};

const CON_FOTOS: JobCardModel = {
  ...BASE,
  photoUrl: "https://cdn.example.com/local.webp",
  photos: ["https://cdn.example.com/local.webp", "https://cdn.example.com/local-2.webp"],
};

function photoButton() {
  return screen.getByRole("button", { name: /ver fotos de/i });
}

beforeEach(() => viewer.open.mockReset());
afterEach(cleanup);

describe("JobCard", () => {
  it("con foto: la muestra y mantiene el pago como dato protagonista", () => {
    const { container } = render(<JobCard job={CON_FOTOS} />);

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
});

describe("JobCard: la foto abre el visor, la píldora navega", () => {
  it("tocar la foto abre el visor con TODAS las fotos del aviso", () => {
    render(<JobCard job={CON_FOTOS} />);
    fireEvent.click(photoButton());

    expect(viewer.open).toHaveBeenCalledTimes(1);
    expect(viewer.open).toHaveBeenCalledWith({
      items: [
        { kind: "image", url: "https://cdn.example.com/local.webp" },
        { kind: "image", url: "https://cdn.example.com/local-2.webp" },
      ],
      authorName: CON_FOTOS.title,
    });
  });

  it("tocar la foto NO navega: el único link de la card es la píldora", () => {
    render(<JobCard job={CON_FOTOS} />);
    const links = screen.getAllByRole("link");

    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/empleos/job-1");
  });

  it('"Ver empleo" navega al detalle y NO abre el visor', () => {
    render(<JobCard job={CON_FOTOS} />);
    const pill = screen.getByRole("link", { name: CON_FOTOS.title });

    fireEvent.click(pill);
    expect(viewer.open).not.toHaveBeenCalled();
  });

  it("sin foto no hay área tocable: el gradiente del módulo no abre visor", () => {
    render(<JobCard job={BASE} />);
    expect(screen.queryByRole("button", { name: /ver fotos de/i })).toBeNull();
  });
});
