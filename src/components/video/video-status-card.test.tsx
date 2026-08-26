// @vitest-environment jsdom
// Matchers de jest-dom (`toBeInTheDocument`, `toHaveAttribute`): se importan por
// archivo, como ya hacen los otros tests de componentes de este repo.
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { VideoStatusCard } from "./video-status-card";
import { VIDEO_COPY } from "./copy";

/**
 * LA REGLA QUE ESTE ARCHIVO CUIDA: mientras Mux transcodifica, la tarjeta
 * muestra un estado HONESTO — nunca un reproductor vacío ni un cuadro negro.
 *
 * Es la tercera de las tres reglas innegociables del pedido, y la más fácil de
 * romper sin darse cuenta: alcanza con que alguien decida "total, el player
 * maneja el error" para que una publicación recién hecha se vea como un bug.
 */

afterEach(cleanup);

describe("mientras se prepara el video", () => {
  it("dice qué está pasando y que no hay que hacer nada", () => {
    render(<VideoStatusCard kind="procesando" />);
    expect(screen.getByText(VIDEO_COPY.procesando.titulo)).toBeInTheDocument();
    expect(screen.getByText(VIDEO_COPY.procesando.cuerpo)).toBeInTheDocument();
  });

  it("NO monta ningún reproductor: no hay nada que reproducir todavía", () => {
    const { container } = render(<VideoStatusCard kind="procesando" />);
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("mux-player")).toBeNull();
  });

  it("se anuncia solo, sin interrumpir: role=status + aria-live polite", () => {
    render(<VideoStatusCard kind="procesando" />);
    const bloque = screen.getByRole("status");
    expect(bloque).toHaveAttribute("aria-live", "polite");
  });

  it("lleva el chip 'Preparando' en la misma esquina que el de Publicidad", () => {
    render(<VideoStatusCard kind="procesando" />);
    expect(screen.getByText(VIDEO_COPY.procesando.chip)).toBeInTheDocument();
  });

  it("ocupa la MISMA caja 4:5 que el video, para que nada salte al resolverse", () => {
    // Si el estado midiera distinto que el video, al aparecer el reproductor el
    // pie, las acciones y la publicación siguiente se moverían de golpe.
    const { container } = render(<VideoStatusCard kind="procesando" />);
    expect(container.firstElementChild?.className).toContain("aspect-[4/5]");
  });
});

describe("cuando se pasó de tiempo", () => {
  it("lo dice, en vez de prometer que ya casi está", () => {
    render(<VideoStatusCard kind="demorado" />);
    expect(screen.getByText(VIDEO_COPY.procesando.demoradoTitulo)).toBeInTheDocument();
    expect(screen.getByText(VIDEO_COPY.procesando.demoradoCuerpo)).toBeInTheDocument();
  });

  it("no declara un fracaso que nadie confirmó", () => {
    render(<VideoStatusCard kind="demorado" />);
    expect(screen.queryByText(VIDEO_COPY.fallo.titulo)).not.toBeInTheDocument();
  });
});

describe("cuando el video no se pudo preparar", () => {
  it("se dice con todas las letras y con una salida", () => {
    render(<VideoStatusCard kind="fallo" />);
    expect(screen.getByText(VIDEO_COPY.fallo.titulo)).toBeInTheDocument();
    expect(screen.getByText(VIDEO_COPY.fallo.cuerpo)).toBeInTheDocument();
  });

  it("no queda rotulado como 'Preparando': ya no se está preparando nada", () => {
    render(<VideoStatusCard kind="fallo" />);
    expect(screen.queryByText(VIDEO_COPY.procesando.chip)).not.toBeInTheDocument();
  });
});

describe("el copy no filtra la infraestructura", () => {
  it("en ningún estado se nombra a Mux, ni se muestra un código de error", () => {
    // Regla 1 de `copy.ts`: la persona subió un video a su comunidad, no
    // contrató un proveedor de video. Nombrarlo agrega una palabra sobre la que
    // no puede hacer absolutamente nada.
    for (const kind of ["procesando", "demorado", "fallo"] as const) {
      const { container } = render(<VideoStatusCard kind={kind} />);
      expect(container.textContent?.toLowerCase()).not.toContain("mux");
      expect(container.textContent?.toLowerCase()).not.toContain("error");
      expect(container.textContent).not.toMatch(/\b[45]\d{2}\b/);
      cleanup();
    }
  });
});
