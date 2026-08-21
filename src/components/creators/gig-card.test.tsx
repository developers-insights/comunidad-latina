// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GigCard, type GigCardModel } from "./gig-card";
import { COPY } from "./copy";

/**
 * POSTULARSE DESDE LA CARD (cliente 2026-08-20: "mientras menos pasos mejor").
 *
 * La hoja de propuesta ya existía y ya hablaba con `applyToGig`; lo único que
 * estaba mal era que solo se podía abrir desde `/creadores/[id]`. Lo que este
 * archivo ancla es justamente eso, porque es lo que se pierde en silencio:
 *  · "Postularme" es un BOTÓN — si vuelve a ser un <Link>, navega, y el ahorro
 *    de pasos desaparece sin romper ningún test;
 *  · la hoja se monta SOBRE el listado, sin tocar la URL;
 *  · después de enviar, la card cambia sola a "Ya te postulaste" y NADIE llama
 *    a `router.refresh()`: refrescar sería recargar el listado y su scroll;
 *  · "Ver trabajo" sobrevive como acción secundaria, y sigue siendo el único
 *    control que navega.
 *
 * ── LO QUE SE AGREGÓ EN LA REVISIÓN 2026-08-20 ─────────────────────────────
 *  · el DUEÑO no ve "Postularme", y eso se decide con la identidad de quien
 *    mira (`viewerId`) y no con `applicationsCount`, que es un campo de
 *    presentación que en `/creadores` no viaja para nadie;
 *  · un "ya te habías postulado" NO se pinta como propuesta enviada. Ese era el
 *    peor de los cinco: la app decía "¡Propuesta enviada!" sobre un mensaje que
 *    el servidor descartó en silencio.
 */

const viewer = vi.hoisted(() => ({ open: vi.fn() }));
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const actions = vi.hoisted(() => ({ applyToGig: vi.fn() }));

vi.mock("@/components/feed/media-viewer", () => ({
  useMediaViewer: () => ({ open: viewer.open }),
}));

vi.mock("@/app/(app)/creadores/actions", () => ({
  applyToGig: actions.applyToGig,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh }),
  usePathname: () => "/creadores",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

// motion neutralizado: la hoja aparece en el DOM al instante.
vi.mock("motion/react", () => {
  const filter = (props: Record<string, unknown>) => {
    const {
      layout,
      initial,
      animate,
      exit,
      transition,
      drag,
      dragConstraints,
      dragElastic,
      onDragEnd,
      whileTap,
      whileHover,
      ...rest
    } = props;
    return rest;
  };
  const div = ({
    children,
    ...props
  }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <div {...filter(props)}>{children}</div>
  );
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    m: { div },
    motion: { div },
    useReducedMotion: () => true,
  };
});

const BASE: GigCardModel = {
  id: "gig-1",
  title: "Reels para una panadería dominicana",
  budgetLabel: "$1,000",
  areaLabel: "Corona, Queens",
  photoUrl: null,
  photos: [],
  category: "video",
  urgent: false,
  publisher: { type: "external", name: "Panadería La Bendición" },
};

function applyButton() {
  return screen.getByRole("button", { name: /^postularme a /i });
}

/** Escribe una propuesta válida (≥20 caracteres, sin datos de contacto). */
function writeProposal() {
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Hago reels para gastronomía y te puedo entregar tres videos verticales." },
  });
}

