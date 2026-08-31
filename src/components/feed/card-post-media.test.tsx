// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  ADVERTISING_VIDEO_MAX_SECONDS,
  PREMIUM_DETAIL_MAX_SECONDS,
} from "@/lib/media/video-policy";
import { CardMediaProvider } from "./card-media-context";
import { CardPostMedia } from "./card-post-media";
import { NO_REEL_SCOPE } from "./card-video";
import { MediaViewerProvider } from "./media-viewer";
import type { PostMediaView, PostMusicView, VideoScopeProp } from "./helpers";

/**
 * El CARRUSEL de la card (feedback cliente 2026-07-27: "tres punticos… puede ser
 * un video, dos fotos… la gente la hace así [swipe]").
 *
 * Acá se fija el contrato visible: cuántos puntitos hay, que con UN medio no
 * haya ninguno, que sólo el medio visible reproduzca, y que el visor abra en el
 * medio que se estaba viendo (no siempre en el primero).
 */

const nav = vi.hoisted(() => ({ push: vi.fn() }));
const viewerOpen = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => "/feed",
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

// El visor vive en el layout de la app: acá espiamos con qué lo abre la card.
vi.mock("./media-viewer", () => ({
  MediaViewerProvider: ({ children }: { children: React.ReactNode }) => children,
  // `available` es lo que le dice a CardVideo que hay visor de verdad: sin él,
  // el toque sobre un video caería a su fallback de navegación.
  useMediaViewer: () => ({ open: viewerOpen, available: true }),
}));

const PHOTO = (n: number): PostMediaView => ({
  kind: "image",
  url: `https://cdn.example.com/foto-${n}.webp`,
});
const VIDEO = (n: number): PostMediaView => ({
  kind: "video",
  url: `https://cdn.example.com/clip-${n}.mp4`,
});

const POST_ID = "11111111-1111-4111-8111-111111111111";

/**
 * Las diapositivas y el índice visible ya no son estado interno de la card: los
 * publica el CardMediaProvider (lo monta PostCard) para que la fila de acciones
 * pueda leer el MISMO medio que se está viendo. Acá se monta a mano.
 */
function renderMedia(
  media: PostMediaView[],
  videoScope: VideoScopeProp = "para-ti",
  /** Columnas de publicidad (0038 campaña vigente + 0046 video publicitario). */
  ad: { isPromoted?: boolean; isPaidAd?: boolean; videoType?: string | null } = {},
  /** Música (0090) y entidad — para probar el badge y su colisión con BoostCta. */
  extra: {
    music?: PostMusicView | null;
    entity?: { id: string; title: string; kind: string } | null;
  } = {},
) {
  return render(
    <MediaViewerProvider>
      <CardMediaProvider items={media}>
        <CardPostMedia
          postId={POST_ID}
          authorName="María Peralta"
          isPromoted={ad.isPromoted ?? false}
          isPaidAd={ad.isPaidAd ?? false}
          videoType={ad.videoType ?? null}
          entity={extra.entity ?? null}
          videoScope={videoScope}
          music={extra.music ?? null}
        />
      </CardMediaProvider>
    </MediaViewerProvider>,
  );
}

const MUSIC: PostMusicView = {
  startSeconds: 20,
  track: {
    id: "track-1",
    title: "Cumbia del barrio",
    artist: "Los del Sur",
    durationSeconds: 180,
    previewUrl: "https://cdn.example.com/track.mp3",
    licenseKind: "cc0",
    attributionRequired: false,
    attributionText: null,
    category: "tropical",
  },
};

/** El riel scrolleable (marcado con data-carousel-track para los tests). */
function track(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>("[data-carousel-track]");
}

/** Los puntitos; null cuando la card decidió no mostrar indicador. */
function dots(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>("[data-carousel-dots]");
}

/**
 * Simula el swipe: en jsdom el riel mide 0, así que le fijamos un ancho y
 * disparamos el scroll a mano — es exactamente lo que hace el navegador al
 * soltar el dedo con scroll-snap.
 */
