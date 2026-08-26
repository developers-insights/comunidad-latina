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
// La hoja de autenticación se pide por hook: acá sólo se registra QUE se pidió
// (que es lo que garantiza que nadie navega fuera del feed) y se guarda el
// `onAuthenticated` para poder dispararlo como si la persona hubiera entrado.
const authGate = vi.hoisted(() => ({
  calls: [] as { reason?: string; onAuthenticated?: () => void }[],
}));
// Se puede encender por test: el auto-scroll del hilo NO debe existir con
// prefers-reduced-motion.
const motionPrefs = vi.hoisted(() => ({ reduce: false }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => supa.client,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/feed",
}));

vi.mock("@/components/auth/auth-sheet", () => ({
  AUTH_REASON: { comment: "comment" },
  useRequireAuth: () => (args: { reason?: string; onAuthenticated?: () => void }) => {
    authGate.calls.push(args ?? {});
  },
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
vi.mock("motion/react", async () =>
  // `motionPrefs.reduce` es mutable a propósito: este archivo prueba el hilo
  // desplazándose solo Y detenido, y para eso tiene que poder apagarlo a mitad.
  (await import("@/test/motion-mock")).motionMock({
    reducedMotion: () => motionPrefs.reduce,
  }),
);

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
  /**
   * Estado del POST del hilo (0097): quién lo publicó —puede borrar comentarios
   * de su publicación— y si cerró los comentarios. Sin fixture, la hoja se
   * comporta como antes de la 0097: sin menús y con el campo de escribir.
   */
  post?: {
    author_id: string | null;
    comments_locked_at: string | null;
    /** Comunidad del post: es de donde sale el filtro que usa el índice. */
    tenant_id?: string | null;
  } | null;
  /**
   * TANDAS sucesivas del hilo (keyset): la primera es la que se ve al abrir, la
   * segunda la que trae "Ver comentarios anteriores", y así. Sin esto se usa
   * `comments` para todas las lecturas, que es el caso de un hilo corto.
   */
  commentPages?: Array<
    Array<{
      id: string;
      body: string;
      created_at: string;
      author_id: string | null;
      status: string;
    }>
  >;
}

/** Filtros que recibió la última query de comentarios (para fijar el índice). */
const recorded = { commentsEq: [] as Array<[string, unknown]> };

function makeClient(f: Fixtures) {
  recorded.commentsEq = [];
  let commentsCall = 0;
  const resultFor = (table: string): { data: unknown; error: unknown } => {
    if (table === "comments") {
      if (f.commentPages) {
        const page = f.commentPages[commentsCall] ?? [];
        commentsCall += 1;
        return { data: page, error: null };
      }
      return {
        data: f.comments ?? [],
        error: f.commentsError ? { message: "boom" } : null,
      };
    }
    if (table === "user_blocks") return { data: f.blocks ?? [], error: null };
    if (table === "profiles") return { data: f.profiles ?? [], error: null };
    if (table === "trust_scores") return { data: f.trust ?? [], error: null };
    return { data: f.post ?? null, error: null };
  };
  const chainFor = (table: string) => {
    // Cada método devuelve el mismo builder; el builder es "thenable" y resuelve
    // el fixture de su tabla — modela .select().eq().order().limit()/.in()/.or()
    // → await. `maybeSingle` es la otra forma de rematar la cadena (la usa la
    // lectura del estado del post) y resuelve el MISMO fixture.
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        if (table === "comments") recorded.commentsEq.push([column, value]);
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      in: () => chain,
      or: () => chain,
      maybeSingle: async () => resultFor(table),
      then: (resolve: (v: unknown) => unknown) => resolve(resultFor(table)),
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

  /**
   * El caso que motivó el cambio (cliente 2026-08-20): acá había un `<a>` a
   * /entrar. Alguien tocaba "comentar", la hoja se abría, y lo único que había
   * adentro era el botón que lo sacaba de la app. Ahora la sesión se pide sin
   * salir, así que lo que se fija es lo contrario de antes: que NO haya ningún
   * link a /entrar y que sí se pida la hoja de autenticación.
   */
  it("anónimo: sin composer, y el CTA pide sesión SIN navegar fuera del feed", async () => {
    authGate.calls.length = 0;
    supa.client = makeClient({ user: null, comments: ROWS, profiles: PROFILES });
    mount();
    fireEvent.click(screen.getByText("abrir"));

    expect(await screen.findByText("Primer comentario")).toBeTruthy();
    expect(screen.queryByTestId("composer")).toBeNull();

    const cta = screen.getByText("Entrá a tu cuenta para responder");
    // Ni el CTA ni nada de la hoja puede ser una salida a /entrar.
    expect(cta.closest("a")).toBeNull();
    expect(
      document.querySelectorAll('a[href*="/entrar"]').length,
    ).toBe(0);

    fireEvent.click(cta);
    expect(authGate.calls).toHaveLength(1);
    expect(authGate.calls[0].reason).toBe("comment");
    // Y trae con qué seguir: al volver con sesión el hilo se recarga solo.
    expect(typeof authGate.calls[0].onAuthenticated).toBe("function");
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

// ---------------------------------------------------------------------------
// EL HILO SE PAGINA (antes tenía techo duro de 200 y sin cursor)
// ---------------------------------------------------------------------------

/**
 * El bug que estos tests existen para que no vuelva: el hilo se leía ascendente
 * con `.limit(200)` y sin cursor, así que el comentario 201 no existía para
 * NADIE —tampoco para quien lo escribió— y lo que se perdía era lo más nuevo,
 * o sea la conversación viva. Una publicación viral lo alcanzaba el primer día.
 *
 * Ahora la tanda se lee descendente (los más nuevos, garantizados) y se pinta
 * ascendente (se lee igual que siempre); "Ver comentarios anteriores" va hacia
 * atrás con keyset (created_at, id) — nunca OFFSET, que en un hilo que crece
 * mientras se lee repite y saltea filas.
 */

const PAGE_SIZE = 50;

/** Tanda tal como llega de la base: DESCENDENTE, la más nueva primero. */
function pageOf(prefix: string, count: number, authorId: string | null = "a1") {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    body: `${prefix}-${index}`,
    created_at: new Date(2026, 0, 1, 0, 0, count - index).toISOString(),
    author_id: authorId,
    status: "published",
  }));
}

describe("CommentsSheet — hilo paginado", () => {
  it("trae la tanda MÁS NUEVA y ofrece ir hacia atrás cuando hay más", async () => {
    supa.client = makeClient({
      user: { id: "viewer" },
      profiles: PROFILES,
      // 51 filas: 50 de tanda + la que delata que hay más atrás.
      commentPages: [pageOf("nuevo", PAGE_SIZE + 1)],
    });
    mount();
    fireEvent.click(screen.getByText("abrir"));

    // El más nuevo del hilo SIEMPRE está: es lo que antes se perdía.
    expect(await screen.findByText("nuevo-0")).toBeTruthy();
    expect(screen.getByText(`nuevo-${PAGE_SIZE - 1}`)).toBeTruthy();
    // La fila +1 es sonda, no contenido: no se pinta.
    expect(screen.queryByText(`nuevo-${PAGE_SIZE}`)).toBeNull();
    expect(screen.getByText("Ver comentarios anteriores")).toBeTruthy();
  });

  it("se lee ascendente: el más nuevo queda ABAJO, como siempre", async () => {
    supa.client = makeClient({
      user: { id: "viewer" },
      profiles: PROFILES,
      commentPages: [pageOf("nuevo", 3)],
    });
    mount();
    fireEvent.click(screen.getByText("abrir"));
    await screen.findByText("nuevo-0");

    const bodies = [...document.querySelectorAll("[data-comments-thread] li")].map(
      (item) => item.textContent ?? "",
    );
    // La base los devuelve nuevo-0 (el más nuevo) → nuevo-2; en pantalla van al
    // revés.
    expect(bodies[0]).toContain("nuevo-2");
    expect(bodies[bodies.length - 1]).toContain("nuevo-0");
  });

  it("«ver anteriores» pega los viejos ARRIBA y se apaga al llegar al principio", async () => {
    supa.client = makeClient({
      user: { id: "viewer" },
      profiles: PROFILES,
      commentPages: [pageOf("nuevo", PAGE_SIZE + 1), pageOf("viejo", 2)],
    });
    mount();
    fireEvent.click(screen.getByText("abrir"));
    await screen.findByText("nuevo-0");

    fireEvent.click(screen.getByText("Ver comentarios anteriores"));

    expect(await screen.findByText("viejo-0")).toBeTruthy();
    expect(screen.getByText("viejo-1")).toBeTruthy();
    // Lo que ya se estaba leyendo NO se pierde…
    expect(screen.getByText("nuevo-0")).toBeTruthy();
    // …y los viejos quedan arriba.
    const bodies = [...document.querySelectorAll("[data-comments-thread] li")].map(
      (item) => item.textContent ?? "",
    );
    expect(bodies[0]).toContain("viejo-1");
    // Tanda corta = no hay más atrás: el botón desaparece en vez de mentir.
    expect(screen.queryByText("Ver comentarios anteriores")).toBeNull();
  });

  it("la tanda anterior también filtra a los bloqueados", async () => {
    // Sin esto, "ver anteriores" era la puerta de atrás por la que reaparecía
    // la persona que el viewer bloqueó.
    supa.client = makeClient({
      user: { id: "viewer" },
      profiles: PROFILES,
      blocks: [{ blocked_id: "bloqueado" }],
      commentPages: [
        pageOf("nuevo", PAGE_SIZE + 1),
        pageOf("deBloqueado", 2, "bloqueado"),
      ],
    });
    mount();
    fireEvent.click(screen.getByText("abrir"));
    await screen.findByText("nuevo-0");

    fireEvent.click(screen.getByText("Ver comentarios anteriores"));

    await screen.findByText("nuevo-0");
    expect(screen.queryByText("deBloqueado-0")).toBeNull();
    expect(screen.queryByText("deBloqueado-1")).toBeNull();
  });

  it("pide el hilo con el tenant del post: sin eso el índice no se usa", async () => {
    // `comments_post_thread_idx` es (tenant_id, post_id, created_at, id) y la
    // policy no aporta tenant_id como qual (lo tiene dentro de un OR). Sin este
    // filtro el plan cae a comments_post_fk_idx + Sort en memoria: ordenar los
    // 5.000 comentarios del hilo para devolver 50, en cada apertura.
    supa.client = makeClient({
      user: { id: "viewer" },
      profiles: PROFILES,
      comments: ROWS,
      post: { author_id: "a1", comments_locked_at: null, tenant_id: "t1" },
    });
    mount();
    fireEvent.click(screen.getByText("abrir"));
    await screen.findByText("Primer comentario");

    expect(recorded.commentsEq).toContainEqual(["tenant_id", "t1"]);
    expect(recorded.commentsEq).toContainEqual(["post_id", "p1"]);
  });
});
