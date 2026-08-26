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
 *
 * La card ahora también monta `<ProfessionalContactCta>` (spec cliente:
 * "Ver perfil" Y "Contactar"), que por debajo es un `<InlineContact>` — de ahí
 * los mocks de `sendListingMessageAction`/`next/navigation`/`auth-sheet`, los
 * mismos que ya usa `professional-contact-cta.test.tsx`.
 */

const viewer = vi.hoisted(() => ({ open: vi.fn() }));
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const auth = vi.hoisted(() => ({ require: vi.fn() }));

vi.mock("@/components/feed/media-viewer", () => ({
  useMediaViewer: () => ({ open: viewer.open }),
}));

vi.mock("@/app/(app)/mensajes/inline-actions", () => ({
  sendListingMessageAction: mocks.send,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh }),
  usePathname: () => "/profesionales",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/auth/auth-sheet", () => ({
  AUTH_REASON: { message: "Entrá y escribile" },
  useRequireAuth: () => auth.require,
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
  identityVerified: false,
  languages: [],
  rating: { promedio: null, cantidad: 0 },
  publisher: null,
};

function photoButton() {
  return screen.getByRole("button", { name: /ver fotos de/i });
}

function renderCard(overrides: Partial<ProfessionalCardModel> = {}, isLoggedIn = true) {
  return render(
    <ProfessionalCard professional={{ ...BASE, ...overrides }} isLoggedIn={isLoggedIn} />,
  );
}

beforeEach(() => {
  viewer.open.mockReset();
  mocks.send.mockReset();
  nav.push.mockReset();
  auth.require.mockReset();
});
afterEach(cleanup);

describe("ProfessionalCard: la foto abre el visor", () => {
  it("tocar la foto abre el visor con TODO el portfolio", () => {
    renderCard();
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
    renderCard({ photos: undefined });
    fireEvent.click(photoButton());

    expect(viewer.open).toHaveBeenCalledWith({
      items: [{ kind: "image", url: "https://cdn.example.com/prof-1.webp" }],
      authorName: BASE.title,
    });
  });

  it("sin foto real no hay área tocable: el fallback del módulo no es una foto", () => {
    renderCard({ photoUrl: null, photos: [] });

    expect(screen.queryByRole("button", { name: /ver fotos de/i })).toBeNull();
    // La card sigue completa: el título y el CTA no dependen de la foto.
    expect(screen.getByRole("heading", { name: BASE.title })).toBeTruthy();
    expect(screen.getByRole("link", { name: BASE.title })).toBeTruthy();
  });
});

describe("ProfessionalCard: al perfil se entra SOLO por la píldora", () => {
  it('"Ver perfil" apunta al aviso y NO abre el visor', () => {
    renderCard();
    const pill = screen.getByRole("link", { name: BASE.title });

    expect(pill.getAttribute("href")).toBe(`/profesionales/${BASE.id}`);
    fireEvent.click(pill);
    expect(viewer.open).not.toHaveBeenCalled();
  });
});

describe("ProfessionalCard: verificación de credenciales y de identidad, distinguibles", () => {
  it("con verification_check found_active muestra el sello de credenciales con la fecha", () => {
    renderCard({
      verification: {
        registry: "Colegio de Abogados",
        registryUrl: null,
        licenseNumber: "12345",
        dateLabel: "5 de agosto de 2026",
      },
    });

    expect(
      screen.getByText(COPY.professionals.verifiedChip("5 de agosto de 2026")),
    ).toBeTruthy();
  });

  it("sin verification no se afirma nada sobre la matrícula", () => {
    renderCard();
    expect(screen.queryByText(/licencia activa/i)).toBeNull();
  });

  it("las credenciales se listan separadas por '·'", () => {
    renderCard();
    expect(screen.getByText("Matrícula CABA 12345 · 10 años de experiencia")).toBeTruthy();
  });

  it("sin credenciales no deja una línea vacía", () => {
    renderCard({ credentials: [] });
    expect(screen.queryByText(/matrícula/i)).toBeNull();
  });

  it("identidad verificada: insignia propia sobre el avatar, con su propio texto accesible", () => {
    renderCard({
      identityVerified: true,
      publisher: {
        type: "member",
        profileId: "22222222-2222-4222-8222-222222222222",
        displayName: "María Peralta",
        avatarUrl: null,
        score: 72,
        level: "confiable",
        signals: [],
      },
    });

    // Nombre accesible PROPIO ("identidad"), distinto del de credenciales
    // ("Licencia activa…"): las dos insignias tienen que anunciarse distinto.
    expect(screen.getByLabelText("Identidad verificada con documento")).toBeTruthy();
  });

  it("sin identity_verified no aparece la insignia de identidad", () => {
    renderCard({
      identityVerified: false,
      publisher: {
        type: "member",
        profileId: "22222222-2222-4222-8222-222222222222",
        displayName: "María Peralta",
        avatarUrl: null,
        score: 72,
        level: "confiable",
        signals: [],
      },
    });

    expect(screen.queryByLabelText("Identidad verificada con documento")).toBeNull();
  });

  it("ambas insignias pueden convivir y siguen siendo dos textos distintos", () => {
    renderCard({
      identityVerified: true,
      verification: {
        registry: "Colegio de Abogados",
        registryUrl: null,
        licenseNumber: "12345",
        dateLabel: "5 de agosto de 2026",
      },
      publisher: {
        type: "member",
        profileId: "22222222-2222-4222-8222-222222222222",
        displayName: "María Peralta",
        avatarUrl: null,
        score: 72,
        level: "confiable",
        signals: [],
      },
    });

    expect(screen.getByLabelText("Identidad verificada con documento")).toBeTruthy();
    expect(
      screen.getByText(COPY.professionals.verifiedChip("5 de agosto de 2026")),
    ).toBeTruthy();
  });
});

