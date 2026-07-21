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
          ([key]) => !["layout", "initial", "animate", "exit", "transition"].includes(key),
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
