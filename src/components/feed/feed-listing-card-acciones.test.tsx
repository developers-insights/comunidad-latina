// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * =============================================================================
 * LA BARRA ADENTRO DE LA TARJETA — SIN SACAR A NADIE DEL FEED
 * =============================================================================
 *
 * `listing-actions.test.tsx` prueba la barra sola: que guardar guarde, que
 * comentar abra la hoja del aviso y que compartir cuente sólo lo que pasó.
 * Acá se prueba la otra mitad, la que sólo se ve montada:
 *
 *   1. que la barra ESTÉ en la tarjeta de ficha (era el pedido literal del
 *      cliente del 2026-08-31, circulado en verde sobre una tarjeta de negocio);
 *   2. que siga sin sacar a nadie del feed.
 *
 * El punto 2 no es paranoia. La regla del 2026-08-20 —«no te tiene que mover a
 * otra publicación; ahí nomás dentro de pantalla se tiene que fluir sin sacarte
 * del feed»— la cumplían dos disparadores que SÍ son links (la foto y "Ver
 * detalles", que interceptan su propio click). Esta barra es lo último que se
 * le agregó a la tarjeta, así que es lo más probable que la rompa: alcanza con
 * que alguien convierta "Compartir" en un `<a href>` "para que se pueda abrir
 * en otra pestaña" y el feed empieza a expulsar en un gesto que antes no
 * existía. Por eso el test no mira sólo que no se navegue: mira que los cuatro
 * botones NO SEAN links.
 */

const viewer = vi.hoisted(() => ({ open: vi.fn(), available: true }));
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const engagement = vi.hoisted(() => ({ toggleSave: vi.fn(), recordShare: vi.fn() }));
const sheet = vi.hoisted(() => ({ openComments: vi.fn() }));
const actions = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  loadJobContext: vi.fn(),
  applyToJob: vi.fn(),
  prepareCvUpload: vi.fn(),
  applyToGig: vi.fn(),
}));

vi.mock("./media-viewer", () => ({
  useMediaViewer: () => ({ open: viewer.open, available: viewer.available }),
}));

vi.mock("./comments-sheet", () => ({
  useCommentsSheet: () => ({ open: sheet.openComments }),
}));

vi.mock("@/app/(app)/feed/engagement-actions", () => ({
  toggleSaveAction: (input: unknown) => {
    engagement.toggleSave(input);
    return Promise.resolve({ ok: true, saved: true });
  },
  recordListingShareAction: (input: unknown) => {
    engagement.recordShare(input);
    return Promise.resolve();
  },
}));

vi.mock("@/app/(app)/mensajes/inline-actions", () => ({
  sendListingMessageAction: actions.sendMessage,
}));

vi.mock("@/app/(app)/empleos/apply-context-action", () => ({
  loadJobApplyContextAction: actions.loadJobContext,
}));

vi.mock("@/app/(app)/empleos/actions", () => ({
  applyToJobAction: actions.applyToJob,
  prepareCvUploadAction: actions.prepareCvUpload,
}));

vi.mock("@/app/(app)/creadores/actions", () => ({
  applyToGig: actions.applyToGig,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: { from: () => ({ remove: vi.fn() }) },
    auth: { getSession: vi.fn(async () => ({ data: { session: null } })) },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh }),
  usePathname: () => "/feed",
}));

vi.mock("@/components/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui")>();
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});

// next/link sin router: sólo un <a href>.
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

vi.mock("motion/react", async () => (await import("@/test/motion-mock")).motionMock());

const { FeedListingCard } = await import("./feed-listing-card");

import type { FeedListingModel } from "./helpers";

const BUSINESS_ID = "bbbbbbbb-2222-4222-8222-222222222222";

/** El mismo aviso que el cliente circuló en verde: una ficha de negocio. */
function negocio(overrides: Partial<FeedListingModel> = {}): FeedListingModel {
  return {
    id: BUSINESS_ID,
    kind: "business",
    title: "Compañía de construcción",
    description: "Remodelaciones y obra chica en Queens.",
    priceLabel: null,
    areaLabel: "Corona, Queens",
    photoUrl: null,
    verifiedDateLabel: null,
    publisherName: "Constructora del Barrio",
    publisherTrust: null,
    ...overrides,
  };
}

