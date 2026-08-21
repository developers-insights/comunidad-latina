// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  MediaViewerProvider,
  useMediaViewer,
  type OpenMediaViewerArgs,
} from "./media-viewer";

/**
 * Acá se testea el CONTRATO del visor (abrir → dialog con autor y contador →
 * cerrar), no la animación: motion se neutraliza para que el DOM refleje el
 * estado al instante (mismo patrón que toast.test.tsx).
 */
vi.mock("motion/react", () => {
  const stub = {
    div: ({
      children,
      ...props
    }: Record<string, unknown> & { children?: React.ReactNode }) => {
      const domProps = Object.fromEntries(
        Object.entries(props).filter(
          ([key]) =>
            ![
              "layout",
              "initial",
              "animate",
              "exit",
              "transition",
              // Props del arrastre-para-cerrar: son de motion, no del DOM.
              "drag",
              "dragConstraints",
              "dragElastic",
              "onDragEnd",
            ].includes(key),
        ),
      );
      return <div {...domProps}>{children}</div>;
    },
  };
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    m: stub,
    motion: stub,
    useReducedMotion: () => false,
  };
});

function Trigger({ args }: { args: OpenMediaViewerArgs }) {
  const viewer = useMediaViewer();
  return (
    <button type="button" onClick={() => viewer.open(args)}>
      abrir visor
    </button>
  );
}

const TWO_PHOTOS: OpenMediaViewerArgs = {
  items: [
    { kind: "image", url: "https://cdn.example.com/uno.webp" },
    { kind: "image", url: "https://cdn.example.com/dos.webp" },
  ],
  authorName: "María Peralta",
  postId: "post-1",
};

afterEach(() => cleanup());

