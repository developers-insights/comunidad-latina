// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * La hoja de comentarios es POLIMÓRFICA: el mismo panel sirve el hilo de un post
 * del feed o el de un AVISO del marketplace. Acá se fija la rama LISTING —el
 * hilo sale de la server action, no de Supabase— y que el composer reciba el
 * aviso y no un post. El comportamiento de posts vive en comments-sheet.test.tsx
 * y no cambia.
 */

const actions = vi.hoisted(() => ({
  fetchListingComments: vi.fn(),
}));
// Ver la nota del caso anónimo, abajo: la sesión se pide sin salir del aviso.
const authGate = vi.hoisted(() => ({
  calls: [] as { reason?: string; onAuthenticated?: () => void }[],
}));

vi.mock("@/app/(app)/marketplace/comments-actions", () => ({
  fetchListingCommentsAction: (input: { listingId: string }) =>
    actions.fetchListingComments(input),
  createListingCommentAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/marketplace/l1",
}));

vi.mock("@/components/auth/auth-sheet", () => ({
  AUTH_REASON: { comment: "comment" },
  useRequireAuth: () => (args: { reason?: string; onAuthenticated?: () => void }) => {
    authGate.calls.push(args ?? {});
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("motion/react", async () =>
  (await import("@/test/motion-mock")).motionMock({ reducedMotion: false }),
);

vi.mock("@/components/listings", () => ({
  buildTrustSignals: () => [],
  toTrustLevel: () => "nuevo",
  firstNameOf: (name: string) => name.split(/\s+/)[0] ?? name,
  PublisherTrust: () => null,
}));

// Composer stubeado: expone a QUÉ sujeto le habla, que es lo que importa acá.
vi.mock("./comment-composer", () => ({
  CommentComposer: ({ postId, listingId }: { postId?: string; listingId?: string }) => (
    <div data-testid="composer" data-post={postId ?? ""} data-listing={listingId ?? ""} />
  ),
}));

import {
  CommentsSheetProvider,
  useCommentsSheet,
  type CommentsSurface,
} from "./comments-sheet";

// Cliente Supabase falso: solo auth + los batches de autor (el hilo NO sale de acá).
function makeClient(user: { id: string } | null) {
  const results: Record<string, { data: unknown; error: unknown }> = {
    user_blocks: { data: [], error: null },
    profiles: {
      data: [{ id: "u1", display_name: "Ana Gómez", avatar_url: null, identity_verified: false }],
      error: null,
    },
    trust_scores: { data: [], error: null },
  };
  const chainFor = (table: string) => {
    const result = results[table] ?? { data: [], error: null };
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
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => chainFor(table),
  };
}

const supa = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => supa.client }));

function Opener({ surface }: { surface?: CommentsSurface } = {}) {
  const { open } = useCommentsSheet();
  return (
    <button
      type="button"
      onClick={() => open({ listingId: "l1", commentCount: 1, surface })}
    >
      abrir
    </button>
  );
}

function mount(surface?: CommentsSurface) {
  return render(
    <CommentsSheetProvider>
      <Opener surface={surface} />
    </CommentsSheetProvider>,
  );
}

const ITEMS = [
  {
    id: "lc1",
    authorId: "u1",
    authorName: "Ana Gómez",
    avatarUrl: null,
    body: "¿Sigue disponible?",
    createdAt: new Date().toISOString(),
  },
  {
    id: "lc2",
    authorId: null,
    authorName: "Alguien de la comunidad",
    avatarUrl: null,
    body: "Lo compré ahí, muy bueno",
    createdAt: new Date().toISOString(),
  },
];

describe("CommentsSheet — modo aviso (listing)", () => {
  beforeEach(() => {
    supa.client = makeClient({ id: "viewer" });
    actions.fetchListingComments.mockReset();
  });
  afterEach(cleanup);

  it("trae el hilo por la server action del marketplace y lo muestra", async () => {
    actions.fetchListingComments.mockResolvedValue({
      ok: true,
      items: ITEMS,
      nextCursor: null,
    });
    mount();
    fireEvent.click(screen.getByText("abrir"));

    expect(await screen.findByText("¿Sigue disponible?")).toBeTruthy();
    expect(screen.getByText("Lo compré ahí, muy bueno")).toBeTruthy();
    expect(screen.getByText("(2)")).toBeTruthy();
    expect(actions.fetchListingComments).toHaveBeenCalledWith({ listingId: "l1" });
  });

  it("el composer apunta al AVISO, nunca a un post", async () => {
    actions.fetchListingComments.mockResolvedValue({
      ok: true,
      items: ITEMS,
      nextCursor: null,
    });
    mount();
    fireEvent.click(screen.getByText("abrir"));

    const composer = await screen.findByTestId("composer");
    expect(composer.getAttribute("data-listing")).toBe("l1");
    expect(composer.getAttribute("data-post")).toBe("");
  });

  it("si la action falla, el mismo estado de error con reintento", async () => {
    actions.fetchListingComments.mockResolvedValue({ ok: false, code: "error" });
    mount();
    fireEvent.click(screen.getByText("abrir"));

    expect(await screen.findByText("No pudimos cargar los comentarios")).toBeTruthy();

    actions.fetchListingComments.mockResolvedValue({
      ok: true,
      items: ITEMS,
      nextCursor: null,
    });
    fireEvent.click(screen.getByText("Reintentar"));
    expect(await screen.findByText("¿Sigue disponible?")).toBeTruthy();
  });

  it("hilo vacío: el mismo estado cálido que en un post", async () => {
    actions.fetchListingComments.mockResolvedValue({ ok: true, items: [], nextCursor: null });
    mount();
    fireEvent.click(screen.getByText("abrir"));
    expect(await screen.findByText("Sé la primera persona en responder")).toBeTruthy();
  });

  it("un aviso también puede abrir en modo vidrio (el tipo de surface se comparte con posts)", async () => {
    actions.fetchListingComments.mockResolvedValue({
      ok: true,
      items: ITEMS,
      nextCursor: null,
    });
    mount("photo");
    fireEvent.click(screen.getByText("abrir"));
    await screen.findByText("¿Sigue disponible?");

    const panel = screen.getByRole("dialog").className;
    expect(panel).toContain("bg-media-shade/72");
    expect(panel).not.toContain("bg-surface-raised");
  });

  /**
   * Antes esto se resolvía mandando a /entrar con `next=/marketplace/l1`: se
   * volvía al aviso, sí, pero con la hoja cerrada y la lectura perdida. Desde
   * 2026-08-20 la sesión se pide encima de la hoja y no hay viaje: por eso el
   * test ya no busca un `next` correcto, busca que no haya viaje ninguno.
   */
  it("anónimo: sin composer, y el CTA pide sesión sin salir del aviso", async () => {
    authGate.calls.length = 0;
    supa.client = makeClient(null);
    actions.fetchListingComments.mockResolvedValue({
      ok: true,
      items: ITEMS,
      nextCursor: null,
    });
    mount();
    fireEvent.click(screen.getByText("abrir"));

    expect(await screen.findByText("¿Sigue disponible?")).toBeTruthy();
    expect(screen.queryByTestId("composer")).toBeNull();

    const cta = screen.getByText("Entrá a tu cuenta para responder");
    expect(cta.closest("a")).toBeNull();
    expect(document.querySelectorAll('a[href*="/entrar"]').length).toBe(0);

    fireEvent.click(cta);
    expect(authGate.calls).toHaveLength(1);
    expect(authGate.calls[0].reason).toBe("comment");
  });
});
