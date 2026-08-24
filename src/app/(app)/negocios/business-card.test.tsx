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
const cta = vi.hoisted(() => ({ record: vi.fn() }));

vi.mock("@/components/feed/media-viewer", () => ({
  useMediaViewer: () => ({ open: viewer.open }),
}));

// El registro del clic en un CTA es una server action: acá sólo interesa que la
// tarjeta la llame con el kind correcto, no que llegue a la base.
vi.mock("@/lib/monetization/actions", () => ({
  recordCtaClickAction: (input: unknown) => {
    cta.record(input);
    return Promise.resolve({ ok: true });
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

// El composer de "Mensaje" (`InlineContact`) pide router y hoja de sesión. Acá
// no se testea el composer —eso vive en `messaging/inline-contact.test.tsx`—,
// sólo que la tarjeta lo ofrece cuando hay a quién escribirle y no cuando no.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/negocios",
}));

vi.mock("@/components/auth/auth-sheet", () => ({
  AUTH_REASON: { message: "Entrá y escribile", save: "Entrá para guardarlo" },
  useRequireAuth: () => vi.fn(),
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
  rating: { promedio: null, cantidad: 0 },
  apertura: null,
  acciones: [],
  puedeRecibirMensajes: false,
  isLoggedIn: true,
};

function photoButton() {
  return screen.getByRole("button", { name: /ver fotos de/i });
}

beforeEach(() => {
  viewer.open.mockReset();
  cta.record.mockReset();
});
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

/* -------------------------------------------------------------------------- */
/* Lo que la spec sumó a la tarjeta: calificación, abierto/cerrado y acciones  */
/* -------------------------------------------------------------------------- */

describe("BusinessCard: calificación", () => {
  it("con reseñas muestra el promedio y la cantidad", () => {
    render(
      <BusinessCard business={{ ...BASE, rating: { promedio: 4.3, cantidad: 12 } }} />,
    );

    expect(screen.getByText("4,3 (12)")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: /4,3 de 5 estrellas, sobre 12 reseñas/i }),
    ).toBeTruthy();
  });

  it("SIN reseñas dice 'Sin reseñas todavía' y NUNCA un cero", () => {
    render(<BusinessCard business={BASE} />);

    expect(screen.getByText("Sin reseñas todavía")).toBeTruthy();
    // "0,0" o "(0)" leerían como "mal puntuado", que es otra cosa que "nuevo".
    expect(screen.queryByText(/\(0\)/)).toBeNull();
    expect(screen.queryByText("0,0")).toBeNull();
  });
});

describe("BusinessCard: estado de apertura", () => {
  it("abierto muestra el chip y la hora de cierre", () => {
    render(
      <BusinessCard
        business={{
          ...BASE,
          apertura: {
            estado: "abierto",
            cierraA: "18:00",
            tramo: { weekday: 1, opensAt: "09:00", closesAt: "18:00" },
          },
        }}
      />,
    );

    expect(screen.getByText("Abierto ahora")).toBeTruthy();
    expect(screen.getByText("Cierra a las 18:00")).toBeTruthy();
  });

  it("cerrado nombra el DÍA en que abre, no asume 'hoy'", () => {
    render(
      <BusinessCard
        business={{
          ...BASE,
          apertura: { estado: "cerrado", abreA: "09:00", abreDia: 1 },
        }}
      />,
    );

    expect(screen.getByText("Cerrado ahora")).toBeTruthy();
    expect(screen.getByText(/abre el lunes a las 09:00/i)).toBeTruthy();
  });

  it("sin horario cargado no afirma NADA: ni abierto ni cerrado", () => {
    render(<BusinessCard business={{ ...BASE, apertura: { estado: "sin_horario" } }} />);

    expect(screen.queryByText("Abierto ahora")).toBeNull();
    expect(screen.queryByText("Cerrado ahora")).toBeNull();
  });

  it("zona horaria desconocida tampoco afirma nada", () => {
    render(<BusinessCard business={{ ...BASE, apertura: { estado: "zona_desconocida" } }} />);

    expect(screen.queryByText("Abierto ahora")).toBeNull();
    expect(screen.queryByText("Cerrado ahora")).toBeNull();
  });
});

describe("BusinessCard: los botones de la spec, sin ninguno muerto", () => {
  it("sin teléfono ni dirección no se pinta 'Llamar' ni 'Cómo llegar'", () => {
    render(<BusinessCard business={BASE} />);

    expect(screen.queryByRole("link", { name: /llamar a/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /cómo llegar a/i })).toBeNull();
  });

  it("con teléfono, 'Llamar' dice a quién y a qué número", () => {
    render(
      <BusinessCard
        business={{
          ...BASE,
          acciones: [
            { kind: "phone", href: "tel:+13055550134", display: "+1 305 555 0134" },
          ],
        }}
      />,
    );

    const link = screen.getByRole("link", {
      name: `Llamar a ${BASE.title} al +1 305 555 0134`,
    });
    expect(link.getAttribute("href")).toBe("tel:+13055550134");
    // `tel:` NO abre pestaña nueva: dejaría una en blanco detrás del marcador.
    expect(link.getAttribute("target")).toBeNull();
  });

  it("con dirección, 'Cómo llegar' sale a otra pestaña con rel de seguridad", () => {
    render(
      <BusinessCard
        business={{
          ...BASE,
          acciones: [
            {
              kind: "directions",
              href: "https://www.google.com/maps/search/?api=1&query=Roosevelt+Ave",
              display: "103-25 Roosevelt Ave",
            },
          ],
        }}
      />,
    );

    const link = screen.getByRole("link", { name: /cómo llegar a/i });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("el clic en 'Llamar' se registra en cta_clicks con el kind del botón", () => {
    render(
      <BusinessCard
        business={{
          ...BASE,
          acciones: [{ kind: "phone", href: "tel:+13055550134", display: "+1 305" }],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: /llamar a/i }));
    expect(cta.record).toHaveBeenCalledWith({ listingId: BASE.id, kind: "phone" });
  });

  it("'Mensaje' sólo aparece cuando hay dueño con cuenta a quien escribirle", () => {
    render(<BusinessCard business={BASE} />);
    expect(screen.queryByRole("button", { name: /^mensaje$/i })).toBeNull();

    cleanup();
    render(<BusinessCard business={{ ...BASE, puedeRecibirMensajes: true }} />);
    expect(screen.getByRole("button", { name: /mensaje/i })).toBeTruthy();
  });
});
