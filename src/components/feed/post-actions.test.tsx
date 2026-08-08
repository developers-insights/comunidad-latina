// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Botón "Guardar" de la fila de acciones: optimista con la misma tolerancia a
 * errores que el me gusta (se pinta al instante, se revierte si el server dice
 * que no). La server action va mockeada — acá se testea la UI, no la DB.
 */

const state = vi.hoisted(() => ({
  saveResult: { ok: true, saved: true } as
    | { ok: true; saved: boolean }
    | { ok: false; code: string },
  toggleSave: vi.fn(),
  toast: vi.fn(),
  push: vi.fn(),
  openComments: vi.fn(),
}));

vi.mock("@/app/(app)/feed/engagement-actions", () => ({
  toggleSaveAction: (input: unknown) => {
    state.toggleSave(input);
    return Promise.resolve(state.saveResult);
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push }),
  usePathname: () => "/feed",
}));

// useToast lanza fuera de su provider: reemplazamos SOLO ese hook y dejamos el
// resto del módulo real (el barrel de UI lo usa medio proyecto).
vi.mock("@/components/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui")>();
  return { ...actual, useToast: () => ({ toast: state.toast }) };
});

// La hoja de comentarios no es lo que se testea acá, y su módulo arrastra
// Supabase + las server actions del marketplace: la cortamos de raíz.
vi.mock("./comments-sheet", () => ({
  useCommentsSheet: () => ({ open: state.openComments }),
}));

import { CardMediaProvider } from "./card-media-context";
import { PostActions } from "./post-actions";
import { PostCard } from "./post-card";
import { COPY } from "./copy";
import type { PostMediaView } from "./helpers";

const BASE = {
  postId: "post-1",
  tenantId: "tenant-1",
  viewerId: "user-1",
  likeCount: 3,
  likedByViewer: false,
  commentCount: 2,
};

const saveButton = () => screen.getByRole("button", { name: COPY.post.save });
const savedButton = () => screen.getByRole("button", { name: COPY.post.unsave });

describe("PostActions — guardar", () => {
  beforeEach(() => {
    state.saveResult = { ok: true, saved: true };
    state.toggleSave.mockClear();
    state.toast.mockClear();
    state.push.mockClear();
    state.openComments.mockClear();
  });
  afterEach(cleanup);

  it("guarda optimista: se marca al instante, antes de que responda el server", () => {
    render(<PostActions {...BASE} />);
    fireEvent.click(saveButton());
    expect(savedButton().getAttribute("aria-pressed")).toBe("true");
  });

  it("manda subjectKind post con el id y el estado deseado", async () => {
    render(<PostActions {...BASE} />);
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(state.toggleSave).toHaveBeenCalledWith({
        subjectKind: "post",
        subjectId: "post-1",
        save: true,
      }),
    );
  });

  it("arranca guardado si el modelo lo dice, y se puede desguardar", async () => {
    state.saveResult = { ok: true, saved: false };
    render(<PostActions {...BASE} savedByViewer />);
    fireEvent.click(savedButton());
    expect(saveButton().getAttribute("aria-pressed")).toBe("false");
    await waitFor(() =>
      expect(state.toggleSave).toHaveBeenCalledWith({
        subjectKind: "post",
        subjectId: "post-1",
        save: false,
      }),
    );
  });

  it("si la action falla, revierte y avisa con un toast", async () => {
    state.saveResult = { ok: false, code: "error" };
    render(<PostActions {...BASE} />);
    fireEvent.click(saveButton());
    expect(savedButton()).toBeTruthy(); // optimista primero…

    // …y vuelve atrás cuando el server dice que no.
    await waitFor(() => expect(saveButton().getAttribute("aria-pressed")).toBe("false"));
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: COPY.post.saveErrorTitle, variant: "danger" }),
    );
  });

  it("anónimo: no guarda nada y va a /entrar con retorno", () => {
    render(<PostActions {...BASE} viewerId={null} />);
    fireEvent.click(saveButton());
    expect(saveButton().getAttribute("aria-pressed")).toBe("false");
    expect(state.toggleSave).not.toHaveBeenCalled();
    expect(state.push).toHaveBeenCalledWith("/entrar?next=%2Ffeed");
  });

  it("sesión caída (unauthenticated): revierte y manda a entrar", async () => {
    state.saveResult = { ok: false, code: "unauthenticated" };
    render(<PostActions {...BASE} />);
    fireEvent.click(saveButton());
    await waitFor(() => expect(state.push).toHaveBeenCalledWith("/entrar?next=%2Ffeed"));
    expect(saveButton().getAttribute("aria-pressed")).toBe("false");
    expect(state.toast).not.toHaveBeenCalled();
  });
});

