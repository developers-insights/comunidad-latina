// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CardVideo } from "./card-video";
import { CardLikeProvider } from "./card-like-context";
import { CardMediaProvider } from "./card-media-context";
import { PREMIUM_DETAIL_MAX_SECONDS } from "@/lib/media/video-policy";
import { claimAudio, resetAudioChannel } from "@/lib/media/audio-channel";
import type { PostMediaView, PostMusicView } from "./helpers";

/**
 * Gramática táctil del video en el feed (§5 + feedback 2026-07-26): un toque
 * abre el video a pantalla completa, DOS toques dan me gusta — igual que la
 * foto. Acá se testea esa ventana con timers falsos: sin ella, el doble-tap
 * sería indistinguible de dos aperturas.
 *
 * Desde el 2026-08-20 ese toque NO navega: abre el visor global sobre el mismo
 * feed ("no te tiene que mover a otra publicación… sin sacarte del feed"). Los
 * tests de acá abajo son los que impiden que `/videos` vuelva a colarse en el
 * gesto de la tarjeta.
 *
 * El estado de me gusta se comparte con el resto de la card vía CardLikeProvider
 * (el mismo que monta PostCard), así que el doble-tap escribe en `reactions` por
 * el cliente de Supabase — acá stubeado.
 */

const nav = vi.hoisted(() => ({ push: vi.fn() }));
const supa = vi.hoisted(() => ({ insert: vi.fn(), remove: vi.fn() }));
/**
 * El visor vive en el layout de la app: acá se espía con qué lo abre la tarjeta.
 * `available` es mutable a propósito — hay un caso que prueba justamente qué
 * pasa cuando NO hay provider montado.
 */
const viewer = vi.hoisted(() => ({ open: vi.fn(), available: true }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => "/feed",
}));

vi.mock("./media-viewer", () => ({
  useMediaViewer: () => ({ open: viewer.open, available: viewer.available }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      insert: (...args: unknown[]) => {
        supa.insert(...args);
        return Promise.resolve({ error: null });
      },
      delete: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => {
              supa.remove();
              return Promise.resolve({ error: null });
            },
          }),
        }),
      }),
    }),
  }),
}));

const POST_ID = "11111111-1111-4111-8111-111111111111";

function renderCard({
  viewerId = "viewer-1",
  viewCount = 0,
}: { viewerId?: string | null; viewCount?: number } = {}) {
  return render(
    <CardLikeProvider
      postId={POST_ID}
      tenantId="tenant-1"
      viewerId={viewerId}
      initialLiked={false}
      initialCount={3}
    >
      <CardVideo
        src="https://cdn.example.com/clip.mp4"
        postId={POST_ID}
        scope="negocios"
        authorName="Doña Rosa"
        viewCount={viewCount}
      />
    </CardLikeProvider>,
  );
}

/** La capa de toque es el botón grande de "Ver el video" sobre el propio video. */
function tapLayer() {
  return screen.getByRole("button", { name: /ver el video/i });
}

beforeEach(() => {
  vi.useFakeTimers();
  nav.push.mockReset();
  supa.insert.mockReset();
  supa.remove.mockReset();
  viewer.open.mockReset();
  viewer.available = true;
  // IntersectionObserver no existe en jsdom: el autoplay no es lo que se testea acá.
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
  // El canal de sonido vive en el módulo (audio-channel.ts): sin esto, el gesto
  // de "activar el sonido" de un caso llegaría desmuteado al siguiente.
  resetAudioChannel();
});