function swipeTo(container: HTMLElement, index: number, width = 360) {
  const node = track(container);
  if (!node) throw new Error("no hay riel");
  Object.defineProperty(node, "clientWidth", { value: width, configurable: true });
  node.scrollLeft = index * width;
  fireEvent.scroll(node);
}

beforeEach(() => {
  vi.useFakeTimers();
  nav.push.mockReset();
  viewerOpen.mockReset();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("CardPostMedia: puntitos del carrusel", () => {
  it("hay un puntito por medio, contando fotos Y videos", () => {
    const { container } = renderMedia([PHOTO(1), PHOTO(2), VIDEO(1)]);
    expect(dots(container)?.children).toHaveLength(3);
  });

  it("con un solo medio NO hay puntitos (nada que indicar)", () => {
    const { container } = renderMedia([PHOTO(1)]);
    expect(dots(container)).toBeNull();
  });

  it("con un solo VIDEO tampoco hay puntitos", () => {
    const { container } = renderMedia([VIDEO(1)]);
    expect(dots(container)).toBeNull();
  });

  it("con muchos medios el indicador pasa a numérico en vez de una fila ilegible", () => {
    const many = [1, 2, 3, 4, 5, 6, 7].map(PHOTO);
    const { container } = renderMedia(many);
    expect(dots(container)?.textContent).toBe("1/7");

    swipeTo(container, 3);
    expect(dots(container)?.textContent).toBe("4/7");
  });

  it("sin medios no renderiza nada", () => {
    const { container } = renderMedia([]);
    expect(container.firstChild).toBeNull();
  });
});

describe("CardPostMedia: fotos y videos mezclados en un mismo post", () => {
  it("monta TODOS los medios como diapositivas, en orden", () => {
    const { container } = renderMedia([VIDEO(1), PHOTO(1), PHOTO(2), VIDEO(2)]);
    const slides = track(container)?.children;
    expect(slides).toHaveLength(4);
    // Video → foto → foto → video: el orden que publicó la persona.
    expect(slides?.[0].querySelector("video")).toBeTruthy();
    expect(slides?.[1].querySelector("video")).toBeNull();
    expect(slides?.[3].querySelector("video")).toBeTruthy();
  });

  it("cada diapositiva se anuncia con su posición ('Foto 2 de 3')", () => {
    renderMedia([VIDEO(1), PHOTO(1), PHOTO(2)]);
    expect(screen.getByLabelText("Video 1 de 3")).toBeTruthy();
    expect(screen.getByLabelText("Foto 2 de 3")).toBeTruthy();
    expect(screen.getByLabelText("Foto 3 de 3")).toBeTruthy();
  });
});

describe("CardPostMedia: sólo el medio visible reproduce", () => {
  it("al pasar de diapositiva, el video que queda atrás se pausa", () => {
    const { container } = renderMedia([VIDEO(1), PHOTO(1)]);
    const video = container.querySelector("video");
    if (!video) throw new Error("no hay video");
    const pause = vi.spyOn(video, "pause");

    swipeTo(container, 1);

    expect(pause).toHaveBeenCalled();
  });

  it("con dos videos, nunca hay dos activos a la vez", () => {
    const { container } = renderMedia([VIDEO(1), VIDEO(2)]);
    const videos = container.querySelectorAll("video");
    expect(videos).toHaveLength(2);

    // La capa de toque del medio NO visible queda fuera de la tabulación: es la
    // señal de que ese slide está inactivo (y por lo tanto pausado).
    const taps = screen.getAllByRole("button", { name: /ver el video/i });
    expect(taps[0].getAttribute("tabindex")).toBe("0");
    expect(taps[1].getAttribute("tabindex")).toBe("-1");

    swipeTo(container, 1);

    const after = screen.getAllByRole("button", { name: /ver el video/i });
    expect(after[0].getAttribute("tabindex")).toBe("-1");
    expect(after[1].getAttribute("tabindex")).toBe("0");
  });
});

describe("CardPostMedia: el visor abre en el medio que se estaba viendo", () => {
  it("tocar la tercera foto abre el visor en la tercera, no en la primera", () => {
    const items = [PHOTO(1), PHOTO(2), PHOTO(3)];
    const { container } = renderMedia(items);

    swipeTo(container, 2);
    const taps = screen.getAllByRole("button", { name: /ver la foto en grande/i });
    fireEvent.click(taps[2]);
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(viewerOpen).toHaveBeenCalledWith(
      expect.objectContaining({ startIndex: 2, postId: POST_ID, items }),
    );
  });
});

describe("CardPostMedia: el reel infinito sólo donde corresponde", () => {
  it("en el feed, tocar el video lo abre ACÁ MISMO y no te manda a /videos", () => {
    // Pedido del cliente 2026-08-20: "no te tiene que mover a otra publicación;
    // ahí nomás dentro de pantalla se tiene que fluir sin sacarte del feed". El
    // scroll vertical entre publicaciones sigue existiendo en Videos Cortos,
    // que es donde se va a buscarlo a propósito.
    renderMedia([VIDEO(1)], "eventos");
    fireEvent.click(screen.getByRole("button", { name: /ver el video/i }));
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(nav.push).not.toHaveBeenCalled();
    expect(viewerOpen).toHaveBeenCalledWith(
      expect.objectContaining({ startIndex: 0, postId: POST_ID }),
    );
  });

  it("fuera del feed (detalle de una publicación) el video abre el visor y NO el reel", () => {
    renderMedia([VIDEO(1), PHOTO(1)], NO_REEL_SCOPE);
    fireEvent.click(screen.getAllByRole("button", { name: /ver el video/i })[0]);
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(nav.push).not.toHaveBeenCalled();
    expect(viewerOpen).toHaveBeenCalledWith(
      expect.objectContaining({ startIndex: 0, postId: POST_ID }),
    );
  });

  it("el valor del scope sin reel es el que escribe la página de detalle", () => {
    // El detalle es un server component y no puede importar de un módulo
    // "use client": copia el literal. Si acá cambia, allá queda desincronizado.
    expect(NO_REEL_SCOPE).toBe("sin-reel");
  });
});

/**
 * EL VIDEO PUBLICITARIO SE MIRA DENTRO DE SU ANUNCIO (contrato 2026-07-30 §4;
 * call del 29/7, 1:19: "cuando cierras el video se regresa de nuevo a la
 * publicación… no puedes ir scrolling, tiene que quedarse dentro del anuncio").
 *
 * Los tres casos de abajo NO son el mismo caso escrito tres veces: son las tres
 * señales que pueden estar prendidas por separado, y la del medio —campaña ya
 * terminada, columna `is_paid_ad` todavía en true— es la que se escapaba,
 * porque la tarjeta sólo miraba `isPromoted`, que caduca con el calendario.
 */
describe("CardPostMedia: un anuncio nunca te tira al reel", () => {
  const AD_CASES = [
    { name: "campaña VIGENTE (post_promotions)", ad: { isPromoted: true } },
    {
      name: "campaña TERMINADA pero is_paid_ad sigue en true (0046)",
      ad: { isPromoted: false, isPaidAd: true },
    },
    {
      name: "video_type='advertising_video' sin ninguna otra señal",
      ad: { isPromoted: false, isPaidAd: false, videoType: "advertising_video" },
    },
  ] as const;

  for (const testCase of AD_CASES) {
    it(`no navega al reel — ${testCase.name}`, () => {
      renderMedia([VIDEO(1)], "para-ti", { ...testCase.ad });
      fireEvent.click(screen.getByRole("button", { name: /ver el video/i }));
      act(() => {
        vi.advanceTimersByTime(300);
      });

      // Ni al scroll de Videos Cortos, ni a ninguna otra ruta.
      expect(nav.push).not.toHaveBeenCalled();
      // Se abre el visor SOBRE la publicación: al cerrarlo (termine solo, atrás,
      // la X o deslizando) el feed queda donde estaba, porque nunca navegó.
      expect(viewerOpen).toHaveBeenCalledWith(
        expect.objectContaining({ startIndex: 0, postId: POST_ID }),
      );
    });

    it(`se marca "Patrocinado" — ${testCase.name}`, () => {
      renderMedia([VIDEO(1)], "para-ti", { ...testCase.ad });
      expect(screen.getByText("Patrocinado")).toBeTruthy();
    });
  }

  it("el video del anuncio se reproduce completo: 10 minutos, no 59 segundos", () => {
    renderMedia([VIDEO(1)], "para-ti", { isPaidAd: true });
    fireEvent.click(screen.getByRole("button", { name: /ver el video/i }));
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(viewerOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        maxPlaybackSeconds: ADVERTISING_VIDEO_MAX_SECONDS,
      }),
    );
  });

  it("un post orgánico tampoco navega, pero se mira con el tope de publicación", () => {
    // Lo que distingue al orgánico del anuncio ya no es a DÓNDE va el toque
    // —los dos abren el visor sobre el feed— sino cuánto video se reproduce:
    // 5 minutos la publicación, 10 el anuncio.
    renderMedia([VIDEO(1)], "para-ti", { videoType: "short_video" });
    fireEvent.click(screen.getByRole("button", { name: /ver el video/i }));
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(nav.push).not.toHaveBeenCalled();
    expect(viewerOpen).toHaveBeenCalledWith(
      expect.objectContaining({ maxPlaybackSeconds: PREMIUM_DETAIL_MAX_SECONDS }),
    );
    expect(screen.queryByText("Patrocinado")).toBeNull();
  });
});

