// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TextBanner, textTypeScale } from "./text-banner";
import {
  AUTO_TEXT_BACKGROUNDS,
  TEXT_BACKGROUNDS,
  autoTextBackgroundOf,
} from "@/lib/feed/text-backgrounds";
import { CardLikeProvider } from "./card-like-context";
import { PostCard } from "./post-card";
import { COPY } from "./copy";
import type { PostCardModel } from "./helpers";

/**
 * Hermano de question-banner.test.tsx para `kind='text'` (2026-07-29). Ancla
 * lo mismo que aquél, adaptado a que Texto NUNCA lleva encuesta:
 *  1. el texto SE VE (es la pieza gráfica, no un adorno vacío);
 *  2. el fondo: el elegido si hay uno, y si no un sorteo determinístico por id;
 *  3. el texto largo se recorta en el feed y se puede expandir EN EL LUGAR;
 *  4. el doble toque da me gusta; un toque simple NO HACE NADA;
 *  5. un post kind='post' o kind='question' no muestra TextBanner.
 *
 * Y, desde la call del 3/9 (punto 15), lo que el cliente reportó mirando su
 * teléfono: EL CUERPO NO SE ACHICA A MEDIDA QUE SE ESCRIBE. Ese es el bloque
 * "el cuerpo no depende del largo" y es el que no se puede aflojar sin volver
 * al bug: había una escalera de cuatro tamaños atada a la cantidad de
 * caracteres.
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
/** Pasa TEXTO_COMPACTO (280) pero NO el umbral de recorte: la tarjeta crece. */
const TEXT_MEDIO =
  "El sábado hay una colecta de ropa de invierno en el centro comunitario, así que si tienen algo para donar ".repeat(
    3,
  );
