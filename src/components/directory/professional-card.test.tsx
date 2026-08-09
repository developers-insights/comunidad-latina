// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProfessionalCard, type ProfessionalCardModel } from "./professional-card";
import { COPY } from "./copy";

/**
 * Card de Profesionales — mismo contrato que EventCard/ListingCard (feedback
 * cliente 2026-07-26): tocar la FOTO abre el visor con TODO el portfolio;
 * "Ver perfil" es la ÚNICA píldora que navega. Se ancla acá igual que en
 * `event-card.test.tsx` porque ProfessionalCard usa el mismo <PhotoTap/>
 * (no el patrón inline de ListingCard) — sin fotos reales no hay botón.
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

const BASE: ProfessionalCardModel = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  title: "Estudio Jurídico Pérez",
  category: "abogado",
  credentials: ["Matrícula CABA 12345", "10 años de experiencia"],
  areaLabel: "Jackson Heights, Queens",
  photoUrl: "https://cdn.example.com/prof-1.webp",
  photos: ["https://cdn.example.com/prof-1.webp", "https://cdn.example.com/prof-2.webp"],
  verification: null,
  publisher: null,
};

function photoButton() {
  return screen.getByRole("button", { name: /ver fotos de/i });
}

beforeEach(() => viewer.open.mockReset());
afterEach(cleanup);

describe("ProfessionalCard: la foto abre el visor", () => {
  it("tocar la foto abre el visor con TODO el portfolio", () => {
    render(<ProfessionalCard professional={BASE} />);
    fireEvent.click(photoButton());

    expect(viewer.open).toHaveBeenCalledTimes(1);
    expect(viewer.open).toHaveBeenCalledWith({
      items: [
        { kind: "image", url: "https://cdn.example.com/prof-1.webp" },
        { kind: "image", url: "https://cdn.example.com/prof-2.webp" },
      ],
      authorName: BASE.title,
    });
  });

  it("sin `photos` (contrato viejo) cae a la única foto que conoce", () => {
    render(<ProfessionalCard professional={{ ...BASE, photos: undefined }} />);
    fireEvent.click(photoButton());

    expect(viewer.open).toHaveBeenCalledWith({
      items: [{ kind: "image", url: "https://cdn.example.com/prof-1.webp" }],
      authorName: BASE.title,
    });
  });

  it("sin foto real no hay área tocable: el fallback del módulo no es una foto", () => {
    render(<ProfessionalCard professional={{ ...BASE, photoUrl: null, photos: [] }} />);

    expect(screen.queryByRole("button", { name: /ver fotos de/i })).toBeNull();
    // La card sigue completa: el título y el CTA no dependen de la foto.
    expect(screen.getByRole("heading", { name: BASE.title })).toBeTruthy();
    expect(screen.getByRole("link", { name: BASE.title })).toBeTruthy();
  });
});

describe("ProfessionalCard: al perfil se entra SOLO por la píldora", () => {
  it('"Ver perfil" apunta al aviso y NO abre el visor', () => {
    render(<ProfessionalCard professional={BASE} />);
    const pill = screen.getByRole("link", { name: BASE.title });

    expect(pill.getAttribute("href")).toBe(`/profesionales/${BASE.id}`);
    fireEvent.click(pill);
    expect(viewer.open).not.toHaveBeenCalled();
  });
});

describe("ProfessionalCard: verificación y credenciales", () => {
  it("con verification_check found_active muestra el sello con la fecha", () => {
    render(
      <ProfessionalCard
        professional={{
          ...BASE,
          verification: {
            registry: "Colegio de Abogados",
            registryUrl: null,
            licenseNumber: "12345",
            dateLabel: "5 de agosto de 2026",
          },
        }}
      />,
    );

    expect(
      screen.getByText(COPY.professionals.verifiedChip("5 de agosto de 2026")),
    ).toBeTruthy();
  });

  it("sin verification no se afirma nada sobre la matrícula", () => {
    render(<ProfessionalCard professional={BASE} />);
    expect(screen.queryByText(/licencia activa/i)).toBeNull();
  });

  it("las credenciales se listan separadas por '·'", () => {
    render(<ProfessionalCard professional={BASE} />);
    expect(screen.getByText("Matrícula CABA 12345 · 10 años de experiencia")).toBeTruthy();
  });

  it("sin credenciales no deja una línea vacía", () => {
    render(<ProfessionalCard professional={{ ...BASE, credentials: [] }} />);
    expect(screen.queryByText(/matrícula/i)).toBeNull();
  });
});

describe("ProfessionalCard: quién publica", () => {
  it("miembro de la comunidad: se ve su nombre", () => {
    render(
      <ProfessionalCard
        professional={{
          ...BASE,
          publisher: {
            type: "member",
            profileId: "22222222-2222-4222-8222-222222222222",
            displayName: "María Peralta",
            avatarUrl: null,
            score: 72,
            level: "confiable",
            signals: [],
          },
        }}
      />,
    );

    expect(screen.getByText("María Peralta")).toBeTruthy();
  });

  it('el desglose del Trust Score ofrece "Ver perfil" de quien publica', () => {
    // Esta card montaba el badge SIN pasar `profileId`, así que la hoja se
    // abría sin salida: se veía el score de la persona y no había forma de ir
    // a mirar quién es. El dato ya venía en el modelo — sólo no se pasaba.
    render(
      <ProfessionalCard
        professional={{
          ...BASE,
          publisher: {
            type: "member",
            profileId: "22222222-2222-4222-8222-222222222222",
            displayName: "María Peralta",
            avatarUrl: null,
            score: 72,
            level: "confiable",
            signals: [],
          },
        }}
      />,
    );

    // Se llega por el badge: tocar la card nunca navega afuera.
    fireEvent.click(screen.getByRole("button", { name: /trust score/i }));

    const link = screen.getByRole("link", { name: /ver el perfil de maría/i });
    expect(link.getAttribute("href")).toBe(
      "/perfil/22222222-2222-4222-8222-222222222222",
    );
  });

  it("fuente externa: se atribuye por nombre, sin Trust Score", () => {
    render(
      <ProfessionalCard
        professional={{
          ...BASE,
          publisher: { type: "external", name: "Directorio Comunitario" },
        }}
      />,
    );

    expect(
      screen.getByText(COPY.professionals.externalPublisher("Directorio Comunitario")),
    ).toBeTruthy();
  });
});