/**
 * INSIGNIA DE MÚSICA (0090). Presentacional (MusicBadge es Server Component,
 * sin estado propio): acá se cubre que aparezca/desaparezca según `music`, que
 * sobreviva a fotos Y a videos (la pista es del post, no de una diapositiva), y
 * que suba cuando el CTA de campaña le ocupa el borde inferior — misma regla
 * que ya usan los puntitos del carrusel (`dotsClassName`), no una nueva.
 */
describe("CardPostMedia: insignia de música", () => {
  it("sin música no pinta nada", () => {
    renderMedia([PHOTO(1)]);
    expect(screen.queryByText(/Cumbia del barrio/)).toBeNull();
  });

  it("con música, muestra título y artista sobre una FOTO", () => {
    renderMedia([PHOTO(1)], "para-ti", {}, { music: MUSIC });
    expect(screen.getByText(/Cumbia del barrio/)).toBeTruthy();
    expect(screen.getByText(/Los del Sur/)).toBeTruthy();
  });

  it("con música, también se pinta sobre un VIDEO (la pista es del post)", () => {
    renderMedia([VIDEO(1)], "para-ti", {}, { music: MUSIC });
    expect(screen.getByText(/Cumbia del barrio/)).toBeTruthy();
  });

  it("sin campaña activa, la insignia queda en su posición base", () => {
    const { container } = renderMedia([PHOTO(1)], "para-ti", {}, { music: MUSIC });
    const badgeWrap = screen.getByText(/Cumbia del barrio/).closest("div.absolute");
    expect(badgeWrap?.className).toContain("bottom-3");
    expect(badgeWrap?.className).not.toContain("bottom-[3.75rem]");
    void container;
  });

  it("con BoostCta (campaña + entidad) la insignia sube, igual que los puntitos", () => {
    renderMedia(
      [PHOTO(1)],
      "para-ti",
      { isPromoted: true },
      { music: MUSIC, entity: { id: "e1", title: "Almacén Doña Rosa", kind: "business" } },
    );
    const badgeWrap = screen.getByText(/Cumbia del barrio/).closest("div.absolute");
    expect(badgeWrap?.className).toContain("bottom-[3.75rem]");
  });
});

