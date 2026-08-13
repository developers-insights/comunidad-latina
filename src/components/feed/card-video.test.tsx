// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CardVideo } from "./card-video";
import { CardLikeProvider } from "./card-like-context";
import type { PostMusicView } from "./helpers";

/**
 * Gramática táctil del video en el feed (§5 + feedback 2026-07-26): un toque
 * abre el reel a pantalla completa, DOS toques dan me gusta — igual que la
 * foto. Acá se testea esa ventana con timers falsos: sin ella, el doble-tap
 * sería indistinguible de dos navegaciones.
 *
 * El estado de me gusta se comparte con el resto de la card vía CardLikeProvider
 * (el mismo que monta PostCard), así que el doble-tap escribe en `reactions` por
 * el cliente de Supabase — acá stubeado.
 */

const nav = vi.hoisted(() => ({ push: vi.fn() }));
const supa = vi.hoisted(() => ({ insert: vi.fn(), remove: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => "/feed",
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
});

describe("CardVideo: un toque abre el reel", () => {
  it("navega a /videos con el post de arranque y el scope del tab, recién al vencer la ventana", () => {
    renderCard();
    fireEvent.click(tapLayer());

    // Todavía dentro de la ventana de doble-tap: no se navegó.
    expect(nav.push).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith(
      `/videos?start=${POST_ID}&scope=negocios`,
    );
  });
});

describe("CardVideo: doble toque da me gusta", () => {
  it("dos toques dentro de la ventana likean y NO navegan", () => {
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

  it("el botón de sonido sigue siendo suyo: no abre el reel ni likea", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /silenciar el video|activar el sonido/i }));
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(nav.push).not.toHaveBeenCalled();
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
// ya testeado ahí); acá se cubre que la card lo APLIQUE de verdad al DOM — el
// <audio> hermano, el silencio por defecto, que la música gane al tocar
// sonido, que nunca suenen los dos a la vez, y que el recorte haga loop.
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

function audioNode(): HTMLAudioElement | null {
  return document.querySelector("audio");
}

describe("CardVideo: música asociada a la publicación (0090)", () => {
  it("sin música no monta un <audio> (el video se comporta como siempre)", () => {
    renderWithMusic({ music: null });
    expect(audioNode()).toBeNull();
  });

  it("con música, monta un <audio> hermano del video, silencioso por defecto", () => {
    renderWithMusic();
    const audio = audioNode();
    expect(audio).toBeTruthy();
    expect(audio?.muted).toBe(true);
    // Silencio por defecto SIEMPRE: tampoco suena el video sin gesto.
    expect((videoNode() as HTMLVideoElement).muted).toBe(true);
  });

  it("el <audio> carga bajo demanda (preload=none): un feed con música no baja 40 mp3", () => {
    renderWithMusic();
    expect(audioNode()?.getAttribute("preload")).toBe("none");
  });

  it("tocar el botón de sonido hace ganar a la MÚSICA — el video queda mudo", () => {
    renderWithMusic();
    fireEvent.click(screen.getByRole("button", { name: "Activar el sonido" }));

    expect((videoNode() as HTMLVideoElement).muted).toBe(true);
    expect((audioNode() as HTMLAudioElement).muted).toBe(false);
  });

  it("tocar de nuevo vuelve al silencio — nunca los dos audios sonando juntos", () => {
    renderWithMusic();
    const tapSound = () =>
      screen.getByRole("button", { name: /silenciar el video|activar el sonido/i });
    fireEvent.click(tapSound());
    fireEvent.click(tapSound());

    expect((audioNode() as HTMLAudioElement).muted).toBe(true);
  });

  it("sin música, el botón de sonido sigue activando el audio del VIDEO (regla 3, sin cambios)", () => {
    renderWithMusic({ music: null });
    fireEvent.click(screen.getByRole("button", { name: "Activar el sonido" }));

    expect((videoNode() as HTMLVideoElement).muted).toBe(false);
  });

  it("el audio arranca en el segundo elegido del recorte (post_music.start_seconds)", () => {
    renderWithMusic();
    const audio = audioNode() as HTMLAudioElement;
    const clock = stubMediaClock(audio, 180);
    fireEvent.loadedMetadata(audio);

    expect(clock.now()).toBe(20);
  });

  it("el recorte hace loop al llegar a su fin (30 s desde el arranque, MUSIC_CLIP_SECONDS)", () => {
    renderWithMusic();
    const audio = audioNode() as HTMLAudioElement;
    const clock = stubMediaClock(audio, 180);
    fireEvent.loadedMetadata(audio); // arranca en el segundo 20

    clock.seek(20 + 29);
    fireEvent.timeUpdate(audio);
    expect(clock.now()).toBe(49); // todavía dentro del recorte

    clock.seek(20 + 30); // fin exacto del recorte de 30 s
    fireEvent.timeUpdate(audio);
    expect(clock.now()).toBe(20); // vuelve al arranque del recorte, no al 0 del archivo
  });

  it("la música se pausa cuando la card deja de ser el medio activo del carrusel", () => {
    const { rerender } = renderWithMusic({ active: true });
    const audio = audioNode() as HTMLAudioElement;
    const pause = vi.spyOn(audio, "pause");

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
