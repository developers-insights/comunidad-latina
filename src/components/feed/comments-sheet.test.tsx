// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * La hoja de comentarios trae el hilo en el CLIENTE al abrir (Supabase browser),
 * pinta optimista y reconcilia con moderación. Acá se testea ESA lógica —
 * fetch → filtro de bloqueados → lista/vacío/error, y el ciclo optimista— con un
 * cliente Supabase falso y el composer stubeado (no tocamos el server action).
 */

const supa = vi.hoisted(() => ({ client: null as unknown }));
// Se puede encender por test: el auto-scroll del hilo NO debe existir con
// prefers-reduced-motion.
const motionPrefs = vi.hoisted(() => ({ reduce: false }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => supa.client,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/feed",
}));

// next/link sin contexto de router: sólo un <a href>.
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: unknown; children: React.ReactNode }) => (
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
  const div = ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <div {...filter(props)}>{children}</div>
  );
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    m: { div },
    motion: { div },
    useReducedMotion: () => motionPrefs.reduce,
  };
});

// Trust/listings: stubs planos (no es lo que se testea acá).
vi.mock("@/components/listings", () => ({
  buildTrustSignals: () => [],
  toTrustLevel: () => "nuevo",
  firstNameOf: (name: string) => name.split(/\s+/)[0] ?? name,
  PublisherTrust: () => null,
}));

// Composer stubeado: expone los handlers optimistas como botones para dirigir el
// ciclo (onStart/onPublished/onRejected) sin el server action real.
vi.mock("./comment-composer", () => ({
  CommentComposer: ({
    disabled,
    optimistic,
  }: {
    disabled?: boolean;
    optimistic: {
      onStart: (d: { tempId: string; body: string }) => void;
      onPublished: (id: string) => void;
      onRejected: (id: string) => void;
    };
  }) => (
    <div data-testid="composer" data-disabled={String(disabled)}>
      <button
        type="button"
        onClick={() => optimistic.onStart({ tempId: "t1", body: "Comentario nuevo" })}
      >
        stub-start
      </button>
      <button type="button" onClick={() => optimistic.onPublished("t1")}>
        stub-pub
      </button>
      <button type="button" onClick={() => optimistic.onRejected("t1")}>
        stub-rej
      </button>
    </div>
  ),
}));

import {
  CommentsSheetProvider,
  useCommentsSheet,
  type CommentsSurface,
} from "./comments-sheet";

// --- Cliente Supabase falso (builder encadenable + thenable) ----------------

interface Fixtures {
  user?: { id: string } | null;
  comments?: Array<{
    id: string;
    body: string;
    created_at: string;
    author_id: string | null;
    status: string;
  }>;
  commentsError?: boolean;
  blocks?: Array<{ blocked_id: string }>;
  profiles?: Array<{
    id: string;
    display_name: string;
    avatar_url: string | null;
    identity_verified: boolean;
  }>;
  trust?: Array<{ profile_id: string; score: number; level: string; signals: unknown }>;
}

function makeClient(f: Fixtures) {
  const results: Record<string, { data: unknown; error: unknown }> = {
    comments: {
      data: f.comments ?? [],
      error: f.commentsError ? { message: "boom" } : null,
    },
    user_blocks: { data: f.blocks ?? [], error: null },
    profiles: { data: f.profiles ?? [], error: null },
    trust_scores: { data: f.trust ?? [], error: null },
  };
  const chainFor = (table: string) => {
    const result = results[table];
    // Cada método devuelve el mismo builder; el builder es "thenable" y resuelve
    // el fixture de su tabla — modela .select().eq().order().limit()/.in() → await.
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      in: () => chain,
      then: (resolve: (v: unknown) => unknown) => resolve(result),
    };
    return chain;
  };
  return {
    auth: { getUser: async () => ({ data: { user: f.user ?? null } }) },
    from: (table: string) => chainFor(table),
  };
}

function Opener({
  postId,
  count,
  surface,
}: {
  postId: string;
  count?: number;
  surface?: CommentsSurface;
}) {
  const { open } = useCommentsSheet();
  return (
    <button
      type="button"
      onClick={() => open({ postId, commentCount: count, surface })}
    >
      abrir
    </button>
  );
}

function mount(surface?: CommentsSurface) {
  return render(
    <CommentsSheetProvider>
      <Opener postId="p1" count={2} surface={surface} />
    </CommentsSheetProvider>,
  );
}