beforeEach(() => {
  viewer.open.mockReset();
  nav.push.mockReset();
  nav.refresh.mockReset();
  actions.applyToGig.mockReset();
  actions.applyToGig.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe("GigCard: postularse se resuelve en la lista", () => {
  it("'Postularme' es un BOTÓN, no un link — no puede navegar aunque se quiera", () => {
    render(<GigCard gig={BASE} />);
    expect(applyButton().tagName).toBe("BUTTON");
    expect(screen.queryByRole("link", { name: /postularme/i })).toBeNull();
  });

  it("abre la hoja SOBRE el listado: aparece el diálogo con la propuesta y nadie navega", async () => {
    render(<GigCard gig={BASE} />);
    fireEvent.click(applyButton());

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText(COPY.apply.intro)).toBeTruthy();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("'Ver trabajo' sigue siendo el ÚNICO control que navega, y se nombra con el aviso", () => {
    render(<GigCard gig={BASE} />);
    const links = screen.getAllByRole("link");

    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/creadores/gig-1");
    // Label-in-name (2.5.3): el nombre accesible contiene el texto visible.
    expect(links[0].getAttribute("aria-label")).toBe(`${COPY.feed.viewGig}: ${BASE.title}`);
  });

  it("después de enviar, la card dice 'Ya te postulaste' sin recargar el listado", async () => {
    render(<GigCard gig={BASE} />);
    fireEvent.click(applyButton());
    await screen.findByRole("dialog");

    writeProposal();
    fireEvent.click(screen.getByRole("button", { name: COPY.apply.submit }));

    expect(await screen.findByText(COPY.apply.successTitle)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Listo" }));

    await waitFor(() => expect(screen.getByText("Ya te postulaste")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /^postularme a /i })).toBeNull();
    // La lista NO se recarga: el estado nuevo ya vive en la card.
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("un 'ya te habías postulado' NO se pinta como propuesta enviada", async () => {
    // El servidor rebotó la unique: no se guardó NADA de lo que se escribió.
    actions.applyToGig.mockResolvedValue({ ok: true, alreadyApplied: true });
    render(<GigCard gig={BASE} />);
    fireEvent.click(applyButton());
    await screen.findByRole("dialog");

    writeProposal();
    fireEvent.click(screen.getByRole("button", { name: COPY.apply.submit }));

    expect(await screen.findByText(/ya te habías postulado/i)).toBeTruthy();
    // Lo que NO puede aparecer: el festejo de un alta que no existió.
    expect(screen.queryByText(COPY.apply.successTitle)).toBeNull();
    expect(screen.queryByText(COPY.apply.successBody)).toBeNull();
    // Y se dice explícitamente que el mensaje nuevo no viajó.
    expect(screen.getByText(/no se envió/i)).toBeTruthy();
  });
});

/**
 * EL DUEÑO NO SE POSTULA A LO SUYO.
 *
 * Esconder el botón no es la barrera —esa vive en `applyToGig`, que compara
 * `created_by` contra la sesión— pero ofrecerlo sería mandar a alguien a un
 * rechazo. Lo que estos tests anclan es CON QUÉ se decide: la identidad de quien
 * mira, nunca `applicationsCount`.
 */
describe("GigCard: el dueño del aviso", () => {
  const OWNER = "owner-1";
  const OWNED: GigCardModel = {
    ...BASE,
    publisher: {
      type: "member",
      profileId: OWNER,
      displayName: "Rosa Peralta",
      avatarUrl: null,
      score: 40,
      level: "nuevo",
      signals: [],
    },
  };

  it("no ve 'Postularme' en su propio aviso", () => {
    render(<GigCard gig={OWNED} viewerId={OWNER} />);

    expect(screen.queryByRole("button", { name: /^postularme a /i })).toBeNull();
    expect(screen.getByRole("link", { name: new RegExp(COPY.feed.viewGig) })).toBeTruthy();
  });

  it("otra persona SÍ ve 'Postularme' en el mismo aviso", () => {
    render(<GigCard gig={OWNED} viewerId="otra-persona" />);

    expect(applyButton()).toBeTruthy();
  });

  it("sin sesión el botón sigue estando: entrar es parte del flujo, no un muro", () => {
    render(<GigCard gig={OWNED} viewerId={null} />);

    expect(applyButton()).toBeTruthy();
  });

  it("`applicationsCount` ya NO decide nada: es un conteo, no una identidad", () => {
    // Antes esto escondía el botón. Es un campo de presentación y en el listado
    // no viaja para nadie, así que el dueño lo veía igual.
    render(<GigCard gig={{ ...OWNED, applicationsCount: 3 }} viewerId="otra-persona" />);

    expect(applyButton()).toBeTruthy();
  });
});