describe("ProfessionalCard: idiomas", () => {
  it("muestra los idiomas traducidos a su nombre legible, separados por '·'", () => {
    renderCard({ languages: ["es", "en"] });
    expect(screen.getByText("Español · Inglés")).toBeTruthy();
  });

  it("sin idiomas no deja una línea vacía", () => {
    renderCard({ languages: [] });
    expect(screen.queryByText(/español|inglés/i)).toBeNull();
  });

  it("un código fuera del catálogo no rompe la card: se omite en vez de mostrar un código crudo", () => {
    // Mismo comportamiento que ProfileInfoPanel (misma función languageLabels):
    // un código que el catálogo no reconoce se filtra, nunca se muestra en crudo.
    renderCard({ languages: ["es", "zz"] });
    expect(screen.getByText("Español")).toBeTruthy();
    expect(screen.queryByText("zz")).toBeNull();
  });
});

describe("ProfessionalCard: calificaciones", () => {
  it("con reseñas muestra el promedio y la cantidad", () => {
    renderCard({ rating: { promedio: 4.5, cantidad: 12 } });
    expect(screen.getByText("4,5 (12)")).toBeTruthy();
  });

  it("sin reseñas dice que todavía no hay, nunca un cero", () => {
    renderCard({ rating: { promedio: null, cantidad: 0 } });
    expect(screen.getByText("Sin reseñas todavía")).toBeTruthy();
    expect(screen.queryByText(/0,0/)).toBeNull();
  });
});

describe("ProfessionalCard: Contactar (spec cliente — junto a Ver perfil)", () => {
  it("hay un botón Contactar además de la píldora Ver perfil", () => {
    renderCard();
    expect(screen.getByRole("button", { name: "Contactar" })).toBeTruthy();
    expect(screen.getByRole("link", { name: BASE.title })).toBeTruthy();
  });

  it("tocar Contactar abre el mensaje ahí mismo, sin navegar", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Contactar" }));

    expect(screen.getByLabelText("Escribí tu mensaje")).toBeTruthy();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("ficha de fuente externa: Contactar explica en vez de abrir un composer", () => {
    renderCard({ publisher: { type: "external", name: "Directorio Comunitario" } });
    fireEvent.click(screen.getByRole("button", { name: "Contactar" }));

    expect(screen.queryByLabelText("Escribí tu mensaje")).toBeNull();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("sin sesión, Contactar pide entrar ahí mismo en vez de navegar", () => {
    renderCard({}, false);
    fireEvent.click(screen.getByRole("button", { name: "Contactar" }));

    expect(nav.push).not.toHaveBeenCalled();
    expect(auth.require).toHaveBeenCalledTimes(1);
  });
});

describe("ProfessionalCard: quién publica", () => {
  it("miembro de la comunidad: se ve su nombre", () => {
    renderCard({
      publisher: {
        type: "member",
        profileId: "22222222-2222-4222-8222-222222222222",
        displayName: "María Peralta",
        avatarUrl: null,
        score: 72,
        level: "confiable",
        signals: [],
      },
    });

    expect(screen.getByText("María Peralta")).toBeTruthy();
  });

  it('el desglose del Trust Score ofrece "Ver perfil" de quien publica', () => {
    // Esta card montaba el badge SIN pasar `profileId`, así que la hoja se
    // abría sin salida: se veía el score de la persona y no había forma de ir
    // a mirar quién es. El dato ya venía en el modelo — sólo no se pasaba.
    renderCard({
      publisher: {
        type: "member",
        profileId: "22222222-2222-4222-8222-222222222222",
        displayName: "María Peralta",
        avatarUrl: null,
        score: 72,
        level: "confiable",
        signals: [],
      },
    });

    // Se llega por el badge: tocar la card nunca navega afuera.
    fireEvent.click(screen.getByRole("button", { name: /trust score/i }));

    const link = screen.getByRole("link", { name: /ver el perfil de maría/i });
    expect(link.getAttribute("href")).toBe(
      "/perfil/22222222-2222-4222-8222-222222222222",
    );
  });

  it("fuente externa: se atribuye por nombre, sin Trust Score", () => {
    renderCard({ publisher: { type: "external", name: "Directorio Comunitario" } });

    expect(
      screen.getByText(COPY.professionals.externalPublisher("Directorio Comunitario")),
    ).toBeTruthy();
  });
});
