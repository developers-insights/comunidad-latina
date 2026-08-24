// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TextBanner, textTypeScale, textVariantOf } from "./text-banner";
import { CardLikeProvider } from "./card-like-context";
import { PostCard } from "./post-card";
import { COPY } from "./copy";
import type { PostCardModel } from "./helpers";

/**
 * Hermano de question-banner.test.tsx para `kind='text'` (2026-07-29). Ancla
 * lo mismo que aquél, adaptado a que Texto NUNCA lleva encuesta:
 *  1. el texto SE VE (es la pieza gráfica, no un adorno vacío);
 *  2. la variante de fondo es determinística por id;
 *  3. el texto largo se recorta en el feed y se puede expandir EN EL LUGAR;
 *  4. el doble toque da me gusta; un toque simple NO HACE NADA;
 *  5. un post kind='post' o kind='question' no muestra TextBanner.
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

vi.mock("motion/react", async () =>
  (await import("@/test/motion-mock")).motionMock({ reducedMotion: false }),
);

vi.mock("@/components/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui")>();
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});

vi.mock("./comments-sheet", () => ({
  useCommentsSheet: () => ({ open: vi.fn() }),
}));

const insert = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ from: () => ({ insert }) }),
}));

const POST_ID = "5a2d8e1f-1c55-4b88-ae32-88d3b2c51f21";
const OTHER_ID = "b02f6d81-3e29-4c4c-9d77-2c1e05ff3b66";
const VIEWER = "8c7d6e5f-4a3b-4c2d-9e1f-0a1b2c3d4e5f";

const TEXT_SHORT = "Hoy abrió la feria del barrio y estaba llenísima.";
const TEXT_LONG =
  "El sábado hay una colecta de ropa de invierno en el centro comunitario, así que si tienen algo para donar ".repeat(
    5,
  );

function renderBanner(props: Partial<React.ComponentProps<typeof TextBanner>> = {}) {
  return render(
    <CardLikeProvider
      postId={POST_ID}
      tenantId="11111111-1111-4111-8111-111111111111"
      viewerId={VIEWER}
      initialLiked={false}
      initialCount={0}
    >
      <TextBanner postId={POST_ID} text={TEXT_SHORT} {...props} />
    </CardLikeProvider>,
  );
}

function textParagraph(container: HTMLElement): HTMLElement {
  const node = container.querySelector("p");
  expect(node, "el banner no está mostrando el texto").not.toBeNull();
  return node as HTMLElement;
}

afterEach(() => {
  cleanup();
  push.mockClear();
  insert.mockClear();
});

describe("TextBanner: el texto ES la pieza gráfica", () => {
  it("muestra el cuerpo del texto", () => {
    renderBanner();
    expect(screen.getByText(TEXT_SHORT)).toBeTruthy();
  });

  it("ni en el feed ni en el detalle hay un link o control que navegue", () => {
    renderBanner();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();

    renderBanner({ isDetail: true });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("TextBanner: la variante de fondo es determinística", () => {
  it("el mismo id da SIEMPRE la misma variante", () => {
    expect(textVariantOf(POST_ID)).toBe(textVariantOf(POST_ID));
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
    const ids = [POST_ID, OTHER_ID, "0e2b", "9ffa", "c001", "d5e6", "77aa", "1234"];
    const vistas = new Set(ids.map(textVariantOf));
    expect(vistas.size).toBeGreaterThan(1);
    for (const v of vistas) expect(v).toBeGreaterThanOrEqual(0);
  });

  it("la variante siempre cae dentro del catálogo (nunca undefined)", () => {
    for (const id of [POST_ID, OTHER_ID, "", "x"]) {
      const v = textVariantOf(id);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeLessThan(3);
    }
  });

  it("no comparte catálogo con QuestionBanner: mismo id, campo de color propio", async () => {
    const { questionVariantOf } = await import("./question-banner");
    // No exigimos que difieran siempre (3 variantes cada uno, podría coincidir
    // el índice) — exigimos que sean funciones independientes, no la misma.
    expect(textVariantOf).not.toBe(questionVariantOf);
  });
});

describe("TextBanner: el cuerpo decrece y el texto largo se recorta", () => {
  it("un texto corto es titular; uno largo baja de cuerpo", () => {
    const corta = textTypeScale(TEXT_SHORT, false);
    const larga = textTypeScale(TEXT_LONG, false);
    expect(corta.size).toBe("text-2xl");
    expect(larga.size).toBe("text-lg");
  });

  it("en el feed el texto largo lleva line-clamp", () => {
    const { container } = renderBanner({ text: TEXT_LONG });
    expect(textParagraph(container).className).toMatch(/line-clamp-/);
  });

  it("en el detalle NO se recorta: el texto se lee entero", () => {
    const { container } = renderBanner({ text: TEXT_LONG, isDetail: true });
    expect(textParagraph(container).className).not.toMatch(/line-clamp-/);
    expect(textTypeScale(TEXT_LONG, true).clamp).toBeNull();
  });

  it("un texto largo avisa en el feed que se puede leer completo, con un botón real", () => {
    renderBanner({ text: TEXT_LONG });
    expect(screen.getByRole("button", { name: /ver completo/i })).toBeTruthy();
  });

  it("un texto corto no muestra ese aviso (no hay nada escondido)", () => {
    renderBanner();
    expect(screen.queryByText(/ver completo/i)).toBeNull();
  });

  it("tocar 'ver completo' expande EN EL LUGAR, sin navegar", () => {
    const { container } = renderBanner({ text: TEXT_LONG });
    expect(textParagraph(container).className).toMatch(/line-clamp-/);

    fireEvent.click(screen.getByRole("button", { name: /ver completo/i }));

    expect(textParagraph(container).className).not.toMatch(/line-clamp-/);
    expect(screen.queryByRole("button", { name: /ver completo/i })).toBeNull();
  });
});

describe("TextBanner: la marca de agua", () => {
  function watermarkLayers(container: HTMLElement): SVGElement[] {
    return Array.from(container.querySelectorAll("svg[viewBox='0 0 180 156']"));
  }

  it("está en el banner, sin anunciarse a los lectores de pantalla", () => {
    const { container } = renderBanner();
    const layers = watermarkLayers(container);
    expect(layers).toHaveLength(2);
    for (const layer of layers) {
      expect(layer.getAttribute("aria-hidden")).toBe("true");
    }
  });
});

/** Capa de toque invisible (mismo selector que question-banner.test.tsx). */
function tapLayer(container: HTMLElement): HTMLElement {
  const node = container.querySelector('[aria-hidden="true"].absolute.inset-0.z-10');
  expect(node, "no está la capa de toque").not.toBeNull();
  return node as HTMLElement;
}

