// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CardVideo } from "./card-video";
import { CardLikeProvider } from "./card-like-context";
import { CardMediaProvider } from "./card-media-context";
import { PREMIUM_DETAIL_MAX_SECONDS } from "@/lib/media/video-policy";
import type { PostMediaView } from "./helpers";

/**
 * Gramática táctil del video en el feed (§5 + feedback 2026-07-26): un toque
 * abre el video a pantalla completa, DOS toques dan me gusta — igual que la
 * foto. Acá se testea esa ventana con timers falsos: sin ella, el doble-tap
 * sería indistinguible de dos aperturas.
 *
 * QUÉ ABRE ESE TOQUE — cambió dos veces y los tests son la memoria de por qué:
 *
 *  · hasta el 2026-08-20 NAVEGABA a `/videos`, y volver perdía el scroll del
 *    feed ("no te tiene que mover a otra publicación… sin sacarte del feed");
 *  · desde entonces abría el visor de la propia publicación, que arregló eso y
 *    dejó el otro agujero: sin música y sin scroll a los demás videos;
 *  · desde el 2026-09-03 abre el REEL ENCIMA del feed, que cumple los dos
 *    pedidos ("ahí no te sale la música… debería hacer scrolling los videos").
 *
 * Los tests de acá abajo fijan las tres cosas a la vez: que abra el reel, que
 * NO navegue, y que el visor siga siendo el respaldo cuando el reel no tiene
 * ese video (y `/videos`, el respaldo del respaldo).
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

/**
 * EL REEL ENTRA POR `next/dynamic` (chunk aparte: no puede pesar en el primer
 * render del feed, y además corta un ciclo de imports). Acá se reemplaza esa
 * carga diferida por un stub SINCRÓNICO: lo que este archivo testea es el
 * GESTO de la tarjeta —qué abre, con qué datos, y qué pasa al cerrar— no el
 * reel, que tiene sus propios tests en `videos/`.
 *
 * El stub expone los dos caminos de vuelta que la tarjeta tiene que manejar:
 * cerrar normal, y "el reel no tenía este video".
 */
vi.mock("next/dynamic", async () => {
  const React = await import("react");
  interface StubProps {
    postId: string;
    scope: string;
    onClose: () => void;
    onUnavailable: () => void;
  }
  return {
    default: () =>
      function ReelOverlayStub({ postId, scope, onClose, onUnavailable }: StubProps) {
        return React.createElement(
          "div",
          { "data-testid": "reel-overlay", "data-post": postId, "data-scope": scope },
          React.createElement("button", { onClick: onClose }, "stub-cerrar-reel"),
          React.createElement("button", { onClick: onUnavailable }, "stub-reel-vacio"),
        );
      },
  };
});

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
  videoType = null,
}: {
  viewerId?: string | null;
  viewCount?: number;
  /** posts.video_type — `advertising_video` es lo que hace largo a un video. */
  videoType?: string | null;
} = {}) {
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
        videoType={videoType}
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
});

