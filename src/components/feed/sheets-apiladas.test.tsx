// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

/**
 * HOJAS APILADAS — las dos regresiones que encontró la revisión del 2026-08-20.
 *
 * Desde que las acciones dejaron de navegar pueden convivir TRES hojas:
 * publicación → comentarios → entrar. El árbol de acá es el MISMO del layout de
 * la app (`AuthSheetProvider` afuera, `CommentsSheetProvider` en el medio,
 * `PostSheetProvider` adentro), y no una maqueta, porque los dos defectos
 * dependían justamente de eso: de que las capas compartan `document` y de en
 * qué orden corren sus limpiezas.
 *
 * Lo que se fija acá:
 *
 *  1. UN Escape cierra UNA hoja, la de arriba. Antes las cerraba todas:
 *     `stopPropagation()` no detiene a otro listener del MISMO nodo.
 *  2. El `<body>` recupera el scroll cuando se va la última. Antes quedaba con
 *     `overflow: hidden` sin ninguna hoja abierta —cada capa restauraba el
 *     valor que había medido al abrirse, y la de afuera había medido el
 *     "hidden" que puso la de adentro— y la página no scrolleaba hasta
 *     recargar. Es el defecto que más duele: deja la pantalla inutilizable.
 *  3. El "atrás" del teléfono cierra la hoja de arriba, no la pantalla.
 *
 * El camino real es `/perfil` → miniatura → "comentar" → Escape (y lo mismo en
 * `/perfil/guardados`, `/negocios/[id]` y `/eventos/[id]`).
 */

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: vi.fn() }),
  usePathname: () => "/perfil",
}));

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

// motion neutralizado: el DOM refleja el estado al instante (patrón del repo).
vi.mock("motion/react", async () =>
  (await import("@/test/motion-mock")).motionMock(),
);

// El panel de auth trae los dos formularios y sus server actions: acá sólo
// importa CUÁNDO se monta su hoja, no qué hay adentro.
vi.mock("@/components/auth/auth-sheet-panel", () => ({
  AuthSheetPanel: () => <div data-testid="panel-auth" />,
}));

// La tarjeta real arrastra medio módulo social; la hoja de publicación se
// prueba como CAPA, no como render.
vi.mock("./post-card", () => ({
  PostCard: () => <article data-testid="post-card" />,
}));

vi.mock("@/app/(app)/feed/post-sheet-actions", () => ({
  fetchPostForSheetAction: async () => ({
    ok: true,
    data: {
      post: { id: "post-1", body: "Hola vecinos", postMenu: { status: "published" } },
      tenantId: "tenant-1",
      viewerId: null,
    },
  }),
}));

vi.mock("@/components/listings", () => ({
  buildTrustSignals: () => [],
  toTrustLevel: () => "nuevo",
  firstNameOf: (name: string) => name,
  PublisherTrust: () => null,
}));

vi.mock("./comment-composer", () => ({
  CommentComposer: () => <div data-testid="composer" />,
}));

// Cliente Supabase falso: la hoja de comentarios abre igual con el hilo vacío,
// que es todo lo que necesita para ser una CAPA.
vi.mock("@/lib/supabase/client", () => {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    in: () => chain,
    or: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
  };
  return {
    createClient: () => ({
      auth: { getUser: async () => ({ data: { user: null } }) },
      from: () => chain,
    }),
  };
});

const { AUTH_REASON, AuthSheetProvider, useRequireAuth } = await import(
  "@/components/auth/auth-sheet"
);
const { CommentsSheetProvider, useCommentsSheet } = await import("./comments-sheet");
const { PostSheetProvider, usePostSheet } = await import("./post-sheet");

const TITULO_PUBLICACION = "Publicación";
const TITULO_COMENTARIOS = "Comentarios";
const TITULO_ENTRAR = AUTH_REASON.comment;

/** Los tres disparadores, montados en la capa más profunda como en la app. */
function Disparadores() {
  const post = usePostSheet();
  const comments = useCommentsSheet();
  const requireAuth = useRequireAuth();
  return (
    <>
      <button type="button" onClick={() => post?.open({ postId: "post-1" })}>
        abrir publicación
      </button>
      <button type="button" onClick={() => comments.open({ postId: "post-1" })}>
        abrir comentarios
      </button>
      <button
        type="button"
        onClick={() => requireAuth({ reason: AUTH_REASON.comment })}
      >
        pedir sesión
      </button>
    </>
  );
}

