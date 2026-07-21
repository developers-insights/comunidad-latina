// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * La hoja de comentarios trae el hilo en el CLIENTE al abrir (Supabase browser),
 * pinta optimista y reconcilia con moderación. Acá se testea ESA lógica —
 * fetch → filtro de bloqueados → lista/vacío/error, y el ciclo optimista— con un
 * cliente Supabase falso y el composer stubeado (no tocamos el server action).
 */

const supa = vi.hoisted(() => ({ client: null as unknown }));

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
    useReducedMotion: () => false,
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

import { CommentsSheetProvider, useCommentsSheet } from "./comments-sheet";

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

function Opener({ postId, count }: { postId: string; count?: number }) {
  const { open } = useCommentsSheet();
  return (
    <button type="button" onClick={() => open({ postId, commentCount: count })}>
      abrir
    </button>
  );
}

function mount() {
  return render(
    <CommentsSheetProvider>
      <Opener postId="p1" count={2} />
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
