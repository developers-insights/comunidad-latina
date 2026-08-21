// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * =============================================================================
 * "VER COMENTARIOS ANTERIORES" CARGA EN EL LUGAR — SIN RECARGA Y SIN SALTO
 * =============================================================================
 *
 * Las dos cosas que este archivo fija son las dos que el cliente pidió
 * (2026-08-20: "ahí nomás dentro de pantalla se tiene que fluir; si no es como
 * que te corta el mambo"):
 *
 *  1. paginar NO cambia la ruta — antes cada tanda era un `<Link href="?antes=…">`
 *     que repintaba la página entera;
 *  2. el punto de lectura se conserva — meter 200 comentarios arriba sin anclar
 *     el scroll teletransporta igual que la recarga, sólo que para el otro lado.
 *
 * Sin (2), (1) no sirve de nada: se cambia un salto por otro. Por eso van juntas
 * y por eso las dos están acá.
 */

const action = vi.hoisted(() => ({ fetchOlder: vi.fn() }));

vi.mock("./older-comments", () => ({
  fetchOlderCommentsAction: action.fetchOlder,
}));

// Trust/listings: stubs planos (no es lo que se mide acá).
vi.mock("@/components/listings", () => ({
  PublisherTrust: () => null,
  firstNameOf: (name: string) => name.split(/\s+/)[0] ?? name,
}));

// El menú ⋯ del comentario pide el router de Next; acá sólo importa que exista
// el slot, no lo que hace el borrado (eso tiene sus propios tests).
vi.mock("@/components/feed/comment-menu", () => ({
  CommentMenu: () => (
    <button type="button" data-testid="menu-comentario">
      opciones
    </button>
  ),
}));

import { COMMENT_THREAD_PAGING_COPY } from "@/components/feed/comment-thread";
import { COMMENT_THREAD_COPY } from "@/components/feed/helpers";
import { ThreadPager } from "./thread-pager";
import type { OlderCommentItem } from "./older-comments";

/** Alto simulado del documento: base + un alto fijo por comentario en el DOM. */
const ALTO_BASE = 1000;
const ALTO_POR_COMENTARIO = 100;
/** Dónde está parada la persona cuando toca el botón. */
const SCROLL_INICIAL = 900;

function comentarioViejo(n: number): OlderCommentItem {
  return {
    id: `viejo-${n}`,
    body: `comentario viejo ${n}`,
    timeAgoLabel: "hace 2 días",
    authorId: `autor-${n}`,
    author: {
      profileId: `autor-${n}`,
      displayName: `Vecina ${n}`,
      avatarUrl: null,
      score: 0,
      level: "nuevo",
      signals: [],
    },
  };
}

/** La primera tanda, tal como la manda el SERVIDOR: `<li>` ya renderizados. */
function tandaDelServidor(cantidad: number) {
  return Array.from({ length: cantidad }, (_, i) => (
    <li key={`nuevo-${i}`}>comentario reciente {i + 1}</li>
  ));
}

function montar(cursorInicial: string | null = "cursor-1") {
  return render(
    <ThreadPager
      postId="11111111-2222-3333-4444-555555555555"
      viewerId={null}
      postAuthorId={null}
      initialOlderCursor={cursorInicial}
      hasInitialComments
    >
      {tandaDelServidor(2)}
    </ThreadPager>,
  );
}

function botonAnteriores(): HTMLButtonElement {
  return screen.getByRole("button", { name: COMMENT_THREAD_COPY.older });
}

async function tocar(boton: HTMLElement) {
  await act(async () => {
    fireEvent.click(boton);
  });
}

let scrollToSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  action.fetchOlder.mockReset();
  scrollToSpy = vi.fn();
  window.scrollTo = scrollToSpy as unknown as typeof window.scrollTo;
  // jsdom no hace layout: el alto del documento se deriva de cuántos comentarios
  // hay en el DOM, que es exactamente la relación que el ancla de scroll asume.
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    get: () =>
      ALTO_BASE + document.querySelectorAll("li").length * ALTO_POR_COMENTARIO,
  });
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    get: () => SCROLL_INICIAL,
  });
});

afterEach(() => {
  cleanup();
  delete (document.documentElement as unknown as Record<string, unknown>)
    .scrollHeight;
});

