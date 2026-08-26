// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * CAMBIAR LA MÚSICA DESDE LA PUBLICACIÓN (0090).
 *
 * El composer ya prometía por escrito —copy `attachFailed`— que una canción que
 * no llegó a pegarse se podía agregar "desde la publicación". La puerta no
 * existía: la hoja de edición sólo editaba el texto y las fotos. Este archivo
 * fija las tres cosas que pueden volver a perderse por separado:
 *
 *  1. QUE ESTÉ, y montada desde el feed de verdad (`renderFeedItem`), no
 *     armando la hoja a mano — un test que le pasara `music` él mismo pasaría
 *     aunque la lista hubiera dejado de pasarla.
 *  2. QUE GUARDE AL INSTANTE. La música no espera al botón Guardar, igual que
 *     quitar una foto: se prueba que la action sale con el recorte elegido.
 *  3. QUE SÓLO SE OFREZCA CON FOTO O VIDEO. Sobre un texto, la insignia no
 *     tendría dónde pintarse ni la canción sobre qué sonar.
 */

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  toast: vi.fn(),
  attach: vi.fn(),
  detach: vi.fn(),
  listTracks: vi.fn(),
  editPost: vi.fn(),
  removePhoto: vi.fn(),
  togglePin: vi.fn(),
  toggleHide: vi.fn(),
  toggleCommentsLocked: vi.fn(),
  openComments: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  usePathname: () => "/feed",
}));
vi.mock("@/app/(app)/feed/music-actions", () => ({
  attachPostMusicAction: mocks.attach,
  detachPostMusicAction: mocks.detach,
  listMusicTracksAction: mocks.listTracks,
}));
vi.mock("@/app/(app)/feed/post-edit-actions", () => ({
  editPostAction: mocks.editPost,
  removePostPhotoAction: mocks.removePhoto,
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

import { POST_EDIT_COPY } from "@/lib/social/post-editing";
import { renderFeedItem } from "./feed-list";
import { PostEditSheet } from "./post-edit-sheet";
import { MUSIC_COPY } from "./music-copy";
import { COPY } from "./copy";
import type { FeedItem, PostCardModel, PostMusicView } from "./helpers";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const POST_ID = "22222222-2222-4222-8222-222222222222";
const AUTHOR_ID = "33333333-3333-4333-8333-333333333333";

const TRACK = {
  id: "44444444-4444-4444-8444-444444444444",
  title: "Soy vacana",
  artist: "Comunidad Latina",
  durationSeconds: 193,
  previewUrl: "https://example.test/comunidad-latina.mp3",
  licenseKind: "licensed" as const,
  attributionRequired: false,
  attributionText: null,
  category: "general" as const,
};

const PUESTA: PostMusicView = { track: TRACK, startSeconds: 12 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listTracks.mockResolvedValue({ ok: true, tracks: [TRACK] });
  mocks.attach.mockResolvedValue({ ok: true, startSeconds: 0 });
  mocks.detach.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

function mountSheet(props: Partial<React.ComponentProps<typeof PostEditSheet>> = {}) {
  return render(
    <PostEditSheet
      open
      onClose={() => {}}
      postId={POST_ID}
      initialBody="La feria del sábado"
      hasMedia
      media={[`${TENANT_ID}/${AUTHOR_ID}/feria.jpg`]}
      music={null}
      {...props}
    />,
  );
}

describe("la música se puede poner y sacar desde la publicación ya publicada", () => {
  it("elegir una canción la guarda en el acto, sin esperar a Guardar", async () => {
    mountSheet();

    fireEvent.click(screen.getByText(MUSIC_COPY.add));
    fireEvent.click(await screen.findByText(TRACK.title));
    fireEvent.click(screen.getByRole("button", { name: MUSIC_COPY.done }));

    await waitFor(() => expect(mocks.attach).toHaveBeenCalledTimes(1));
    expect(mocks.attach).toHaveBeenCalledWith({
      postId: POST_ID,
      trackId: TRACK.id,
      startSeconds: 0,
    });
    // El texto NO se tocó: guardar la música no puede marcar el post como editado.
    expect(mocks.editPost).not.toHaveBeenCalled();
  });

  it("una publicación que ya tiene música la muestra y la puede sacar", async () => {
    mountSheet({ music: PUESTA });

    // La pista puesta se ve sin abrir nada: es el valor actual, no una opción.
    expect(screen.getByText(TRACK.title)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: MUSIC_COPY.remove }));

    await waitFor(() => expect(mocks.detach).toHaveBeenCalledWith({ postId: POST_ID }));
    expect(mocks.attach).not.toHaveBeenCalled();
  });

  it("si el servidor rebota, la fila vuelve a la canción anterior y lo dice", async () => {
    mocks.detach.mockResolvedValue({ ok: false, code: "error" });
    mountSheet({ music: PUESTA });

    fireEvent.click(screen.getByRole("button", { name: MUSIC_COPY.remove }));

    expect(await screen.findByText(MUSIC_COPY.editFailed)).toBeTruthy();
    // Lo que se ve tiene que ser lo que quedó publicado, no lo que se intentó.
    expect(screen.getByText(TRACK.title)).toBeTruthy();
  });

  it("sobre una publicación de sólo texto no se ofrece música", () => {
    mountSheet({ hasMedia: false, media: [] });
    expect(screen.queryByText(MUSIC_COPY.add)).toBeNull();
  });

  it("si la superficie no sabe de música, no se ofrece cambiarla a ciegas", () => {
    mountSheet({ music: undefined });
    expect(screen.queryByText(MUSIC_COPY.add)).toBeNull();
  });
});

describe("el feed pasa la música al menú de la publicación", () => {
  function postModel(): PostCardModel {
    return {
      id: POST_ID,
      kind: "post",
      body: "La feria del sábado",
      photoUrl: null,
      media: [{ kind: "image", url: "https://cdn.example.com/feria.jpg" }],
      likeCount: 0,
      commentCount: 0,
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
      music: PUESTA,
      postMenu: {
        authorId: AUTHOR_ID,
        status: "published",
        mediaPaths: [`${TENANT_ID}/${AUTHOR_ID}/feria.jpg`],
        pinnedAt: null,
        hiddenAt: null,
        commentsLockedAt: null,
      },
    };
  }

  it("desde el ⋯ del feed se llega a cambiar la canción", async () => {
    const item: FeedItem = {
      type: "post",
      createdAt: "2026-08-13T12:00:00.000Z",
      id: POST_ID,
      post: postModel(),
    };
    render(<>{renderFeedItem(item, TENANT_ID, AUTHOR_ID, "para-ti")}</>);

    fireEvent.click(screen.getByRole("button", { name: COPY.post.menuLabel }));
    fireEvent.click(await screen.findByText(POST_EDIT_COPY.menu.edit));

    // La sección existe Y llega con la pista puesta: las dos mitades del cable.
    expect(await screen.findByText(MUSIC_COPY.editSectionLabel)).toBeTruthy();
    expect(screen.getByRole("button", { name: MUSIC_COPY.remove })).toBeTruthy();
  });
});