describe("CardVideo: un toque abre el video SIN sacarte del feed", () => {
  it("abre el visor sobre la misma pantalla y no navega a ningún lado", () => {
    renderCard();
    fireEvent.click(tapLayer());

    // Todavía dentro de la ventana de doble-tap: no se abrió nada.
    expect(viewer.open).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(nav.push).not.toHaveBeenCalled();
    expect(viewer.open).toHaveBeenCalledTimes(1);
    expect(viewer.open).toHaveBeenCalledWith(
      expect.objectContaining({
        postId: POST_ID,
        startIndex: 0,
        items: [{ kind: "video", url: "https://cdn.example.com/clip.mp4" }],
        // El encabezado del visor nombra al autor: por este camino también, o
        // el video de una card diría menos que su propia foto.
        authorName: "Doña Rosa",
      }),
    );
  });

  it("lo que abre es el video COMPLETO, no otra vista previa de 59 s", () => {
    renderCard();
    fireEvent.click(tapLayer());
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(viewer.open).toHaveBeenCalledWith(
      expect.objectContaining({ maxPlaybackSeconds: PREMIUM_DETAIL_MAX_SECONDS }),
    );
  });

  it("sigue donde venía: el visor hereda el segundo de la tarjeta, no vuelve a cero", () => {
    renderCard();
    const clock = stubMediaClock(videoNode(), 90);
    clock.seek(12.5);

    fireEvent.click(tapLayer());
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(viewer.open).toHaveBeenCalledWith(
      expect.objectContaining({ startSeconds: 12.5 }),
    );
  });

  it("la tarjeta se calla al abrir y retoma sola al cerrarse el visor", () => {
    renderCard();
    const node = videoNode();
    const pause = vi.spyOn(node, "pause").mockImplementation(() => undefined);
    const play = vi
      .spyOn(node, "play")
      .mockImplementation(() => Promise.resolve());

    fireEvent.click(tapLayer());
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(pause).toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();

    // El visor avisa que se cerró (la X, Escape, atrás o el arrastre).
    const args = viewer.open.mock.calls[0][0] as { onClose?: () => void };
    act(() => {
      args.onClose?.();
    });

    expect(play).toHaveBeenCalledTimes(1);
  });

  it("con las diapositivas del post, abre TODAS y arranca en el video tocado", () => {
    const items: PostMediaView[] = [
      { kind: "image", url: "https://cdn.example.com/foto.webp" },
      { kind: "video", url: "https://cdn.example.com/clip.mp4" },
    ];
    render(
      <CardMediaProvider items={items}>
        <CardVideo
          src="https://cdn.example.com/clip.mp4"
          postId={POST_ID}
          scope="negocios"
        />
      </CardMediaProvider>,
    );
    fireEvent.click(tapLayer());
    act(() => {
      vi.advanceTimersByTime(250);
    });

    // Tocar el video deja llegar a la foto, igual que tocar la foto deja llegar
    // al video: es el mismo carrusel, no dos visores distintos.
    expect(viewer.open).toHaveBeenCalledWith(
      expect.objectContaining({ items, startIndex: 1 }),
    );
  });

  it("sin visor montado el toque NO queda muerto: cae al reel de /videos", () => {
    // `/videos` sigue existiendo y sigue siendo un destino válido; lo que dejó
    // de ser es el destino del gesto cuando hay visor.
    viewer.available = false;
    renderCard();
    fireEvent.click(tapLayer());
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(viewer.open).not.toHaveBeenCalled();
    expect(nav.push).toHaveBeenCalledWith(`/videos?start=${POST_ID}&scope=negocios`);
  });
});

describe("CardVideo: doble toque da me gusta", () => {
  it("dos toques dentro de la ventana likean y NO abren el video", () => {
    renderCard();
    fireEvent.click(tapLayer());
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.click(tapLayer());

    // Aunque pase el tiempo, el timer del primer toque quedó cancelado.
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(nav.push).not.toHaveBeenCalled();
    expect(viewer.open).not.toHaveBeenCalled();
    expect(supa.insert).toHaveBeenCalledTimes(1);
  });

  it("el doble toque NUNCA quita el me gusta (para eso está el botón)", () => {
    renderCard();
    // Primer doble-tap: likea.
    fireEvent.click(tapLayer());
    fireEvent.click(tapLayer());
    // Segundo doble-tap sobre algo ya likeado: no vuelve a escribir ni borra.
    fireEvent.click(tapLayer());
    fireEvent.click(tapLayer());
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(supa.insert).toHaveBeenCalledTimes(1);
    expect(supa.remove).not.toHaveBeenCalled();
  });

  it("sin sesión el doble toque lleva a /entrar en vez de fingir un me gusta", () => {
    renderCard({ viewerId: null });
    fireEvent.click(tapLayer());
    fireEvent.click(tapLayer());
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(supa.insert).not.toHaveBeenCalled();
    expect(nav.push).toHaveBeenCalledWith("/entrar?next=%2Ffeed");
  });
});

