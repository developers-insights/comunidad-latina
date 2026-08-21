// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * Lo que esta hoja promete (feedback cliente 2026-08-20: "mientras menos pasos
 * mejor") es que tocar una miniatura FUERA del feed deje de navegar. Eso es
 * exactamente lo que se testea acá:
 *
 *  · el toque simple NO navega (el evento queda con preventDefault) y abre la hoja;
 *  · el `href` a /feed/[id] sigue en el DOM — compartir y el deep link no cambian;
 *  · con ctrl/cmd el link vuelve a ser un link (abrir en otra pestaña);
 *  · sin provider no explota: navega como antes.
 *
 * La tarjeta real y la action quedan stubeadas: acá se testea el CAMINO, no el
 * armado del modelo (eso vive en queries.test.ts) ni el render de PostCard.
 */

const action = vi.hoisted(() => ({
  calls: 0,
  result: null as unknown,
}));
// La hoja de autenticación publica un contador de sesiones abiertas: cuando
// alguien entra SIN cerrar esta hoja, ese número cambia. Acá se lo maneja a
// mano para poder simular ese momento.
const authSession = vi.hoisted(() => ({ nonce: 0 }));

vi.mock("@/components/auth/auth-sheet", () => ({
  useAuthSessionNonce: () => authSession.nonce,
}));

vi.mock("@/app/(app)/feed/post-sheet-actions", () => ({
  fetchPostForSheetAction: async () => {
    action.calls += 1;
    return action.result;
  },
}));

// La tarjeta real arrastra medio módulo social; acá alcanza con saber QUÉ post
// recibió.
vi.mock("./post-card", () => ({
  PostCard: ({ post }: { post: { id: string; body: string } }) => (
    <article data-testid="post-card" data-post-id={post.id}>
      {post.body}
    </article>
  ),
}));

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

// motion neutralizado: el DOM refleja el estado al instante (patrón de toast.test).
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

const { PostSheetProvider, PostSheetTrigger } = await import("./post-sheet");

const POST_ID = "11111111-2222-4333-8444-555555555555";

function okResult(overrides?: { status?: string }) {
  return {
    ok: true,
    data: {
      post: {
        id: POST_ID,
        body: "Buscamos un plomero de confianza en el barrio",
        postMenu: { status: overrides?.status ?? "published" },
      },
      tenantId: "tenant-1",
      viewerId: "viewer-1",
    },
  };
}

function renderTrigger({ withProvider = true }: { withProvider?: boolean } = {}) {
  const trigger = (
    <PostSheetTrigger postId={POST_ID} ariaLabel="Abrir la publicación">
      <span>miniatura</span>
    </PostSheetTrigger>
  );
  return render(
    withProvider ? <PostSheetProvider>{trigger}</PostSheetProvider> : trigger,
  );
}

beforeEach(() => {
  action.calls = 0;
  authSession.nonce = 0;
  action.result = okResult();
});

afterEach(() => {
  cleanup();
});

/**
 * Regresión de la auditoría de seguridad (2026-08-20). Quien abre esta hoja
 * siendo anónimo y entra desde adentro (la hoja de autenticación se monta
 * encima) tiene que quedar con la publicación RE-LEÍDA con su identidad. Si el
 * payload viejo sobrevive, la tarjeta le vuelve a pedir sesión a quien ya la
 * tiene —en bucle— y el "guardado"/"me gusta" en pantalla son los del anónimo.
 * En un teléfono compartido eso es mostrar el estado privado de otra cuenta.
 */
describe("PostSheet: entrar sin cerrar la hoja", () => {
  it("vuelve a pedir la publicación cuando cambia la sesión", async () => {
    action.result = {
      ok: true,
      data: {
        post: {
          id: POST_ID,
          body: "Buscamos un plomero de confianza en el barrio",
          postMenu: { status: "published" },
        },
        tenantId: "tenant-1",
        viewerId: null,
      },
    };
    const view = renderTrigger();
    fireEvent.click(screen.getByRole("link", { name: "Abrir la publicación" }));
    await screen.findByText("Buscamos un plomero de confianza en el barrio");
    expect(action.calls).toBe(1);

    // Alguien entró desde adentro de la hoja: el contador sube y el payload
    // pasa a traer un viewer real.
    action.result = okResult();
    authSession.nonce = 1;
    view.rerender(
      <PostSheetProvider>
        <PostSheetTrigger postId={POST_ID} ariaLabel="Abrir la publicación">
          <span>miniatura</span>
        </PostSheetTrigger>
      </PostSheetProvider>,
    );

    await vi.waitFor(() => expect(action.calls).toBe(2));
  });
});

describe("PostSheetTrigger", () => {
  it("el toque simple NO navega: cancela el link y abre la hoja", async () => {
    renderTrigger();
    const link = screen.getByRole("link", { name: "Abrir la publicación" });

    // fireEvent devuelve false cuando alguien llamó preventDefault: eso es,
    // literalmente, "no navegó".
    expect(fireEvent.click(link)).toBe(false);

    expect(
      await screen.findByText("Buscamos un plomero de confianza en el barrio"),
    ).toBeTruthy();
    expect(screen.getByTestId("post-card").getAttribute("data-post-id")).toBe(POST_ID);
  });

  it("conserva el link a /feed/[id]: compartir y el deep link no cambian", () => {
    renderTrigger();
    expect(
      screen.getByRole("link", { name: "Abrir la publicación" }).getAttribute("href"),
    ).toBe(`/feed/${POST_ID}`);
  });

  it("con ctrl/cmd deja pasar el link (abrir en otra pestaña)", () => {
    renderTrigger();
    const link = screen.getByRole("link", { name: "Abrir la publicación" });

    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
    expect(action.calls).toBe(0);
    expect(screen.queryByTestId("post-card")).toBeNull();
  });

  it("sin provider no explota y el toque navega como antes", () => {
    expect(() => renderTrigger({ withProvider: false })).not.toThrow();
    const link = screen.getByRole("link", { name: "Abrir la publicación" });

    expect(fireEvent.click(link)).toBe(true);
    expect(action.calls).toBe(0);
  });
});

describe("hoja de publicación — estados", () => {
  it("una publicación que ya no está se dice con palabras, no con una hoja vacía", async () => {
    action.result = { ok: false, reason: "not-found" };
    renderTrigger();
    fireEvent.click(screen.getByRole("link", { name: "Abrir la publicación" }));

    expect(await screen.findByText("Esta publicación ya no está")).toBeTruthy();
  });

  it("si no se pudo traer, ofrece reintentar y el reintento la trae", async () => {
    action.result = { ok: false, reason: "error" };
    renderTrigger();
    fireEvent.click(screen.getByRole("link", { name: "Abrir la publicación" }));

    expect(await screen.findByText("No pudimos abrir la publicación")).toBeTruthy();

    action.result = okResult();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(
      await screen.findByText("Buscamos un plomero de confianza en el barrio"),
    ).toBeTruthy();
    expect(action.calls).toBe(2);
  });

  it("una publicación en revisión lo dice: mostrarla pelada se leería como publicada", async () => {
    action.result = okResult({ status: "pending_review" });
    renderTrigger();
    fireEvent.click(screen.getByRole("link", { name: "Abrir la publicación" }));

    await screen.findByTestId("post-card");
    // El texto exacto es el del feed (COPY.post.inReviewBanner): acá sólo se
    // verifica que el aviso EXISTE, no se lo duplica.
    const { COPY } = await import("./copy");
    expect(screen.getByText(COPY.post.inReviewBanner)).toBeTruthy();
  });
});