function Arbol() {
  return (
    <AuthSheetProvider>
      <CommentsSheetProvider>
        <PostSheetProvider>
          <Disparadores />
        </PostSheetProvider>
      </CommentsSheetProvider>
    </AuthSheetProvider>
  );
}

/** Nombres accesibles de las hojas abiertas, de abajo hacia arriba. */
function hojasAbiertas(): string[] {
  return screen
    .queryAllByRole("dialog")
    .map((el) => el.getAttribute("aria-label") ?? el.textContent?.slice(0, 40) ?? "");
}

function hojaAbierta(nombre: string): boolean {
  return screen.queryByRole("dialog", { name: nombre }) !== null;
}

/** Abre las hojas en el orden real: publicación, después su hilo. */
async function abrirPublicacionYComentarios() {
  fireEvent.click(screen.getByText("abrir publicación"));
  await screen.findByRole("dialog", { name: TITULO_PUBLICACION });
  fireEvent.click(screen.getByText("abrir comentarios"));
  await screen.findByRole("dialog", { name: TITULO_COMENTARIOS });
}

/**
 * `history.back()` de jsdom entrega su `popstate` DOS turnos de macrotarea
 * después. Ese aviso tardío puede cruzarse con el test siguiente y cerrarle una
 * hoja que ese test acaba de abrir: es ruido del entorno, no del código. Acá se
 * lo neutraliza y se comprueba por espía que la llamada existe —que es lo que
 * importa: cerrar por UI consume su entrada de historial, para que el próximo
 * "atrás" siga valiendo un paso—. El recorrido real del historial se dispara a
 * mano con `fireEvent.popState`.
 */
let volverAtras: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  document.body.style.overflow = "";
  nav.push.mockClear();
  nav.refresh.mockClear();
  volverAtras = vi.spyOn(window.history, "back").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  volverAtras.mockRestore();
});

describe("hojas apiladas: el teclado", () => {
  it("con UNA hoja abierta, Escape la cierra y el body vuelve a scrollear", async () => {
    // El caso del 95%: lo primero que no se puede romper al tocar el primitivo.
    render(<Arbol />);
    fireEvent.click(screen.getByText("abrir publicación"));
    await screen.findByRole("dialog", { name: TITULO_PUBLICACION });
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryAllByRole("dialog")).toHaveLength(0));
    expect(document.body.style.overflow).toBe("");
  });

  it("un Escape cierra UNA hoja: la de comentarios, no la publicación de atrás", async () => {
    render(<Arbol />);
    await abrirPublicacionYComentarios();
    expect(screen.queryAllByRole("dialog")).toHaveLength(2);

    volverAtras.mockClear();
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(hojaAbierta(TITULO_COMENTARIOS)).toBe(false));
    // Lo que se rompía: la publicación se iba junto con el hilo y la persona
    // aterrizaba en el perfil pelado.
    expect(hojaAbierta(TITULO_PUBLICACION)).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    // Y la entrada de historial de la hoja que se fue se consume sola: sin
    // esto, el "atrás" siguiente sería un toque muerto.
    expect(volverAtras).toHaveBeenCalledTimes(1);
  });

  it("con las TRES apiladas, cada Escape se lleva sólo la de arriba", async () => {
    render(<Arbol />);
    await abrirPublicacionYComentarios();
    fireEvent.click(screen.getByText("pedir sesión"));
    await screen.findByRole("dialog", { name: TITULO_ENTRAR });
    expect(screen.queryAllByRole("dialog")).toHaveLength(3);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(hojaAbierta(TITULO_ENTRAR)).toBe(false));
    expect(hojaAbierta(TITULO_COMENTARIOS)).toBe(true);
    expect(hojaAbierta(TITULO_PUBLICACION)).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(hojaAbierta(TITULO_COMENTARIOS)).toBe(false));
    expect(hojaAbierta(TITULO_PUBLICACION)).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryAllByRole("dialog")).toHaveLength(0));
  });
});