/* -------- El filtro del video viaja por la card hasta reproducirse -------- */

describe("filtro de presentación (0104) — llega desde el medio, no del post", () => {
  it("cada diapositiva lleva el suyo: un video filtrado y una foto sin nada", () => {
    // Es una decisión POR ARCHIVO. Un prop del post no podría expresar un
    // carrusel con un video en Vintage y otro tal cual salió de la cámara.
    const { container } = renderMedia([
      { kind: "video", url: "https://cdn.example.com/uno.mp4", filterCss: "sepia(0.35)" },
      { kind: "video", url: "https://cdn.example.com/dos.mp4" },
    ]);

    const videos = container.querySelectorAll("video");
    expect(videos[0]?.style.filter).toBe("sepia(0.35)");
    expect(videos[1]?.style.filter).toBe("");
  });

  it("la FOTO nunca lo recibe: el suyo ya está quemado en el archivo", () => {
    // Si la foto también lo pintara, una publicación con filtro se vería con el
    // efecto aplicado dos veces.
    const { container } = renderMedia([
      { kind: "image", url: "https://cdn.example.com/foto.jpg", filterCss: "grayscale(1)" },
    ]);

    for (const img of container.querySelectorAll("img")) {
      expect(img.style.filter).toBe("");
    }
  });
});