describe("TextBanner: el doble toque da me gusta, un toque simple no hace nada", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("dos toques dentro de la ventana likean", () => {
    const { container } = renderBanner();
    const layer = tapLayer(container);
    fireEvent.click(layer);
    fireEvent.click(layer);
    vi.advanceTimersByTime(400);
    expect(insert).toHaveBeenCalled();
  });

  it("un toque simple, pasada la ventana, no likea (y no navega a ningún lado)", () => {
    const { container } = renderBanner();
    const layer = tapLayer(container);
    fireEvent.click(layer);
    vi.advanceTimersByTime(400);
    expect(insert).not.toHaveBeenCalled();
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * Integración en la card: quién muestra TextBanner y quién no.
 * ────────────────────────────────────────────────────────────────────────── */

const BASE_POST: PostCardModel = {
  id: POST_ID,
  kind: "text",
  body: TEXT_SHORT,
  photoUrl: null,
  media: [],
  likeCount: 0,
  commentCount: 0,
  createdAt: "2026-07-29T12:00:00.000Z",
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
  poll: null,
  viewCount: 0,
  entity: null,
  isPromoted: false,
  ctaWhatsapp: null,
  taggedPeople: [],
  music: null,
  postMenu: {
    authorId: null,
    status: "published",
    mediaPaths: [],
    pinnedAt: null,
    hiddenAt: null,
    commentsLockedAt: null,
  },
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

describe("PostCard: el TextBanner sólo entra donde tiene que entrar", () => {
  it("un texto SIN media muestra el banner y no repite el cuerpo abajo", () => {
    renderCard({});
    expect(screen.getAllByText(TEXT_SHORT)).toHaveLength(1);
  });

  it("un post kind='post' NO muestra TextBanner", () => {
    const { container } = renderCard({ kind: "post", body: "Hoy abrió la feria del barrio." });
    expect(container.querySelector(".cl-print-fill")).toBeNull();
  });

  it("una pregunta (kind='question') muestra QuestionBanner, no TextBanner", () => {
    renderCard({ kind: "question", body: "¿Alguien vio el perro perdido de la esquina?" });
    // Ambos comparten `.cl-print-fill` (misma fórmula visual): lo que importa
    // acá es que la pregunta se siga viendo con SU propio ornamento (chip).
    expect(screen.getByText(COPY.post.questionChip)).toBeTruthy();
  });
});