describe("MediaViewer: contrato open/close", () => {
  it("open() monta el dialog con el autor, el contador y los medios", () => {
    render(
      <MediaViewerProvider>
        <Trigger args={TWO_PHOTOS} />
      </MediaViewerProvider>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "abrir visor" }));

    const dialog = screen.getByRole("dialog", {
      name: "Fotos y videos de María Peralta",
    });
    expect(dialog).toBeTruthy();
    // Contador "1/2" (dos medios, arranca en el primero).
    expect(dialog.textContent).toContain("1/2");
    // Ambas fotos montadas en el carrusel.
    expect(dialog.querySelectorAll("img")).toHaveLength(2);
  });

  it("la X cierra el visor al instante (sin esperar al historial)", () => {
    render(
      <MediaViewerProvider>
        <Trigger args={TWO_PHOTOS} />
      </MediaViewerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "abrir visor" }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("el gesto/botón atrás (popstate) también cierra", () => {
    render(
      <MediaViewerProvider>
        <Trigger args={TWO_PHOTOS} />
      </MediaViewerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "abrir visor" }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.popState(window);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("open() sin items es un no-op (nunca un visor vacío)", () => {
    render(
      <MediaViewerProvider>
        <Trigger args={{ items: [] }} />
      </MediaViewerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "abrir visor" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("fuera del provider, el hook devuelve un no-op que no rompe", () => {
    render(<Trigger args={TWO_PHOTOS} />);
    fireEvent.click(screen.getByRole("button", { name: "abrir visor" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("respeta startIndex al pintar el contador", () => {
    render(
      <MediaViewerProvider>
        <Trigger args={{ ...TWO_PHOTOS, startIndex: 1 }} />
      </MediaViewerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "abrir visor" }));
    expect(screen.getByRole("dialog").textContent).toContain("2/2");
  });
});

/**
 * "SE QUEDA DENTRO DEL ANUNCIO" — lo que el cliente describió en la call del
 * 29/7 (1:19) no es una pantalla nueva: es que abrir y cerrar el video NO SEA
 * una navegación. El visor es un overlay sobre la misma publicación, así que
 * cerrarlo no puede cambiar de ruta ni perder dónde estabas leyendo.
 *
 * Lo que se ancla acá es exactamente eso, porque es lo que se rompe solo si
 * alguien "mejora" el visor convirtiéndolo en una ruta.
 */
describe("MediaViewer: abrir y cerrar no es navegar", () => {
  const VIDEO_DE_ANUNCIO: OpenMediaViewerArgs = {
    items: [{ kind: "video", url: "https://cdn.example.com/anuncio.mp4" }],
    authorName: "Doña Rosa",
    postId: "post-ad",
    // 600 s: el video publicitario completo (video-policy). Lo calcula la card.
    maxPlaybackSeconds: 600,
  };

  it("el bloqueo de scroll usa overflow, que CONSERVA la posición de la página", () => {
    // `position: fixed` en el body también bloquea el scroll, pero manda el
    // scrollTop a 0: al cerrar, el feed vuelve arriba de todo y la persona
    // pierde dónde estaba. Con `overflow: hidden` la posición queda intacta.
    render(
      <MediaViewerProvider>
        <Trigger args={VIDEO_DE_ANUNCIO} />
      </MediaViewerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "abrir visor" }));

    expect(document.body.style.overflow).toBe("hidden");
    expect(document.body.style.position).not.toBe("fixed");
    expect(document.body.style.top).toBe("");
  });

  it("al cerrar con la X, el body vuelve a scrollear y el visor se va", () => {
    render(
      <MediaViewerProvider>
        <Trigger args={VIDEO_DE_ANUNCIO} />
      </MediaViewerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "abrir visor" }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /cerrar/i }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("el gesto atrás cierra el visor, no la publicación", () => {
    // El visor apila UNA entrada de historial al abrir: el "atrás" del teléfono
    // la consume y cierra el visor. Sin eso, atrás te sacaría de la publicación
    // —que es justo la queja— en vez de devolverte a ella.
    render(
      <MediaViewerProvider>
        <Trigger args={VIDEO_DE_ANUNCIO} />
      </MediaViewerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "abrir visor" }));

    fireEvent.popState(window);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("el video del visor está en loop: al terminar vuelve a empezar, no salta al siguiente", () => {
    // Es la cuarta forma de "cerrar" que pidió probarse: que el video TERMINE.
    // Con `loop`, terminar no es un evento que pueda navegar a ningún lado —
    // el video vuelve al principio y la persona sigue dentro del anuncio.
    render(
      <MediaViewerProvider>
        <Trigger args={VIDEO_DE_ANUNCIO} />
      </MediaViewerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "abrir visor" }));

    const video = screen.getByRole("dialog").querySelector("video");
    expect(video).toBeTruthy();
    expect(video?.hasAttribute("loop")).toBe(true);
    // Y no hay ningún handler de "terminó" que pueda llevar a otra parte.
    expect(video?.getAttribute("onended")).toBeNull();
  });
});

/**
 * EL VISOR COMO DESTINO DEL VIDEO DEL FEED (2026-08-20). Tocar un video en una
 * card ya no navega a `/videos`: abre este visor sobre la misma pantalla. Eso
 * le sumó dos obligaciones al contrato, y las dos son de continuidad:
 *
 *  · avisar cuando se cierra, porque la tarjeta pausó su propio video al abrir
 *    y sin el aviso se queda congelada para siempre;
 *  · heredar el segundo en el que venía, para que abrir sea seguir mirando y no
 *    volver a empezar.
 */
describe("MediaViewer: le devuelve el control a quien lo abrió", () => {
  const VIDEO_DEL_FEED = (extra: Partial<OpenMediaViewerArgs> = {}) =>
    ({
      items: [{ kind: "video", url: "https://cdn.example.com/clip.mp4" }],
      authorName: "Doña Rosa",
      postId: "post-feed",
      ...extra,
    }) satisfies OpenMediaViewerArgs;

  it("avisa al cerrar con la X", () => {
    const onClose = vi.fn();
    render(
      <MediaViewerProvider>
        <Trigger args={VIDEO_DEL_FEED({ onClose })} />
      </MediaViewerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "abrir visor" }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("avisa también cuando cierra el gesto atrás del teléfono", () => {
    const onClose = vi.fn();
    render(
      <MediaViewerProvider>
        <Trigger args={VIDEO_DEL_FEED({ onClose })} />
      </MediaViewerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "abrir visor" }));
    fireEvent.popState(window);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("el aviso llega UNA sola vez, no una por cada camino de cierre", () => {
    // La X consume la entrada de historial en silencio: si ese popstate
    // volviera a avisar, la tarjeta retomaría el video dos veces.
    const onClose = vi.fn();
    render(
      <MediaViewerProvider>
        <Trigger args={VIDEO_DEL_FEED({ onClose })} />
      </MediaViewerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "abrir visor" }));
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    fireEvent.popState(window);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("el video arranca en el segundo que traía la tarjeta, no en cero", () => {
    // jsdom no tiene reloj de medios: se intercepta la escritura, que es
    // exactamente lo que hace el visor para continuar la reproducción.
    const seeks: number[] = [];
    const original = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      "currentTime",
    );
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get: () => 0,
      set: (value: number) => {
        seeks.push(value);
      },
    });

    try {
      render(
        <MediaViewerProvider>
          <Trigger args={VIDEO_DEL_FEED({ startSeconds: 17.25 })} />
        </MediaViewerProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "abrir visor" }));

      expect(seeks).toContain(17.25);
    } finally {
      if (original) {
        Object.defineProperty(HTMLMediaElement.prototype, "currentTime", original);
      }
    }
  });
});

/**
 * `available` es lo que separa "no hay visor montado" de "el visor no hizo
 * nada": sin ese dato, una card cuya acción principal es abrir el visor tendría
 * un toque muerto fuera del provider.
 */
describe("MediaViewer: se puede saber si hay provider", () => {
  function Probe() {
    const viewer = useMediaViewer();
    return <span data-testid="probe">{viewer.available ? "sí" : "no"}</span>;
  }

  it("dentro del provider dice que sí", () => {
    render(
      <MediaViewerProvider>
        <Probe />
      </MediaViewerProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("sí");
  });

  it("fuera del provider dice que no", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("no");
  });
});