/** Bien pasado el umbral de recorte (600): acá sí aparece "Ver completo". */
const TEXT_LONG =
  "El sábado hay una colecta de ropa de invierno en el centro comunitario, así que si tienen algo para donar ".repeat(
    8,
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

function fondoPintado(container: HTMLElement): string {
  const raiz = container.firstElementChild as HTMLElement;
  return raiz.style.backgroundImage;
}

describe("TextBanner: el fondo elegido manda, y si no hay se sortea", () => {
  it("sin fondo elegido, el mismo id pinta el mismo campo en dos renders", () => {
    const uno = fondoPintado(renderBanner().container);
    cleanup();
    const dos = fondoPintado(renderBanner().container);
    expect(dos).toBe(uno);
    expect(uno).toContain("linear-gradient");
  });

  it("sin fondo elegido, el campo es el que sortea el catálogo por id", () => {
    const sorteado = TEXT_BACKGROUNDS.find((f) => f.id === autoTextBackgroundOf(POST_ID));
    expect(fondoPintado(renderBanner().container)).toBe(sorteado!.field);
  });

  it("con un fondo elegido pinta ESE y no el del sorteo", () => {
    // "fiesta" no está en el pozo del sorteo, así que si aparece es porque se
    // eligió — no por casualidad del hash.
    const fiesta = TEXT_BACKGROUNDS.find((f) => f.id === "fiesta")!;
    expect(AUTO_TEXT_BACKGROUNDS).not.toContain("fiesta");
    const { container } = renderBanner({ background: "fiesta" });
    expect(fondoPintado(container)).toBe(fiesta.field);
  });

  it("dos publicaciones con el MISMO id y distinto fondo se ven distintas", () => {
    const uno = fondoPintado(renderBanner({ background: "fiesta" }).container);
    cleanup();
    const dos = fondoPintado(renderBanner({ background: "caribe" }).container);
    expect(dos).not.toBe(uno);
  });

  it("un fondo que el catálogo no conoce cae al sorteo, no a una tarjeta sin fondo", () => {
    const { container } = renderBanner({ background: "violeta-generico" });
    const sorteado = TEXT_BACKGROUNDS.find((f) => f.id === autoTextBackgroundOf(POST_ID));
    expect(fondoPintado(container)).toBe(sorteado!.field);
  });

  it("ids distintos no caen todos en el mismo fondo del sorteo", () => {
    const ids = [POST_ID, OTHER_ID, "0e2b", "9ffa", "c001", "d5e6", "77aa", "1234"];
    expect(new Set(ids.map(autoTextBackgroundOf)).size).toBeGreaterThan(1);
  });
});

/**
 * EL BUG QUE ESTE BLOQUE NO DEJA VOLVER (call 3/9, punto 15): «mientras más se
 * escribe, se van haciendo más pequeñas». Había cuatro cuerpos atados al largo
 * del texto; ahora hay dos, y el segundo entra UNA sola vez, bien tarde.
 */
describe("TextBanner: el cuerpo NO se achica a medida que se escribe", () => {
  it("de 1 a 280 caracteres el cuerpo es SIEMPRE el mismo", () => {
    const largos = [1, 20, 48, 49, 110, 111, 200, 201, 279, 280];
    const cuerpos = new Set(largos.map((n) => textTypeScale("a".repeat(n), false).size));
    expect(cuerpos).toEqual(new Set(["text-2xl"]));
  });

  it("pasados los 280 baja UN escalón, y de ahí no se mueve más", () => {
    const largos = [281, 400, 600, 1200, 2000];
    const cuerpos = new Set(largos.map((n) => textTypeScale("a".repeat(n), false).size));
    expect(cuerpos).toEqual(new Set(["text-xl"]));
  });

  it("en total hay DOS cuerpos posibles, ni uno más", () => {
    const cuerpos = new Set(
      Array.from({ length: 60 }, (_, i) => textTypeScale("a".repeat(i * 40 + 1), false).size),
    );
    expect(cuerpos.size).toBe(2);
  });

  it("el cuerpo no cambia entre el feed y el detalle", () => {
    for (const texto of [TEXT_SHORT, TEXT_MEDIO, TEXT_LONG]) {
      expect(textTypeScale(texto, true).size).toBe(textTypeScale(texto, false).size);
    }
  });

  it("una frase corta se centra; un párrafo se alinea a la izquierda", () => {
    expect(textTypeScale(TEXT_SHORT, false).align).toContain("text-center");
    expect(textTypeScale(TEXT_MEDIO, false).align).toContain("text-left");
  });

  it("el párrafo usa todo el ancho de la tarjeta", () => {
    const { container } = renderBanner({ text: TEXT_MEDIO });
    expect(textParagraph(container).className.split(" ")).toContain("w-full");
  });

  it("el párrafo no queda encogido al contenido (el contenedor no lo centra)", () => {
    const { container } = renderBanner({ text: TEXT_MEDIO });
    const columna = textParagraph(container).parentElement as HTMLElement;
    // `items-center` era la mitad del "espacio pequeño en el centro" que
    // reportó el cliente: encogía el párrafo al ancho de su línea más larga.
    expect(columna.className.split(" ")).not.toContain("items-center");
  });
});

describe("TextBanner: sólo el texto MUY largo se recorta", () => {
  it("un texto de 300 caracteres NO se recorta: la tarjeta crece", () => {
    const { container } = renderBanner({ text: TEXT_MEDIO });
    expect(textParagraph(container).className).not.toMatch(/line-clamp-/);
    expect(screen.queryByRole("button", { name: /ver completo/i })).toBeNull();
  });

  it("en el feed el texto muy largo lleva line-clamp", () => {
    const { container } = renderBanner({ text: TEXT_LONG });
    expect(textParagraph(container).className).toMatch(/line-clamp-/);
  });

  it("en el detalle NO se recorta: el texto se lee entero", () => {
    const { container } = renderBanner({ text: TEXT_LONG, isDetail: true });
    expect(textParagraph(container).className).not.toMatch(/line-clamp-/);
    expect(textTypeScale(TEXT_LONG, true).clamp).toBeNull();
  });

  it("un texto muy largo avisa en el feed que se puede leer completo, con un botón real", () => {
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

  it("en la vista previa del composer nunca aparece el botón", () => {
    renderBanner({ text: TEXT_LONG, preview: true });
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

  it("la card le pasa al banner el fondo que eligió quien publicó", () => {
    const caribe = TEXT_BACKGROUNDS.find((f) => f.id === "caribe")!;
    const { container } = renderCard({ textBackground: "caribe" });
    const banner = container.querySelector(".cl-print-fill") as HTMLElement;
    expect(banner.style.backgroundImage).toBe(caribe.field);
  });

  it("sin fondo elegido (publicación vieja), la card cae al sorteo por id", () => {
    const sorteado = TEXT_BACKGROUNDS.find((f) => f.id === autoTextBackgroundOf(POST_ID))!;
    const { container } = renderCard({ textBackground: null });
    const banner = container.querySelector(".cl-print-fill") as HTMLElement;
    expect(banner.style.backgroundImage).toBe(sorteado.field);
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