describe("CardVideo: píldora de vistas", () => {
  it("muestra las vistas cuando hay, y nada cuando el post todavía no tiene ninguna", () => {
    const { unmount } = renderCard({ viewCount: 1240 });
    expect(screen.getByText(/vistas/)).toBeTruthy();
    unmount();

    renderCard({ viewCount: 0 });
    expect(screen.queryByText(/vistas/)).toBeNull();
  });

  it("el botón de sonido sigue siendo suyo: no abre el video ni likea", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /silenciar el video|activar el sonido/i }));
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(nav.push).not.toHaveBeenCalled();
    expect(viewer.open).not.toHaveBeenCalled();
    expect(supa.insert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// VISTA PREVIA DE 59 s (contrato 2026-07-30 §6)
// ---------------------------------------------------------------------------

/**
 * jsdom no implementa el reloj de un `<video>`: `duration` es NaN y
 * `currentTime` no avanza. Se definen a mano —igual que haría el navegador al
 * cargar la metadata— para poder testear la regla, que es lo que importa: la
 * tarjeta reproduce 59 s, y lo dice cuando hay más video del que muestra.
 */
function stubMediaClock(node: HTMLMediaElement, duration: number) {
  let time = 0;
  Object.defineProperty(node, "duration", { configurable: true, value: duration });
  Object.defineProperty(node, "currentTime", {
    configurable: true,
    get: () => time,
    set: (next: number) => {
      time = next;
    },
  });
  return {
    seek: (seconds: number) => {
      time = seconds;
    },
    now: () => time,
  };
}

function videoNode(): HTMLVideoElement {
  const node = document.querySelector("video");
  if (!node) throw new Error("la card no renderizó un <video>");
  return node as HTMLVideoElement;
}

describe("CardVideo: la tarjeta muestra 59 s, no el video entero", () => {
  it("un video más largo que el tope se anuncia como vista previa", () => {
    renderCard();
    const node = videoNode();
    stubMediaClock(node, 90);
    fireEvent.loadedMetadata(node);

    expect(screen.getByText("Vista previa")).toBeTruthy();
    // Y el toque promete lo que hace: abrir el video completo.
    expect(screen.getByRole("button", { name: "Ver el video completo" })).toBeTruthy();
  });

  it("un video que entra completo NO dice vista previa", () => {
    renderCard();
    const node = videoNode();
    stubMediaClock(node, 30);
    fireEvent.loadedMetadata(node);

    expect(screen.queryByText("Vista previa")).toBeNull();
    expect(screen.getByRole("button", { name: "Ver el video" })).toBeTruthy();
  });

  it("al llegar a los 59 s vuelve al principio en vez de seguir", () => {
    renderCard();
    const node = videoNode();
    const clock = stubMediaClock(node, 300);
    fireEvent.loadedMetadata(node);

    clock.seek(58);
    fireEvent.timeUpdate(node);
    expect(clock.now()).toBe(58); // todavía dentro de la ventana

    clock.seek(59);
    fireEvent.timeUpdate(node);
    expect(clock.now()).toBe(0);
  });

  it("sin metadata legible no promete que haya más video", () => {
    renderCard();
    const node = videoNode();
    stubMediaClock(node, Number.NaN);
    fireEvent.loadedMetadata(node);

    expect(screen.queryByText("Vista previa")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// MÚSICA ASOCIADA (contrato 0090): el árbitro es resolveAudioMix (audio-mix.ts,
// ya testeado ahí) y quien REPRODUCE la pista es CardMusic (card-music.test.tsx,
// desde 2026-08-26 — antes el <audio> vivía acá y una publicación de fotos con
// música no sonaba nunca). Lo que se cubre acá es lo que le queda a la tarjeta
// de video: callarse cuando hay pista, y no ofrecer un segundo control de audio.
// ---------------------------------------------------------------------------

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

function renderWithMusic({
  music = MUSIC,
  active = true,
}: { music?: PostMusicView | null; active?: boolean } = {}) {
  return render(
    <CardLikeProvider
      postId={POST_ID}
      tenantId="tenant-1"
      viewerId="viewer-1"
      initialLiked={false}
      initialCount={3}
    >
      <CardVideo
        src="https://cdn.example.com/clip.mp4"
        postId={POST_ID}
        scope="negocios"
        music={music}
        active={active}
      />
    </CardLikeProvider>,
  );
}

describe("CardVideo: música asociada a la publicación (0090)", () => {
  it("no monta el <audio> de la música: la pista es del POST, no del video", () => {
    renderWithMusic();
    expect(document.querySelector("audio")).toBeNull();
  });

  it("con música, el video queda mudo y NO ofrece su propio altavoz", () => {
    renderWithMusic();

    expect((videoNode() as HTMLVideoElement).muted).toBe(true);
    // El play/pausa es la insignia (CardMusic). Un segundo control para el
    // mismo audio es cómo se llega a uno que dice "silenciar" mientras el otro
    // dice "escuchar".
    expect(screen.queryByRole("button", { name: /silenciar el video|activar el sonido/i })).toBeNull();
  });

  it("sin música, el botón de sonido sigue activando el audio del VIDEO (regla 3, sin cambios)", () => {
    renderWithMusic({ music: null });
    fireEvent.click(screen.getByRole("button", { name: "Activar el sonido" }));

    expect((videoNode() as HTMLVideoElement).muted).toBe(false);
  });

  it("el sonido es UNO SOLO en la pantalla: otra publicación lo toma y esta se calla", () => {
    renderWithMusic({ music: null });
    fireEvent.click(screen.getByRole("button", { name: "Activar el sonido" }));
    expect((videoNode() as HTMLVideoElement).muted).toBe(false);

    // Otra publicación pide el canal (es lo que hace su insignia al tocarla).
    act(() => {
      claimAudio("otro-post");
    });

    expect((videoNode() as HTMLVideoElement).muted).toBe(true);
  });

  it("el video se pausa cuando la card deja de ser el medio activo del carrusel", () => {
    const { rerender } = renderWithMusic({ active: true });
    const node = videoNode();
    const pause = vi.spyOn(node, "pause").mockImplementation(() => undefined);

    rerender(
      <CardLikeProvider
        postId={POST_ID}
        tenantId="tenant-1"
        viewerId="viewer-1"
        initialLiked={false}
        initialCount={3}
      >
        <CardVideo
          src="https://cdn.example.com/clip.mp4"
          postId={POST_ID}
          scope="negocios"
          music={MUSIC}
          active={false}
        />
      </CardLikeProvider>,
    );

    expect(pause).toHaveBeenCalled();
  });
});

/* ---------------- Filtro de presentación del video (0104) ----------------- */

/**
 * En una foto el filtro se hornea en los píxeles y el archivo publicado ES la
 * foto filtrada. Un video no se hornea —re-codificar en tiempo real rompería la
 * subida directa al bucket y le cambiaría la huella a Content Integrity—, así
 * que el filtro llega como un valor de `filter` ya resuelto por el servidor y se
 * aplica al reproducir.
 */
describe("el filtro del video se pinta al reproducir", () => {
  function videoNode(container: HTMLElement) {
    const node = container.querySelector("video");
    if (!node) throw new Error("la tarjeta no montó el <video>");
    return node;
  }

  it("aplica el filtro que llegó resuelto desde el servidor", () => {
    const { container } = render(
      <CardVideo
        src="https://cdn.example.com/clip.mp4"
        postId={POST_ID}
        scope="para-ti"
        filterCss="grayscale(1) contrast(1.1)"
      />,
    );

    expect(videoNode(container).style.filter).toBe("grayscale(1) contrast(1.1)");
  });

  it("sin filtro no escribe ningún estilo", () => {
    // Un `filter` vacío igual crearía una capa de composición propia por nada.
    const { container } = render(
      <CardVideo src="https://cdn.example.com/clip.mp4" postId={POST_ID} scope="para-ti" />,
    );

    expect(videoNode(container).style.filter).toBe("");
  });

  it("el filtro NO tiñe la interfaz que va encima del video", () => {
    // Va sobre el `<video>` y no sobre su contenedor: si tiñera el contenedor,
    // el chip de vistas y el botón de sonido quedarían ilegibles sobre un
    // Carbón al 100%.
    const { container } = render(
      <CardVideo
        src="https://cdn.example.com/clip.mp4"
        postId={POST_ID}
        scope="para-ti"
        viewCount={120}
        filterCss="grayscale(1)"
      />,
    );

    const wrapper = videoNode(container).parentElement;
    expect(wrapper?.style.filter ?? "").toBe("");
  });
});