describe("paginación del hilo en el detalle de una publicación", () => {
  it("trae la tanda anterior SIN cambiar la ruta ni navegar", async () => {
    action.fetchOlder.mockResolvedValue({
      ok: true,
      items: [comentarioViejo(1), comentarioViejo(2), comentarioViejo(3)],
      olderCursor: "cursor-2",
    });

    const { container } = montar();
    const urlAntes = window.location.href;
    const historialAntes = window.history.length;

    await tocar(botonAnteriores());

    expect(await screen.findByText("comentario viejo 1")).toBeTruthy();
    // La primera tanda —la del servidor— sigue en pantalla: se AGREGA arriba,
    // no se reemplaza.
    expect(screen.getByText("comentario reciente 1")).toBeTruthy();

    expect(window.location.href).toBe(urlAntes);
    expect(window.history.length).toBe(historialAntes);
    // Y no queda ningún link a `?antes=`: el control es un botón, no una
    // navegación disfrazada de botón.
    expect(container.querySelectorAll('a[href*="antes="]').length).toBe(0);

    // El servidor ya devolvió el cursor de la tanda siguiente: la action se
    // llamó con el que tenía, no con uno inventado en el cliente.
    expect(action.fetchOlder).toHaveBeenCalledWith({
      postId: "11111111-2222-3333-4444-555555555555",
      cursor: "cursor-1",
    });
  });

  it("pega los anteriores ARRIBA, en el orden en que se lee el hilo", async () => {
    action.fetchOlder.mockResolvedValue({
      ok: true,
      items: [comentarioViejo(1), comentarioViejo(2)],
      olderCursor: null,
    });

    const { container } = montar();
    await tocar(botonAnteriores());
    await screen.findByText("comentario viejo 1");

    const textos = [...container.querySelectorAll("li")].map((li) =>
      (li.textContent ?? "").trim(),
    );
    expect(textos[0]).toContain("comentario viejo 1");
    expect(textos[1]).toContain("comentario viejo 2");
    expect(textos.at(-1)).toContain("comentario reciente 2");
    // Una sola lista: dos `<ul>` hermanas se le anuncian a un lector de
    // pantalla como dos hilos distintos.
    expect(container.querySelectorAll("ul").length).toBe(1);
  });

  it("conserva el punto de lectura: lo que estaba en pantalla no se mueve", async () => {
    action.fetchOlder.mockResolvedValue({
      ok: true,
      items: [comentarioViejo(1), comentarioViejo(2), comentarioViejo(3)],
      olderCursor: "cursor-2",
    });

    montar();

    // Antes: 2 comentarios en el DOM → alto 1200, parada en 900 → faltan 300
    // hasta el fondo. Después: 5 comentarios → alto 1500. Para que lo que se ve
    // no se mueva, el scroll tiene que quedar a esos mismos 300 del fondo.
    const altoAntes = ALTO_BASE + 2 * ALTO_POR_COMENTARIO;
    const distanciaAlFondo = altoAntes - SCROLL_INICIAL;
    const altoDespues = ALTO_BASE + 5 * ALTO_POR_COMENTARIO;

    await tocar(botonAnteriores());
    await screen.findByText("comentario viejo 1");

    expect(scrollToSpy).toHaveBeenCalledWith(0, altoDespues - distanciaAlFondo);
  });

  it("avisa a los lectores de pantalla cuántos comentarios entraron arriba", async () => {
    action.fetchOlder.mockResolvedValue({
      ok: true,
      items: [comentarioViejo(1), comentarioViejo(2)],
      olderCursor: "cursor-2",
    });

    montar();
    await tocar(botonAnteriores());
    await screen.findByText("comentario viejo 1");

    expect(
      screen.getByRole("status").textContent,
    ).toBe(COMMENT_THREAD_PAGING_COPY.addedAnnouncement(2));
  });

  it("al llegar al principio del hilo lo dice y NO suelta el foco", async () => {
    action.fetchOlder.mockResolvedValue({
      ok: true,
      items: [comentarioViejo(1)],
      olderCursor: null,
    });

    montar();
    await tocar(botonAnteriores());

    const marca = await screen.findByText(
      COMMENT_THREAD_PAGING_COPY.threadStart,
    );
    // El botón se fue del DOM: si nadie recoge el foco, cae al <body> y quien
    // navega con teclado queda al principio de la página.
    expect(screen.queryByRole("button", { name: COMMENT_THREAD_COPY.older })).toBe(
      null,
    );
    expect(document.activeElement).toBe(marca);
  });

  it("si la tanda no llega, ofrece reintentar y NO toca el hilo que ya se ve", async () => {
    action.fetchOlder.mockRejectedValueOnce(new Error("sin red"));

    montar();
    await tocar(botonAnteriores());

    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain(COMMENT_THREAD_PAGING_COPY.errorTitle);
    // Lo que ya estaba leyéndose sigue ahí: el error de una tanda nueva no
    // castiga a quien sólo quiso leer más atrás.
    expect(screen.getByText("comentario reciente 1")).toBeTruthy();

    action.fetchOlder.mockResolvedValue({
      ok: true,
      items: [comentarioViejo(1)],
      olderCursor: null,
    });
    await tocar(screen.getByRole("button", { name: /reintentar/i }));

    expect(await screen.findByText("comentario viejo 1")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBe(null);
  });

  it("el vacío del hilo se va apenas la tanda anterior trae algo", async () => {
    // Caso real aunque raro: la primera tanda vino ENTERA de gente bloqueada,
    // así que el hilo se ve vacío pero hay comentarios más atrás. Si el vacío
    // viviera en la página (que ya no se recarga), "Sé la primera persona en
    // responder" se quedaría arriba de los comentarios que acaban de entrar.
    action.fetchOlder.mockResolvedValue({
      ok: true,
      items: [comentarioViejo(1)],
      olderCursor: null,
    });

    render(
      <ThreadPager
        postId="11111111-2222-3333-4444-555555555555"
        viewerId={null}
        postAuthorId={null}
        initialOlderCursor="cursor-1"
        hasInitialComments={false}
        emptyState={<p>Sé la primera persona en responder</p>}
      >
        {null}
      </ThreadPager>,
    );

    expect(screen.getByText("Sé la primera persona en responder")).toBeTruthy();

    await tocar(botonAnteriores());
    await screen.findByText("comentario viejo 1");

    expect(screen.queryByText("Sé la primera persona en responder")).toBe(null);
  });

  it("sin tanda anterior no ofrece ningún control", () => {
    const { container } = montar(null);
    expect(
      screen.queryByRole("button", { name: COMMENT_THREAD_COPY.older }),
    ).toBe(null);
    expect(
      screen.queryByText(COMMENT_THREAD_PAGING_COPY.threadStart),
    ).toBe(null);
    expect(container.querySelectorAll("li").length).toBe(2);
  });
});