const PHOTO: PostMediaView = { kind: "image", url: "https://cdn.example.com/foto.webp" };
const VIDEO: PostMediaView = { kind: "video", url: "https://cdn.example.com/reel.mp4" };

/**
 * La hoja de comentarios cambia de FORMA según lo que hay detrás (feedback
 * cliente 2026-07-27 sobre video: "le bloqueó todo el video… ¿puede salir
 * como un poquito más abajo?"; feedback cliente 2026-08-05, mismo reclamo
 * pero sobre foto y pregunta: "acá sale en blanco y te tapa toda la
 * imagen… no sale con modo vidrio como lo habías hecho anteriormente").
 * Sobre video O foto se pide la media hoja de vidrio — YA NO hay excepción
 * para la foto, las dos comparten el mismo tratamiento de contraste.
 *
 * El dato de video/foto lo lee del contexto de medios de la card; el de
 * banner (pregunta/texto sin medios) llega por el prop `immersiveBackground`
 * (wiring pendiente desde post-card.tsx, ver su doc en post-actions.tsx).
 */
describe("PostActions — la forma de la hoja sale del contexto de medios", () => {
  beforeEach(() => {
    state.openComments.mockClear();
  });
  afterEach(cleanup);

  const commentsButton = () =>
    screen.getByRole("button", { name: new RegExp(COPY.post.comments) });

  function renderActions(items: PostMediaView[], props: Partial<typeof BASE & { immersiveBackground: boolean }> = {}) {
    return render(
      <CardMediaProvider items={items}>
        <PostActions {...BASE} {...props} />
      </CardMediaProvider>,
    );
  }

  it("con un video a la vista abre la hoja de VIDRIO", () => {
    renderActions([VIDEO]);
    fireEvent.click(commentsButton());
    expect(state.openComments).toHaveBeenCalledWith({
      postId: BASE.postId,
      commentCount: BASE.commentCount,
      surface: "video",
    });
  });

  it("con una foto a la vista TAMBIÉN abre la hoja de VIDRIO", () => {
    renderActions([PHOTO]);
    fireEvent.click(commentsButton());
    expect(state.openComments).toHaveBeenCalledWith({
      postId: BASE.postId,
      commentCount: BASE.commentCount,
      surface: "photo",
    });
  });

  it("un post de puro texto (sin medios, sin banner) no pide superficie", () => {
    renderActions([]);
    fireEvent.click(commentsButton());
    expect(state.openComments.mock.calls[0][0]).not.toHaveProperty("surface");
  });

  it("sin medios pero con banner inmersivo (pregunta/texto) pide vidrio", () => {
    renderActions([], { immersiveBackground: true });
    fireEvent.click(commentsButton());
    expect(state.openComments).toHaveBeenCalledWith({
      postId: BASE.postId,
      commentCount: BASE.commentCount,
      surface: "banner",
    });
  });

  it("con medios, el banner no pisa al video/foto: manda el carrusel", () => {
    renderActions([VIDEO], { immersiveBackground: true });
    fireEvent.click(commentsButton());
    expect(state.openComments).toHaveBeenCalledWith({
      postId: BASE.postId,
      commentCount: BASE.commentCount,
      surface: "video",
    });
  });

  it("fuera de una card con medios no rompe: abre la hoja de siempre", () => {
    render(<PostActions {...BASE} />);
    fireEvent.click(commentsButton());
    expect(state.openComments.mock.calls[0][0]).not.toHaveProperty("surface");
  });
});