const ROWS = [
  {
    id: "c1",
    body: "Primer comentario",
    created_at: new Date().toISOString(),
    author_id: "a1",
    status: "published",
  },
  {
    id: "c2",
    body: "Segundo comentario",
    created_at: new Date().toISOString(),
    author_id: null,
    status: "published",
  },
];
const PROFILES = [
  { id: "a1", display_name: "Ana Gómez", avatar_url: null, identity_verified: false },
  { id: "viewer", display_name: "Yo Mismo", avatar_url: null, identity_verified: false },
];

afterEach(cleanup);

describe("CommentsSheet", () => {
  it("abre y muestra el hilo con el conteo real de lo visible", async () => {
    supa.client = makeClient({ user: { id: "viewer" }, comments: ROWS, profiles: PROFILES });
    mount();
    fireEvent.click(screen.getByText("abrir"));

    expect(await screen.findByText("Primer comentario")).toBeTruthy();
    expect(screen.getByText("Segundo comentario")).toBeTruthy();
    expect(screen.getByText("(2)")).toBeTruthy();
  });

  it("filtra comentarios de autores bloqueados por el viewer", async () => {
    supa.client = makeClient({
      user: { id: "viewer" },
      comments: ROWS,
      blocks: [{ blocked_id: "a1" }],
      profiles: PROFILES,
    });
    mount();
    fireEvent.click(screen.getByText("abrir"));

    // El comentario del bloqueado (a1) no aparece; el anónimo (author null) sí.
    expect(await screen.findByText("Segundo comentario")).toBeTruthy();
    expect(screen.queryByText("Primer comentario")).toBeNull();
    expect(screen.getByText("(1)")).toBeTruthy();
  });

  it("hilo vacío: estado cálido de 'sé la primera persona'", async () => {
    supa.client = makeClient({ user: { id: "viewer" }, comments: [] });
    mount();
    fireEvent.click(screen.getByText("abrir"));
    expect(await screen.findByText("Sé la primera persona en responder")).toBeTruthy();
  });

  it("error de carga: mensaje + reintentar que recupera el hilo", async () => {
    supa.client = makeClient({ user: { id: "viewer" }, commentsError: true });
    mount();
    fireEvent.click(screen.getByText("abrir"));

    expect(await screen.findByText("No pudimos cargar los comentarios")).toBeTruthy();

    // Reintento con un cliente sano → aparece el hilo.
    supa.client = makeClient({ user: { id: "viewer" }, comments: ROWS, profiles: PROFILES });
    fireEvent.click(screen.getByText("Reintentar"));
    expect(await screen.findByText("Primer comentario")).toBeTruthy();
  });

  it("anónimo: sin composer, con CTA a entrar y volver", async () => {
    supa.client = makeClient({ user: null, comments: ROWS, profiles: PROFILES });
    mount();
    fireEvent.click(screen.getByText("abrir"));

    expect(await screen.findByText("Primer comentario")).toBeTruthy();
    expect(screen.queryByTestId("composer")).toBeNull();
    const cta = screen.getByText("Entrá a tu cuenta para responder");
    expect(cta.getAttribute("href")).toContain("/entrar?next=");
  });

  it("optimista: aparece al instante y suma al conteo; el rechazo lo retira", async () => {
    supa.client = makeClient({ user: { id: "viewer" }, comments: ROWS, profiles: PROFILES });
    mount();
    fireEvent.click(screen.getByText("abrir"));
    await screen.findByText("Primer comentario");
    expect(screen.getByText("(2)")).toBeTruthy();

    // onStart → aparece "enviando" y el conteo sube a 3.
    fireEvent.click(screen.getByText("stub-start"));
    expect(screen.getByText("Comentario nuevo")).toBeTruthy();
    expect(screen.getByText(/Enviando…/)).toBeTruthy();
    expect(screen.getByText("(3)")).toBeTruthy();

    // onRejected → se retira y el conteo vuelve a 2.
    fireEvent.click(screen.getByText("stub-rej"));
    expect(screen.queryByText("Comentario nuevo")).toBeNull();
    expect(screen.getByText("(2)")).toBeTruthy();
  });

  it("por defecto la hoja es la alta y opaca de siempre", async () => {
    supa.client = makeClient({ user: { id: "viewer" }, comments: ROWS, profiles: PROFILES });
    mount();
    fireEvent.click(screen.getByText("abrir"));
    await screen.findByText("Primer comentario");

    const panel = screen.getByRole("dialog").className;
    expect(panel).toContain("h-[88dvh]");
    expect(panel).toContain("bg-surface-raised");
  });

  it("optimista confirmado: deja de mostrar 'Enviando…' y queda en la lista", async () => {
    supa.client = makeClient({ user: { id: "viewer" }, comments: ROWS, profiles: PROFILES });
    mount();
    fireEvent.click(screen.getByText("abrir"));
    await screen.findByText("Primer comentario");

    fireEvent.click(screen.getByText("stub-start"));
    expect(screen.getByText(/Enviando…/)).toBeTruthy();

    fireEvent.click(screen.getByText("stub-pub"));
    expect(screen.queryByText(/Enviando…/)).toBeNull();
    expect(screen.getByText("Comentario nuevo")).toBeTruthy();
    expect(screen.getByText("(3)")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Hoja SOBRE VIDEO (feedback cliente 2026-07-27)
// ---------------------------------------------------------------------------

/**
 * "¿tú viste cómo salió ahí? que le bloqueó todo el video… ¿puede salir como un
 * poquito más abajo? porque a veces la gente sigue viendo el video y está
 * leyendo los comentarios" + "los comentarios tienen que ser transparente el
 * fondo, no tiene que ser blanco".
 *
 * Lo que se fija acá: media altura, vidrio (nada de superficie opaca), velo del
 * fondo apenas insinuado, texto en tinta de media — y el hilo que se mueve solo
 * PERO se frena apenas la persona toca algo (y nunca arranca con reduced-motion).
 */
describe("CommentsSheet sobre video", () => {
  it("ocupa media pantalla, con vidrio en vez del panel opaco", async () => {
    supa.client = makeClient({ user: { id: "viewer" }, comments: ROWS, profiles: PROFILES });
    mount("video");
    fireEvent.click(screen.getByText("abrir"));
    await screen.findByText("Primer comentario");

    const panel = screen.getByRole("dialog").className;
    // Media altura: arriba sigue viéndose el video.
    expect(panel).toContain("h-[46dvh]");
    expect(panel).not.toContain("h-[88dvh]");
    // Vidrio: velo de media + desenfoque, y NADA de la superficie opaca.
    expect(panel).toContain("bg-media-shade/72");
    expect(panel).toContain("backdrop-blur-2xl");
    expect(panel).not.toContain("bg-surface-raised");
  });

  it("el velo del fondo no tapa el video", async () => {
    supa.client = makeClient({ user: { id: "viewer" }, comments: ROWS, profiles: PROFILES });
    const { container } = mount("video");
    fireEvent.click(screen.getByText("abrir"));
    await screen.findByText("Primer comentario");

    const scrim = container.ownerDocument.querySelector<HTMLElement>(
      "[aria-hidden='true'].absolute.inset-0",
    );
    expect(scrim?.className).toContain("bg-media-shade/25");
    expect(scrim?.className).not.toContain("bg-scrim ");
  });

  it("los comentarios se pintan con la tinta de media, no con burbuja clara", async () => {
    supa.client = makeClient({ user: { id: "viewer" }, comments: ROWS, profiles: PROFILES });
    mount("video");
    fireEvent.click(screen.getByText("abrir"));

    const body = await screen.findByText("Primer comentario");
    expect(body.className).toContain("text-on-media");
    expect(body.parentElement?.className).not.toContain("bg-surface-subtle");
  });
});

// ---------------------------------------------------------------------------
// Generalización a FOTO y PREGUNTA (feedback cliente 2026-08-05: "acá [foto]
// sale en blanco y te tapa toda la imagen… y en las preguntas también sale
// así. No sale con modo vidrio como lo habías hecho anteriormente")
// ---------------------------------------------------------------------------

describe("CommentsSheet sobre foto y sobre banner (pregunta/texto): mismo vidrio que video", () => {
  it.each([
    ["photo", "foto"],
    ["banner", "pregunta/texto"],
  ] as const)("surface=%s (%s): media altura, vidrio, sin panel opaco", async (surface, _label) => {
    supa.client = makeClient({ user: { id: "viewer" }, comments: ROWS, profiles: PROFILES });
    mount(surface);
    fireEvent.click(screen.getByText("abrir"));
    await screen.findByText("Primer comentario");

    const panel = screen.getByRole("dialog").className;
    expect(panel).toContain("h-[46dvh]");
    expect(panel).not.toContain("h-[88dvh]");
    // MISMO tratamiento de contraste que video — nada de token nuevo.
    expect(panel).toContain("bg-media-shade/72");
    expect(panel).toContain("backdrop-blur-2xl");
    expect(panel).not.toContain("bg-surface-raised");
  });

  it.each(["photo", "banner"] as const)(
    "surface=%s: el velo del fondo no tapa el contenido (mismo tinte que video)",
    async (surface) => {
      supa.client = makeClient({ user: { id: "viewer" }, comments: ROWS, profiles: PROFILES });
      const { container } = mount(surface);
      fireEvent.click(screen.getByText("abrir"));
      await screen.findByText("Primer comentario");

      const scrim = container.ownerDocument.querySelector<HTMLElement>(
        "[aria-hidden='true'].absolute.inset-0",
      );
      expect(scrim?.className).toContain("bg-media-shade/25");
    },
  );

  it.each(["photo", "banner"] as const)(
    "surface=%s: los comentarios se pintan en tinta on-media, no en burbuja clara",
    async (surface) => {
      supa.client = makeClient({ user: { id: "viewer" }, comments: ROWS, profiles: PROFILES });
      mount(surface);
      fireEvent.click(screen.getByText("abrir"));

      const body = await screen.findByText("Primer comentario");
      expect(body.className).toContain("text-on-media");
      expect(body.parentElement?.className).not.toContain("bg-surface-subtle");
    },
  );

  it.each(["photo", "banner"] as const)(
    "surface=%s: SIN auto-scroll — eso sigue siendo exclusivo de video",
    async (surface) => {
      supa.client = makeClient({ user: { id: "viewer" }, comments: ROWS, profiles: PROFILES });
      vi.useFakeTimers();
      try {
        mount(surface);
        fireEvent.click(screen.getByText("abrir"));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(50);
        });
        expect(screen.getByText("Primer comentario")).toBeTruthy();

        const thread = document.querySelector<HTMLElement>("[data-comments-thread]");
        if (!thread) throw new Error("no hay hilo");
        Object.defineProperty(thread, "scrollHeight", { value: 1200, configurable: true });
        Object.defineProperty(thread, "clientHeight", { value: 200, configurable: true });
        let top = 0;
        Object.defineProperty(thread, "scrollTop", {
          configurable: true,
          get: () => top,
          set: (next: number) => {
            top = next;
          },
        });

        await act(async () => {
          await vi.advanceTimersByTimeAsync(8000);
        });
        expect(thread.scrollTop).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );
});

describe("CommentsSheet sobre video: el hilo se desplaza solo", () => {
  /** El contenedor del hilo, con un alto simulado (jsdom no hace layout). */
  function primeThread(scrollHeight = 1200, clientHeight = 200) {
    const thread = document.querySelector<HTMLElement>("[data-comments-thread]");
    if (!thread) throw new Error("no hay hilo");
    Object.defineProperty(thread, "scrollHeight", {
      value: scrollHeight,
      configurable: true,
    });
    Object.defineProperty(thread, "clientHeight", {
      value: clientHeight,
      configurable: true,
    });
    let top = 0;
    Object.defineProperty(thread, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (next: number) => {
        top = next;
      },
    });
    return thread;
  }

  async function openOverVideo() {
    supa.client = makeClient({ user: { id: "viewer" }, comments: ROWS, profiles: PROFILES });
    mount("video");
    fireEvent.click(screen.getByText("abrir"));
    // El hilo se trae en el cliente tras un frame: con timers falsos hay que
    // empujar el rAF y dejar resolver las promesas del cliente falso.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.getByText("Primer comentario")).toBeTruthy();
    return primeThread();
  }

  beforeEach(() => {
    motionPrefs.reduce = false;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    motionPrefs.reduce = false;
  });

  it("arranca solo (despacio) después de un respiro", async () => {
    const thread = await openOverVideo();
    expect(thread.scrollTop).toBe(0);

    // Todavía dentro del respiro inicial: quieto.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(thread.scrollTop).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(thread.scrollTop).toBeGreaterThan(5);
  });

  it("se DETIENE apenas la persona toca el hilo, y no vuelve a arrancar sola", async () => {
    const thread = await openOverVideo();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    const moved = thread.scrollTop;
    expect(moved).toBeGreaterThan(5);

    // Rueda / dedo sobre el hilo: la persona tomó el control.
    fireEvent.wheel(thread);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(thread.scrollTop).toBe(moved);
  });

  it("enfocar el campo de escribir también lo detiene", async () => {
    const thread = await openOverVideo();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    const moved = thread.scrollTop;

    fireEvent.focusIn(screen.getByTestId("composer"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(thread.scrollTop).toBe(moved);
  });

  it("con prefers-reduced-motion no se mueve nunca", async () => {
    motionPrefs.reduce = true;
    const thread = await openOverVideo();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(thread.scrollTop).toBe(0);
  });

  it("en la hoja normal del feed no hay desplazamiento automático", async () => {
    supa.client = makeClient({ user: { id: "viewer" }, comments: ROWS, profiles: PROFILES });
    mount();
    fireEvent.click(screen.getByText("abrir"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    const thread = primeThread();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(thread.scrollTop).toBe(0);
  });
});