describe("CardVideo: un toque abre el REEL, encima del feed", () => {
  it("abre el reel en ESTE post y no navega a ningún lado", () => {
    renderCard();
    fireEvent.click(tapLayer());

    // Todavía dentro de la ventana de doble-tap: no se abrió nada.
    expect(screen.queryByTestId("reel-overlay")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(250);
    });

    const overlay = screen.getByTestId("reel-overlay");
    // Arranca en el video tocado y con el scope del feed que montó la tarjeta:
    // esos dos datos son los que hacen que el scroll siga "los otros videos
    // cortos" y no una lista cualquiera.
    expect(overlay.getAttribute("data-post")).toBe(POST_ID);
    expect(overlay.getAttribute("data-scope")).toBe("negocios");
    // Sin navegar: el feed sigue montado detrás, en su misma posición. Es la
    // mitad del pedido que ya estaba ganada el 2026-08-20 y no se resigna.
    expect(nav.push).not.toHaveBeenCalled();
    // Y el visor de una sola publicación deja de ser el destino del toque: era
    // justamente donde no había ni música ni scroll.
    expect(viewer.open).not.toHaveBeenCalled();
  });

  it("la tarjeta se calla al abrir el reel y retoma sola al cerrarlo", () => {
    renderCard();
    const node = videoNode();
    const pause = vi.spyOn(node, "pause").mockImplementation(() => undefined);
    const play = vi.spyOn(node, "play").mockImplementation(() => Promise.resolve());

    fireEvent.click(tapLayer());
    act(() => {
      vi.advanceTimersByTime(250);
    });
    // Dos copias del mismo clip sonando juntas no se le hace a nadie.
    expect(pause).toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();

    // La X, Escape, el "atrás" del teléfono o el arrastre hacia abajo.
    fireEvent.click(screen.getByText("stub-cerrar-reel"));

    expect(screen.queryByTestId("reel-overlay")).toBeNull();
    // Volver al feed devuelve la tarjeta como estaba, no congelada en el frame
    // donde la pausamos: el observador de visibilidad no la despierta solo
    // porque nunca dejó de estar a la vista.
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("si el reel no tiene ese video, cae al visor de la propia publicación", () => {
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
          authorName="Doña Rosa"
        />
      </CardMediaProvider>,
    );
    fireEvent.click(tapLayer());
    act(() => {
      vi.advanceTimersByTime(250);
    });

    // El post dejó de ser elegible entre que el feed se pintó y el dedo tocó.
    fireEvent.click(screen.getByText("stub-reel-vacio"));

    expect(screen.queryByTestId("reel-overlay")).toBeNull();
    // Tocó un video y tiene que ver un video: se abre el de la publicación, con
    // TODAS sus diapositivas y arrancando en la que tocó.
    expect(viewer.open).toHaveBeenCalledWith(
      expect.objectContaining({
        items,
        startIndex: 1,
        postId: POST_ID,
        authorName: "Doña Rosa",
        // Y completo, no otra vista previa de 59 s.
        maxPlaybackSeconds: PREMIUM_DETAIL_MAX_SECONDS,
      }),
    );
  });

  it("sin visor montado, el respaldo del respaldo sigue siendo /videos", () => {
    // El último eslabón: sin provider de visor, un reel vacío dejaría el toque
    // muerto. `/videos` sigue existiendo y sigue siendo un destino válido.
    viewer.available = false;
    renderCard();
    fireEvent.click(tapLayer());
    act(() => {
      vi.advanceTimersByTime(250);
    });
    fireEvent.click(screen.getByText("stub-reel-vacio"));

    expect(viewer.open).not.toHaveBeenCalled();
    expect(nav.push).toHaveBeenCalledWith(`/videos?start=${POST_ID}&scope=negocios`);
  });

  it("con `onTap` propio (detalle y anuncios) NO abre el reel", () => {
    // La regla la aplica `CardPostMedia` con `videoOpensReel`: dentro de una
    // propiedad, un evento o un anuncio el video se mira ahí y no saca a nadie
    // a un scroll donde ese video, por contrato, ni siquiera existe.
    const onTap = vi.fn();
    render(
      <CardVideo
        src="https://cdn.example.com/clip.mp4"
        postId={POST_ID}
        scope="sin-reel"
        onTap={onTap}
      />,
    );
    fireEvent.click(tapLayer());
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(onTap).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("reel-overlay")).toBeNull();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("pinta el poster mientras el archivo no llegó (nunca un rectángulo vacío)", () => {
    // El bug del cliente (2026-09-03, 1:07:00): sin `poster`, un .mp4 crudo no
    // tiene NADA que mostrar hasta que baja su metadata.
    render(
      <CardVideo
        src="https://cdn.example.com/clip.mp4"
        postId={POST_ID}
        scope="negocios"
        posterUrl="https://cdn.example.com/poster.jpg"
      />,
    );
    expect(videoNode().getAttribute("poster")).toBe("https://cdn.example.com/poster.jpg");
  });

  it("sin poster no escribe el atributo: un `poster=\"\"` es una imagen rota", () => {
    renderCard();
    expect(videoNode().hasAttribute("poster")).toBe(false);
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

});

// ---------------------------------------------------------------------------
// VISTA PREVIA DE 59 s (contrato 2026-07-30 §6)
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
// VIDEO LARGO: 59 s Y "VER VIDEO COMPLETO" (cliente 2026-09-03, 21:00)
// ---------------------------------------------------------------------------
//
// «En el feed y en Videos Cortos solamente sale los 59 segundos y ahí va a
// estar un botón que dice ver video completo… como Instagram: ves el video, se
// para en cierta cantidad de segundos y dice ver video completo.»
//
// La diferencia entre un corto y un largo NO es el tope —los 59 s son los
// mismos para los dos— sino qué pasa al llegar: el corto vuelve a empezar, el
// largo se FRENA y ofrece la sección. Estos tests fijan las dos mitades, porque
// cada una sin la otra es un bug: frenar sin botón parece un video roto, y el
// botón sin frenar es un cartel que aparece mientras el video sigue.

describe("CardVideo: video largo — se frena a los 59 s y ofrece la sección", () => {
  const CTA = "Ver el video completo en Videos largos";

  it("un corto no ofrece nada: vuelve a empezar, como siempre", () => {
    renderCard();
    const node = videoNode();
    const clock = stubMediaClock(node, 300);
    fireEvent.loadedMetadata(node);

    clock.seek(59);
    fireEvent.timeUpdate(node);

    expect(clock.now()).toBe(0);
    expect(screen.queryByRole("link", { name: CTA })).toBeNull();
  });

  it("un video publicitario se frena y aparece 'Ver video completo'", () => {
    renderCard({ videoType: "advertising_video" });
    const node = videoNode();
    const clock = stubMediaClock(node, 300);
    fireEvent.loadedMetadata(node);

    clock.seek(58);
    fireEvent.timeUpdate(node);
    expect(screen.queryByRole("link", { name: CTA })).toBeNull();

    clock.seek(59);
    fireEvent.timeUpdate(node);

    // NO rebobina: el corte tiene que verse, es lo que explica el botón.
    expect(clock.now()).toBe(59);
    const cta = screen.getByRole("link", { name: CTA });
    expect(cta.getAttribute("href")).toBe(`/videos/largos/${POST_ID}`);
    expect(cta.textContent).toContain("Ver video completo");
  });

  it("el toque sobre un video largo promete una vista previa, no el completo", () => {
    // El botón grande abre la MISMA vista previa a pantalla completa; el video
    // entero está a un toque del otro botón. Decir "Ver el video completo" acá
    // sería prometer lo que hace el otro.
    renderCard({ videoType: "advertising_video" });

    expect(
      screen.getByRole("button", { name: "Ver la vista previa en grande" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ver el video completo" })).toBeNull();
  });

  it("al volver del visor la vista previa empieza de nuevo, no frenada", () => {
    renderCard({ videoType: "advertising_video" });
    const node = videoNode();
    const clock = stubMediaClock(node, 300);
    fireEvent.loadedMetadata(node);

    clock.seek(59);
    fireEvent.timeUpdate(node);
    expect(screen.getByRole("link", { name: CTA })).toBeTruthy();

    // Abrir el reel y cerrarlo: la tarjeta retoma (`resumeAfterViewer`). La
    // capa de toque de un video largo se llama distinto — ver el test de arriba.
    fireEvent.click(
      screen.getByRole("button", { name: "Ver la vista previa en grande" }),
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.click(screen.getByText("stub-cerrar-reel"));

    expect(clock.now()).toBe(0);
    expect(screen.queryByRole("link", { name: CTA })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// LA MÚSICA YA NO ES DE ESTE COMPONENTE (arreglo 2026-08-26)
// ---------------------------------------------------------------------------
//
// El `<audio>` de la pista, el gesto de sonido y el altavoz vivían acá adentro,
// y ése era exactamente el bug que reportó el cliente: una publicación de FOTO
// con música no montaba ninguno de los tres, porque no tenía video donde
// montarlos — la insignia prometía una canción que no existía en el DOM.
//
// La pista es de la PUBLICACIÓN (`post_music`, PK `post_id`), así que su
// reproductor se mudó a `post-music.tsx` y su contrato se prueba ahí y en
// card-post-media.test.tsx. Lo que queda por probar ACÁ es lo contrario: que
// esta tarjeta NO se traiga nada de vuelta.

describe("CardVideo ya no reproduce música por su cuenta", () => {
  it("no monta ningún <audio> propio: hay UNO por publicación, no uno por medio", () => {
    renderCard();
    expect(document.querySelector("audio")).toBeNull();
  });

  it("no pinta su propio altavoz: el de la publicación es uno solo y no salta de diapositiva", () => {
    renderCard();
    expect(screen.queryByRole("button", { name: /activar el sonido|silenciar/i })).toBeNull();
  });

  it("sin contexto de publicación el video queda MUDO — nadie suena sin un gesto", () => {
    renderCard();
    expect((videoNode() as HTMLVideoElement).muted).toBe(true);
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