/**
 * ---------------------------------------------------------------------------
 * LA MÚSICA TIENE QUE SONAR TAMBIÉN SOBRE UNA FOTO (bug del cliente,
 * 2026-08-26: "cuando se publica con música, no se escucha la música").
 * ---------------------------------------------------------------------------
 *
 * La captura que mandó era una publicación de FOTO: la insignia se veía —esos
 * tests ya estaban más arriba y pasaban— y no sonaba nada. El `<audio>` de la
 * pista se montaba ÚNICAMENTE dentro de `CardVideo`, así que un carrusel sin
 * un solo video no montaba ninguno: la insignia prometía una canción que no
 * existía en el DOM.
 *
 * Estos tests fijan el contrato a nivel PUBLICACIÓN, que es donde vive la
 * pista (`post_music`, PK `post_id`): un `<audio>` por post, exista o no un
 * video entre las diapositivas, y NUNCA dos.
 */
describe("CardPostMedia: la música suena sobre cualquier medio (0090)", () => {
  const audios = () => Array.from(document.querySelectorAll("audio"));

  it("una publicación de FOTO con música monta su <audio>", () => {
    renderMedia([PHOTO(1)], "para-ti", {}, { music: MUSIC });
    expect(audios()).toHaveLength(1);
    expect(audios()[0]?.getAttribute("src")).toBe(MUSIC.track.previewUrl);
  });

  it("y ofrece el altavoz: sin él, la insignia promete una canción que no se puede escuchar", () => {
    renderMedia([PHOTO(1)], "para-ti", {}, { music: MUSIC });
    expect(screen.getByRole("button", { name: "Activar el sonido" })).toBeTruthy();
  });

  it("silencio por defecto: sin gesto no suena nada, ni sobre una foto", () => {
    renderMedia([PHOTO(1)], "para-ti", {}, { music: MUSIC });
    expect(audios()[0]?.muted).toBe(true);
  });

  it("tocar el altavoz sobre una FOTO desmutea la pista", () => {
    renderMedia([PHOTO(1)], "para-ti", {}, { music: MUSIC });
    fireEvent.click(screen.getByRole("button", { name: "Activar el sonido" }));
    expect(audios()[0]?.muted).toBe(false);
  });

  it("un carrusel MIXTO (fotos + video) monta UNA sola pista, no dos encimadas", () => {
    renderMedia([PHOTO(1), VIDEO(1), PHOTO(2)], "para-ti", {}, { music: MUSIC });
    expect(audios()).toHaveLength(1);
  });

  it("sin música no monta ningún <audio> ni ofrece altavoz sobre fotos", () => {
    renderMedia([PHOTO(1), PHOTO(2)]);
    expect(audios()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /sonido|silenciar/i })).toBeNull();
  });
});