describe("hojas apiladas: el scroll del body", () => {
  /**
   * El requisito que este describe entero existe para sostener: al irse la
   * ÚLTIMA hoja, la página vuelve a scrollear SIEMPRE. Es lo que más duele
   * cuando falla, porque no deja nada en pantalla que se pueda tocar para
   * arreglarlo.
   */
  it("al cerrarse la última capa el body recupera el scroll", async () => {
    render(<Arbol />);
    await abrirPublicacionYComentarios();
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(hojaAbierta(TITULO_COMENTARIOS)).toBe(false));
    // Todavía queda una: sigue bloqueado, y esto también importa (soltarlo acá
    // dejaría el fondo scrolleando debajo de la hoja abierta).
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryAllByRole("dialog")).toHaveLength(0));
    expect(document.body.style.overflow).toBe("");
    expect(hojasAbiertas()).toEqual([]);
  });

  it("dos capas que se van en el MISMO commit no se pisan la restauración", async () => {
    /**
     * La forma exacta del defecto: con las dos hojas cerrándose en un solo
     * commit las limpiezas corren en orden de fiber, la de adentro restauraba
     * `""` y la de afuera —que midió cuando la de adentro ya había puesto
     * `hidden`— volvía a escribir `"hidden"`. Quedaba una página sin scroll y
     * sin ninguna hoja a la vista.
     */
    const { unmount } = render(<Arbol />);
    await abrirPublicacionYComentarios();
    expect(document.body.style.overflow).toBe("hidden");

    act(() => {
      unmount();
    });

    expect(document.body.style.overflow).toBe("");
  });
});

describe("hojas apiladas: no queda nada colgado", () => {
  it("al desmontarse el árbol no sobrevive ningún listener de popstate", async () => {
    const escuchando = new Set<unknown>();
    const altaReal = window.addEventListener.bind(window);
    const bajaReal = window.removeEventListener.bind(window);
    const alta = vi
      .spyOn(window, "addEventListener")
      .mockImplementation((tipo, handler, opciones) => {
        if (tipo === "popstate") escuchando.add(handler);
        altaReal(tipo, handler, opciones);
      });
    const baja = vi
      .spyOn(window, "removeEventListener")
      .mockImplementation((tipo, handler, opciones) => {
        if (tipo === "popstate") escuchando.delete(handler);
        bajaReal(tipo, handler, opciones);
      });

    try {
      const { unmount } = render(<Arbol />);
      await abrirPublicacionYComentarios();
      expect(escuchando.size).toBeGreaterThan(0);

      act(() => {
        unmount();
      });

      expect(escuchando.size).toBe(0);
      // Y el historial NO se toca al desmontar: un `back()` acá le cancelaría a
      // la persona la navegación que causó el desmontaje. La entrada de más se
      // la queda el navegador, que es la semántica correcta — volver atrás
      // devuelve a la pantalla donde la hoja estaba abierta.
      expect(volverAtras).not.toHaveBeenCalled();
    } finally {
      alta.mockRestore();
      baja.mockRestore();
    }
  });

  it("un popstate posterior al desmontaje no le pega a nadie", async () => {
    const { unmount } = render(<Arbol />);
    await abrirPublicacionYComentarios();
    act(() => {
      unmount();
    });

    // El aviso tardío del historial es un caso REAL (jsdom lo entrega dos
    // turnos después; un navegador, cuando la persona ya cambió de pantalla).
    expect(() => fireEvent.popState(window)).not.toThrow();
    expect(document.body.style.overflow).toBe("");
  });
});

describe("hojas apiladas: el botón atrás del teléfono", () => {
  it("el atrás cierra el hilo y devuelve la publicación, no la pantalla", async () => {
    render(<Arbol />);
    await abrirPublicacionYComentarios();

    fireEvent.popState(window);

    await waitFor(() => expect(hojaAbierta(TITULO_COMENTARIOS)).toBe(false));
    // La regresión que describía la revisión: un "atrás" se llevaba las dos
    // hojas Y la página. Acá se lleva una capa y nada más.
    expect(hojaAbierta(TITULO_PUBLICACION)).toBe(true);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("dos atrás seguidos desarman la pila de a una y devuelven el scroll", async () => {
    render(<Arbol />);
    await abrirPublicacionYComentarios();

    fireEvent.popState(window);
    await waitFor(() => expect(hojaAbierta(TITULO_COMENTARIOS)).toBe(false));

    fireEvent.popState(window);
    await waitFor(() => expect(screen.queryAllByRole("dialog")).toHaveLength(0));
    expect(document.body.style.overflow).toBe("");
  });
});
