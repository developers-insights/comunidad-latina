// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuestionBanner, questionTypeScale, questionVariantOf } from "./question-banner";
import { CardLikeProvider } from "./card-like-context";
import { PostCard } from "./post-card";
import type { PostCardModel } from "./helpers";

/**
 * Lo que este archivo ancla del banner de preguntas:
 *  1. la pregunta SE VE (es la pieza gráfica, no un adorno vacío);
 *  2. la variante de fondo es determinística por id — el mismo post no cambia de
 *     color al recargar ni entre el feed y el detalle;
 *  3. el texto largo se recorta en el feed y NO se recorta en el detalle;
 *  4. el doble toque da me gusta (misma ventana de 250ms que la foto);
 *  5. un post kind='post' no muestra banner (y una pregunta CON foto tampoco).
 *
 * La animación se neutraliza (mismo patrón que media-viewer.test.tsx): acá se
 * testea el contrato, no los keyframes.
 */

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/feed",
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: unknown;
    children?: React.ReactNode;
  }) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("motion/react", () => {
  const passthrough = (Tag: "p" | "span") =>
    function Stub({
      children,
      ...props
    }: Record<string, unknown> & { children?: React.ReactNode }) {
      const domProps = Object.fromEntries(
        Object.entries(props).filter(
          ([key]) => !["initial", "animate", "exit", "transition", "layout"].includes(key),
        ),
      );
      return <Tag {...domProps}>{children}</Tag>;
    };
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    m: { p: passthrough("p"), span: passthrough("span") },
    motion: { p: passthrough("p"), span: passthrough("span") },
    useReducedMotion: () => false,
  };
});

// La fila de acciones de PostCard pide useToast (lanza fuera de su provider) y
// arrastra la hoja de comentarios con medio Supabase detrás: se recortan las dos
// — acá se testea el banner, no las acciones.
vi.mock("@/components/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui")>();
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});

vi.mock("./comments-sheet", () => ({
  useCommentsSheet: () => ({ open: vi.fn() }),
}));

// El me gusta viaja a Supabase dentro de una transición: acá sólo importa que el
// doble toque MUEVA el estado compartido, no que la escritura llegue.
const insert = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ from: () => ({ insert }) }),
}));

const POST_ID = "3f1c9d2e-0b44-4a77-9d21-77c2a1b40e10";
const OTHER_ID = "a91e5c70-2d18-4f3b-8c66-1b0d94ee2a55";
const VIEWER = "8c7d6e5f-4a3b-4c2d-9e1f-0a1b2c3d4e5f";

const QUESTION_SHORT = "¿Dónde arreglan celulares?";
const QUESTION_LONG =
  "¿Alguien sabe si el consulado sigue tomando turnos por la mañana para renovar el pasaporte, ".repeat(
    5,
  );

function renderBanner(props: Partial<React.ComponentProps<typeof QuestionBanner>> = {}) {
  return render(
    <CardLikeProvider
      postId={POST_ID}
      tenantId="11111111-1111-4111-8111-111111111111"
      viewerId={VIEWER}
      initialLiked={false}
      initialCount={0}
    >
      <QuestionBanner postId={POST_ID} question={QUESTION_SHORT} {...props} />
    </CardLikeProvider>,
  );
}