/**
 * EL CABLEADO REAL, con el carrusel de por medio. Este es el escenario que el
 * cliente describió con todas las letras: "puede ser un video, dos fotos… y a
 * veces un video, dos fotos y al final el video". Mirando el PRIMER medio, un
 * post [foto, video] abría la hoja alta y opaca justo encima del video que la
 * persona acababa de deslizar — exactamente lo que pidió arreglar dos veces.
 * Con la generalización a foto (2026-08-05) las dos diapositivas piden vidrio,
 * cada una con su propio valor de `surface` — lo que hay que comprobar acá es
 * que la hoja sigue a la diapositiva ACTIVA, no que exista una excepción.
 *
 * Sin estas anclas, la decisión puede volver a congelarse en `media[0]` y nadie
 * se entera hasta que el cliente lo ve otra vez.
 */
describe("PostCard → PostActions: la hoja sigue a la diapositiva ACTIVA", () => {
  beforeEach(() => {
    state.openComments.mockClear();
  });
  afterEach(cleanup);

  const BASE_POST = {
    id: "3f1c9d2e-0b44-4a77-9d21-77c2a1b40e10",
    kind: "post" as const,
    body: "Miren cómo quedó la cancha del barrio.",
    photoUrl: null,
    media: [] as Array<{ kind: "image" | "video"; url: string }>,
    likeCount: 0,
    commentCount: 4,
    createdAt: "2026-07-27T12:00:00.000Z",
    timeAgoLabel: "hace un rato",
    author: {
      profileId: null,
      displayName: "Carlos Reyes",
      avatarUrl: null,
      score: 60,
      level: "verificado" as const,
      signals: [],
    },
    likedByViewer: false,
    savedByViewer: false,
    poll: null,
    viewCount: 0,
    entity: null,
    isPromoted: false,
    ctaWhatsapp: null,
  };

  function renderCard(media: PostMediaView[]) {
    return render(
      <PostCard
        post={{ ...BASE_POST, media }}
        tenantId="11111111-1111-4111-8111-111111111111"
        viewerId="user-1"
      />,
    );
  }

  /**
   * El swipe: en jsdom el riel mide 0, así que le fijamos el ancho de un móvil
   * (375px) y disparamos el scroll a mano — es lo que hace el navegador al
   * soltar el dedo con scroll-snap.
   */
  function swipeTo(container: HTMLElement, index: number, width = 375) {
    const node = container.querySelector<HTMLElement>("[data-carousel-track]");
    if (!node) throw new Error("no hay riel: la card no montó el carrusel");
    Object.defineProperty(node, "clientWidth", { value: width, configurable: true });
    node.scrollLeft = index * width;
    fireEvent.scroll(node);
  }

  const openComments = () =>
    fireEvent.click(screen.getByRole("button", { name: new RegExp(COPY.post.comments) }));

  /** Con qué se abrió la hoja la ÚLTIMA vez (se abre varias por test). */
  const lastOpen = () => state.openComments.mock.calls.at(-1)?.[0];

  it("[foto, video]: en la foto pide vidrio de FOTO; deslizando al video, vidrio de VIDEO", () => {
    const { container } = renderCard([PHOTO, VIDEO]);

    openComments();
    expect(lastOpen()).toMatchObject({ surface: "photo" });

    swipeTo(container, 1);
    openComments();
    expect(lastOpen()).toMatchObject({ surface: "video" });
  });

  it("[video, foto]: arranca de vidrio de VIDEO y al deslizar a la foto pasa a vidrio de FOTO", () => {
    const { container } = renderCard([VIDEO, PHOTO]);

    openComments();
    expect(lastOpen()).toMatchObject({ surface: "video" });

    swipeTo(container, 1);
    openComments();
    expect(lastOpen()).toMatchObject({ surface: "photo" });
  });

  it("el video al FINAL de un carrusel largo también manda cuando se llega a él", () => {
    const { container } = renderCard([PHOTO, PHOTO, VIDEO]);

    openComments();
    expect(lastOpen()).toMatchObject({ surface: "photo" });

    swipeTo(container, 2);
    openComments();
    expect(lastOpen()).toMatchObject({ surface: "video" });
  });

  it("un solo video (sin carrusel) pide la hoja de vidrio, como antes", () => {
    renderCard([VIDEO]);
    openComments();
    expect(lastOpen()).toMatchObject({ surface: "video" });
  });

  it("una sola foto TAMBIÉN pide la hoja de vidrio (2026-08-05: ya no hay excepción)", () => {
    renderCard([PHOTO]);
    openComments();
    expect(lastOpen()).toMatchObject({ surface: "photo" });
  });
});
