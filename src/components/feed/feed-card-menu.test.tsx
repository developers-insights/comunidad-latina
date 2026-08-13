// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * EL MENÚ ⋯ SOBRE LA TARJETA DEL FEED (0097).
 *
 * El menú se construyó completo pero quedó montado SÓLO en el detalle
 * `/feed/[id]`, y el pedido del cliente era sobre las publicaciones del feed
 * —mandó la captura de un post del feed con el menú abierto—. Este archivo fija
 * las dos cosas que se pueden volver a perder:
 *
 *  1. QUE ESTÉ. Se prueba contra `renderFeedItem`, que es el punto de montaje
 *     real de la lista, no contra `PostCard` a mano: un test que montara la
 *     tarjeta con el menú puesto por el propio test pasaría aunque el feed
 *     hubiera dejado de pasarlo.
 *
 *  2. QUE ABRIRLO NO NAVEGUE. Es el bug con historia en este módulo (commit
 *     af19380: el texto de una publicación con foto sacaba del feed). Se
 *     verifica de las dos formas que pueden fallar por separado: que no se
 *     dispare una navegación por código (`router.push`) y que el botón no tenga
 *     un enlace por encima que lo navegue por HTML.
 */

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
  openComments: vi.fn(),
  togglePin: vi.fn(),
  toggleHide: vi.fn(),
  toggleCommentsLocked: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  usePathname: () => "/feed",
}));
vi.mock("@/app/(app)/feed/post-menu-actions", () => ({
  togglePinPostAction: mocks.togglePin,
  toggleHidePostAction: mocks.toggleHide,
  toggleCommentsLockedAction: mocks.toggleCommentsLocked,
}));
vi.mock("@/app/(app)/feed/engagement-actions", () => ({
  toggleSaveAction: () => Promise.resolve({ ok: true }),
}));
vi.mock("@/app/(app)/feed/load-more", () => ({
  fetchFeedPageAction: () => Promise.resolve({ items: [], nextCursor: null }),
}));
// useToast lanza fuera de su provider: se reemplaza SOLO ese hook y queda el
// resto del módulo real (Avatar, Chip y BottomSheet son parte de lo que se mide).
vi.mock("@/components/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui")>();
  return { ...actual, useToast: () => ({ toast: mocks.toast }) };
});
vi.mock("./comments-sheet", () => ({
  useCommentsSheet: () => ({ open: mocks.openComments }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      insert: () => Promise.resolve({ error: null }),
      delete: () => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }) }),
    }),
  }),
}));

import { renderFeedItem } from "./feed-list";
import { COPY, POST_CARD_COPY } from "./copy";
import type { FeedItem, PostCardModel, PostMenuModel } from "./helpers";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const POST_ID = "22222222-2222-4222-8222-222222222222";
const AUTHOR_ID = "33333333-3333-4333-8333-333333333333";

function postModel(menu: Partial<PostMenuModel> = {}): PostCardModel {
  return {
    id: POST_ID,
    kind: "post",
    body: "Se alquila departamento en el centro",
    photoUrl: null,
    media: [{ kind: "image", url: "https://cdn.example.com/foto.jpg" }],
    likeCount: 4,
    commentCount: 2,
    createdAt: "2026-08-13T12:00:00.000Z",
    timeAgoLabel: "hace un rato",
    author: {
      profileId: AUTHOR_ID,
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
      authorId: AUTHOR_ID,
      status: "published",
      mediaPaths: [`${TENANT_ID}/${AUTHOR_ID}/foto.jpg`],
      pinnedAt: null,
      hiddenAt: null,
      commentsLockedAt: null,
      ...menu,
    },
  };
}

/** Una publicación del feed montada EXACTAMENTE como la monta la lista. */
function renderFeedCard({
  viewerId = AUTHOR_ID,
  menu = {},
}: { viewerId?: string | null; menu?: Partial<PostMenuModel> } = {}) {
  const item: FeedItem = {
    type: "post",
    createdAt: "2026-08-13T12:00:00.000Z",
    id: POST_ID,
    post: postModel(menu),
  };
  return render(<>{renderFeedItem(item, TENANT_ID, viewerId, "para-ti")}</>);
}

const menuButton = () => screen.getByRole("button", { name: COPY.post.menuLabel });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.togglePin.mockResolvedValue({ ok: true });
  mocks.toggleHide.mockResolvedValue({ ok: true });
  mocks.toggleCommentsLocked.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe("el ⋯ vive en la tarjeta del feed, no sólo en el detalle", () => {
  it("la publicación del feed trae su botón de menú", () => {
    renderFeedCard();
    expect(menuButton()).toBeTruthy();
  });

  it("abrirlo muestra las acciones de quien publicó", () => {
    renderFeedCard();
    fireEvent.click(menuButton());

    expect(screen.getByText(COPY.postMenu.pin)).toBeTruthy();
    expect(screen.getByText(COPY.postMenu.hide)).toBeTruthy();
    expect(screen.getByText(COPY.postMenu.lockComments)).toBeTruthy();
  });

  it("a quien no publicó le ofrece sólo lo que puede hacer", () => {
    renderFeedCard({ viewerId: "otra-persona" });
    fireEvent.click(menuButton());

    expect(screen.getByText(COPY.postMenu.openInNewTab)).toBeTruthy();
    expect(screen.queryByText(COPY.postMenu.pin)).toBeNull();
    expect(screen.queryByText(COPY.postMenu.hide)).toBeNull();
  });

  it("los rótulos siguen el estado real de la publicación", () => {
    renderFeedCard({ menu: { pinnedAt: "2026-08-12T10:00:00.000Z" } });
    fireEvent.click(menuButton());

    // Sin esto el menú ofrecería "Fijar" sobre algo ya fijado: es el dato que
    // antes no llegaba a la tarjeta del feed.
    expect(screen.getByText(COPY.postMenu.unpin)).toBeTruthy();
    expect(screen.queryByText(COPY.postMenu.pin)).toBeNull();
  });
});

describe("abrir el menú NO saca del feed", () => {
  it("tocarlo no dispara ninguna navegación", () => {
    renderFeedCard();
    fireEvent.click(menuButton());

    expect(mocks.push).not.toHaveBeenCalled();
    // Y la hoja quedó abierta: si algo hubiera navegado, no habría menú.
    expect(screen.getByText(COPY.postMenu.openInNewTab)).toBeTruthy();
  });

  it("el botón no cuelga de ningún enlace que lo navegue por HTML", () => {
    // La otra mitad del bug, y la que un espía de `router.push` no ve: un
    // <Link> envolviendo la tarjeta navegaría por HTML sin pasar por el router.
    renderFeedCard();
    expect(menuButton().closest("a")).toBeNull();
  });
});

describe("una publicación fijada se ve fijada", () => {
  it("lo dice en la tarjeta, no sólo adentro del menú", () => {
    renderFeedCard({ menu: { pinnedAt: "2026-08-12T10:00:00.000Z" } });
    expect(screen.getByText(POST_CARD_COPY.pinnedLabel)).toBeTruthy();
  });

  it("sin fijar no aparece ninguna marca", () => {
    renderFeedCard();
    expect(screen.queryByText(POST_CARD_COPY.pinnedLabel)).toBeNull();
  });
});