/** El párrafo de la pregunta: el único <p> del banner. */
function questionParagraph(container: HTMLElement): HTMLElement {
  const node = container.querySelector("p");
  expect(node, "el banner no está mostrando la pregunta").not.toBeNull();
  return node as HTMLElement;
}

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe("QuestionBanner: la pregunta ES la pieza gráfica", () => {
  it("muestra el texto de la pregunta", () => {
    renderBanner();
    expect(screen.getByText(QUESTION_SHORT)).toBeTruthy();
  });

  it("en el feed el banner entero es un link al detalle", () => {
    renderBanner();
    const link = screen.getByRole("link", { name: /ver publicación/i });
    expect(link.getAttribute("href")).toBe(`/feed/${POST_ID}`);
  });

  it("en el detalle no hay link ni control: un toque simple no lleva a ningún lado", () => {
    renderBanner({ isDetail: true });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("QuestionBanner: la variante de fondo es determinística", () => {
  it("el mismo id da SIEMPRE la misma variante", () => {
    expect(questionVariantOf(POST_ID)).toBe(questionVariantOf(POST_ID));
  });

  it("el mismo id pinta el mismo fondo en dos renders distintos", () => {
    const primero = renderBanner().container.firstElementChild as HTMLElement;
    const fondoUno = primero.style.backgroundImage;
    cleanup();
    const segundo = renderBanner().container.firstElementChild as HTMLElement;
    expect(segundo.style.backgroundImage).toBe(fondoUno);
    expect(fondoUno).toContain("linear-gradient");
  });

  it("ids distintos no comparten la misma variante por casualidad", () => {
    // No exigimos que TODO par difiera (hay 3 variantes): exigimos que el hash
    // reparta — con un puñado de ids tienen que aparecer al menos dos variantes.
    const ids = [POST_ID, OTHER_ID, "0e2b", "9ffa", "c001", "d5e6", "77aa", "1234"];
    const vistas = new Set(ids.map(questionVariantOf));
    expect(vistas.size).toBeGreaterThan(1);
    for (const v of vistas) expect(v).toBeGreaterThanOrEqual(0);
  });

  it("la variante siempre cae dentro del catálogo (nunca undefined)", () => {
    for (const id of [POST_ID, OTHER_ID, "", "x"]) {
      const v = questionVariantOf(id);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeLessThan(3);
    }
  });
});

describe("QuestionBanner: el cuerpo decrece y el texto largo se recorta", () => {
  it("una pregunta corta es titular; una larga baja de cuerpo", () => {
    const corta = questionTypeScale(QUESTION_SHORT, false);
    const larga = questionTypeScale(QUESTION_LONG, false);
    expect(corta.size).toBe("text-3xl");
    expect(larga.size).toBe("text-lg");
  });

  it("en el feed el texto largo lleva line-clamp", () => {
    const { container } = renderBanner({ question: QUESTION_LONG });
    expect(questionParagraph(container).className).toMatch(/line-clamp-/);
  });

  it("en el detalle NO se recorta: la pregunta se lee entera", () => {
    const { container } = renderBanner({ question: QUESTION_LONG, isDetail: true });
    expect(questionParagraph(container).className).not.toMatch(/line-clamp-/);
    expect(questionTypeScale(QUESTION_LONG, true).clamp).toBeNull();
  });

  it("una pregunta larga avisa en el feed que se puede leer completa", () => {
    renderBanner({ question: QUESTION_LONG });
    expect(screen.getByText(/ver la pregunta completa/i)).toBeTruthy();
  });

  it("una pregunta corta no muestra ese aviso (no hay nada escondido)", () => {
    renderBanner();
    expect(screen.queryByText(/ver la pregunta completa/i)).toBeNull();
  });
});

describe("QuestionBanner: el doble toque da me gusta", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("dos toques dentro de la ventana likean y NO navegan", () => {
    renderBanner();
    const link = screen.getByRole("link", { name: /ver publicación/i });
    fireEvent.click(link, { detail: 1 });
    fireEvent.click(link, { detail: 1 });
    vi.advanceTimersByTime(400);
    expect(push).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalled();
  });

  it("un toque simple abre el detalle recién pasada la ventana", () => {
    renderBanner();
    const link = screen.getByRole("link", { name: /ver publicación/i });
    fireEvent.click(link, { detail: 1 });
    expect(push).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(push).toHaveBeenCalledWith(`/feed/${POST_ID}`);
  });

  it("el teclado (Enter, detail 0) navega por el link, sin esperar la ventana", () => {
    renderBanner();
    const link = screen.getByRole("link", { name: /ver publicación/i });
    const event = fireEvent.click(link, { detail: 0 });
    // No se llamó a preventDefault: el <Link> real navega solo.
    expect(event).toBe(true);
    expect(push).not.toHaveBeenCalled();
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * Integración en la card: quién muestra banner y quién no.
 * ────────────────────────────────────────────────────────────────────────── */

const BASE_POST: PostCardModel = {
  id: POST_ID,
  kind: "question",
  body: QUESTION_SHORT,
  photoUrl: null,
  media: [],
  likeCount: 0,
  commentCount: 0,
  createdAt: "2026-07-26T12:00:00.000Z",
  timeAgoLabel: "hace un rato",
  author: {
    profileId: null,
    displayName: "María Peralta",
    avatarUrl: null,
    score: 60,
    level: "verificado",
    signals: [],
  },
  likedByViewer: false,
  savedByViewer: false,
  viewCount: 0,
  entity: null,
  isPromoted: false,
  ctaWhatsapp: null,
};

function renderCard(post: Partial<PostCardModel>) {
  return render(
    <PostCard
      post={{ ...BASE_POST, ...post }}
      tenantId="11111111-1111-4111-8111-111111111111"
      viewerId={VIEWER}
    />,
  );
}

describe("PostCard: el banner sólo entra donde tiene que entrar", () => {
  it("una pregunta SIN media muestra el banner y no repite el texto abajo", () => {
    renderCard({});
    // Una sola aparición: el banner ES el cuerpo, no un duplicado de la frase.
    expect(screen.getAllByText(QUESTION_SHORT)).toHaveLength(1);
    expect(screen.getByRole("link", { name: /ver publicación/i })).toBeTruthy();
  });

  it("un post kind='post' NO muestra banner", () => {
    const { container } = renderCard({ kind: "post", body: "Hoy abrió la feria del barrio." });
    expect(container.querySelector(".cl-print-fill")).toBeNull();
  });

  it("una pregunta CON foto sigue el camino normal (manda la foto)", () => {
    const { container } = renderCard({
      media: [{ kind: "image", url: "https://cdn.example.com/foto.webp" }],
    });
    expect(container.querySelector("[style*='linear-gradient']")).toBeNull();
    expect(screen.getByText(QUESTION_SHORT)).toBeTruthy();
  });
});