/** La ficha está abierta cuando su aviso de seguridad está en pantalla. */
const fichaAbierta = () =>
  screen.queryByRole("note", { name: "Aviso de seguridad" }) !== null;

const boton = (rotulo: string) =>
  screen.getByRole("button", { name: new RegExp(`^${rotulo}`) });

beforeEach(() => {
  viewer.open.mockReset();
  viewer.available = true;
  nav.push.mockReset();
  nav.refresh.mockReset();
  engagement.toggleSave.mockReset();
  engagement.recordShare.mockReset();
  sheet.openComments.mockReset();
});

afterEach(cleanup);

describe("la tarjeta de ficha ya no es sólo 'Ver detalles'", () => {
  it("monta la barra arriba del CTA", () => {
    render(<FeedListingCard listing={negocio()} />);

    expect(boton("Comentarios")).toBeTruthy();
    expect(boton("Compartir")).toBeTruthy();
    expect(boton("Guardar")).toBeTruthy();
    // Y el CTA sigue estando, que es lo que la barra NO vino a reemplazar.
    expect(screen.getByRole("link", { name: /ver detalles/i })).toBeTruthy();
  });

  it("los nombres accesibles dicen de qué aviso se trata", () => {
    render(<FeedListingCard listing={negocio()} />);
    expect(boton("Guardar").getAttribute("aria-label")).toContain(
      "Compañía de construcción",
    );
  });

  it("le pasa a la hoja de comentarios el id del AVISO", () => {
    render(<FeedListingCard listing={negocio()} />);
    fireEvent.click(boton("Comentarios"));

    expect(sheet.openComments).toHaveBeenCalledWith({ listingId: BUSINESS_ID });
  });

  /**
   * `LISTING_COLUMNS` no trae `comment_count` ni los guardados de la tanda: la
   * tarjeta no puede saberlos y no los inventa. El día que `queries.ts` los
   * traiga, este test cambia a propósito — hoy ancla que la ausencia se dibuja
   * como ausencia.
   */
  it("sin datos de engagement no anuncia números que no tiene", () => {
    render(<FeedListingCard listing={negocio()} />);
    expect(boton("Comentarios").textContent).not.toMatch(/\d/);
    expect(screen.queryByRole("button", { name: /^Me gusta/ })).toBeNull();
  });

  it("cuando el feed le pasa los datos, los muestra", () => {
    render(
      <FeedListingCard
        listing={negocio()}
        engagement={{ commentCount: 8, savedByViewer: true }}
      />,
    );
    expect(boton("Comentarios").textContent).toContain("8");
    expect(boton("Quitar de guardados").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("la barra no saca a nadie del feed", () => {
  it("ninguna de sus acciones es un link", () => {
    render(<FeedListingCard listing={negocio()} />);

    // Los ÚNICOS links de la tarjeta siguen siendo los dos disparadores de la
    // ficha (el marco de la foto y el CTA), que interceptan su propio click.
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("aria-label") ?? a.textContent);
    for (const rotulo of ["Comentarios", "Compartir", "Guardar"]) {
      expect(
        links.some((l) => l?.startsWith(rotulo)),
        `"${rotulo}" se volvió un link: eso saca del feed`,
      ).toBe(false);
    }
  });

  it("tocar comentar no navega ni abre la ficha", () => {
    render(<FeedListingCard listing={negocio()} />);
    fireEvent.click(boton("Comentarios"));

    expect(nav.push).not.toHaveBeenCalled();
    expect(fichaAbierta()).toBe(false);
  });

  it("tocar guardar no navega ni abre la ficha", () => {
    render(<FeedListingCard listing={negocio()} />);
    fireEvent.click(boton("Guardar"));

    expect(nav.push).not.toHaveBeenCalled();
    expect(fichaAbierta()).toBe(false);
    expect(engagement.toggleSave).toHaveBeenCalledWith({
      subjectKind: "listing",
      subjectId: BUSINESS_ID,
      save: true,
    });
  });

  it("el CTA sigue abriendo la ficha sin navegar (la regla vieja, intacta)", () => {
    render(<FeedListingCard listing={negocio()} />);
    const cta = screen.getByRole("link", { name: /ver detalles/i });

    // fireEvent devuelve false cuando alguien llamó preventDefault.
    expect(fireEvent.click(cta)).toBe(false);
    expect(fichaAbierta()).toBe(true);
  });
});
