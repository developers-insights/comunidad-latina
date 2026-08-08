// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BusinessCard, type BusinessCardModel } from "./business-card";

/**
 * Dos cosas se fijan acá (encargo 2026-08-05, módulo NEGOCIOS):
 *
 *   1. Unificación del Trust Score sobre el `PublisherTrust` CANÓNICO
 *      (@/components/listings) — el mismo botón+hoja que usan vivienda,
 *      profesionales y eventos. El viejo `BusinessTrustBadge` reimplementaba
 *      lo mismo con menos: sin "Ver el perfil de…". Estos tests anclan que la
 *      card se comporta EXACTAMENTE como sus hermanas.
 *   2. El sello "Presencia verificada" (`listings.store_verified`) — la card
 *      no mostraba NINGÚN indicador de verificación pese a que el listado ya
 *      tiene el filtro "Verificados".
 *
 * El resto (foto abre el visor / la píldora navega) sigue el mismo contrato
 * que listing-card.test.tsx y event-card.test.tsx — se ancla acá para que
 * "negocios" quede tan cubierta como sus secciones hermanas.
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

const PROFILE_ID = "33333333-3333-4333-8333-333333333333";

const BASE: BusinessCardModel = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  title: "Panadería Doña Flor",
  description: "Pan dominicano recién horneado",
  categoryLabel: "Restaurante",
  areaLabel: "Corona, Queens",
  photoUrl: "https://cdn.example.com/panaderia-1.webp",
  photos: [
    "https://cdn.example.com/panaderia-1.webp",
    "https://cdn.example.com/panaderia-2.webp",
  ],
  ownerTrust: null,
  publisherName: null,
  storeVerified: false,
};

function photoButton() {
  return screen.getByRole("button", { name: /ver fotos de/i });
}

beforeEach(() => viewer.open.mockReset());
afterEach(() => cleanup());

describe("BusinessCard: la foto abre el visor", () => {
  it("tocar la foto abre el visor con TODAS las fotos del negocio", () => {
    render(<BusinessCard business={BASE} />);
    fireEvent.click(photoButton());

    expect(viewer.open).toHaveBeenCalledTimes(1);
    expect(viewer.open).toHaveBeenCalledWith({
      items: [
        { kind: "image", url: "https://cdn.example.com/panaderia-1.webp" },
        { kind: "image", url: "https://cdn.example.com/panaderia-2.webp" },
      ],
      authorName: BASE.title,
    });
  });

  it("sin foto real no hay área tocable", () => {
    render(<BusinessCard business={{ ...BASE, photoUrl: null, photos: [] }} />);

    expect(screen.queryByRole("button", { name: /ver fotos de/i })).toBeNull();
    expect(screen.getByRole("heading", { name: BASE.title })).toBeTruthy();
  });
});

describe("BusinessCard: 'Ver negocio' navega al perfil del negocio", () => {
  it("el link apunta a /negocios/{id} y su nombre accesible dice a qué negocio lleva", () => {
    render(<BusinessCard business={BASE} />);
    const link = screen.getByRole("link", { name: `Ver negocio: ${BASE.title}` });

    expect(link.getAttribute("href")).toBe(`/negocios/${BASE.id}`);
  });
});

describe("BusinessCard: sello de Presencia Verificada (store_verified)", () => {
  it("con store_verified, la card muestra el sello", () => {
    render(<BusinessCard business={{ ...BASE, storeVerified: true }} />);
    expect(screen.getByText("Presencia verificada")).toBeTruthy();
  });

  it("sin store_verified, la card no muestra ningún sello de verificación", () => {
    render(<BusinessCard business={{ ...BASE, storeVerified: false }} />);
    expect(screen.queryByText("Presencia verificada")).toBeNull();
  });
});

describe("BusinessCard: Trust Score del dueño, unificado sobre PublisherTrust", () => {
  const ownerTrust: BusinessCardModel["ownerTrust"] = {
    displayName: "Flor Ramírez",
    firstName: "Flor",
    score: 81,
    level: "confiable",
    signals: [{ label: "Identidad verificada (documento)", achieved: true }],
    profileId: PROFILE_ID,
  };

  it("con ownerTrust, muestra el nombre del dueño y el badge de Trust Score", () => {
    render(<BusinessCard business={{ ...BASE, ownerTrust }} />);

    expect(screen.getByText("Flor Ramírez")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /trust score 81 de 100/i }),
    ).toBeTruthy();
  });

  it("el desglose ofrece 'Ver el perfil de Flor' — la misma gramática que vivienda/profesionales/eventos", () => {
    render(<BusinessCard business={{ ...BASE, ownerTrust }} />);
    fireEvent.click(screen.getByRole("button", { name: /trust score/i }));

    const link = screen.getByRole("link", { name: /ver el perfil de flor/i });
    expect(link.getAttribute("href")).toBe(`/perfil/${PROFILE_ID}`);
  });

  it("sin ownerTrust pero con publisherName (fuente externa), cae al texto 'Publicado por'", () => {
    render(<BusinessCard business={{ ...BASE, ownerTrust: null, publisherName: "Seed API" }} />);

    expect(screen.getByText(/publicado por seed api/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /trust score/i })).toBeNull();
  });
});
