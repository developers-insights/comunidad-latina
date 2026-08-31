// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui";
import { resetCommunityEmojiCache } from "@/lib/emojis/use-community-emojis";
import { CommentComposer } from "./comment-composer";

/**
 * EL PICKER DENTRO DEL CAMPO DE COMENTAR (0125).
 *
 * Lo que se protege acá es la INSERCIÓN, que es donde se rompe sin que se note:
 * un emoji que siempre cae al final obliga a cortar y pegar, y un código corto
 * pegado a la palabra siguiente (`:klk:que`) se lee como un error de tipeo. Las
 * dos cosas se ven bien en una captura de pantalla.
 *
 * El envío del comentario no se testea acá: eso es el server action, que ya
 * tiene lo suyo.
 */

const catalogo = vi.hoisted(() => ({
  result: {
    ok: true,
    emojis: [
      {
        id: "e-1",
        slug: "klk",
        label: "KLK",
        alt: "Saludo con la mano en alto",
        url: "https://cdn.test/klk.png",
        category: "saludos",
        scope: "global",
      },
    ],
  } as unknown,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/components/auth/auth-sheet", () => ({
  AUTH_REASON: { comment: "comment" },
  useRequireAuth: () => vi.fn(),
}));

vi.mock("@/app/(app)/feed/actions", () => ({
  createCommentAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/(app)/marketplace/comments-actions", () => ({
  createListingCommentAction: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/emojis/actions", () => ({
  listCommunityEmojisAction: vi.fn(async () => catalogo.result),
}));

// `Tabs` anima el subrayado con motion: neutralizado, el DOM refleja el estado
// al instante (mismo patrón que comments-sheet.test).
vi.mock("motion/react", async () => (await import("@/test/motion-mock")).motionMock());

function renderComposer() {
  const utils = render(
    <ToastProvider>
      <CommentComposer postId="post-1" />
    </ToastProvider>,
  );
  const textarea = screen.getByLabelText("Escribí tu comentario…") as HTMLTextAreaElement;
  return { ...utils, textarea };
}

/** Escribe y deja el cursor donde diga `caret`. */
function escribir(textarea: HTMLTextAreaElement, texto: string, caret: number) {
  fireEvent.change(textarea, { target: { value: texto } });
  textarea.setSelectionRange(caret, caret);
}

async function abrirPicker() {
  fireEvent.click(screen.getByRole("button", { name: "Abrir los emojis" }));
  // El catálogo se pide al abrir: se espera a que la grilla exista.
  return waitFor(() => screen.getByRole("button", { name: /Agregar KLK/ }));
}

beforeEach(() => {
  resetCommunityEmojiCache();
});
afterEach(cleanup);

describe("CommentComposer — emojis", () => {
  it("el botón está y anuncia si el panel está abierto o cerrado", async () => {
    renderComposer();
    const boton = screen.getByRole("button", { name: "Abrir los emojis" });
    expect(boton.getAttribute("aria-expanded")).toBe("false");

    await act(async () => {
      fireEvent.click(boton);
    });
    expect(screen.getByRole("button", { name: "Cerrar los emojis" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("dialog", { name: "Emojis" })).toBeTruthy();
  });

  it("un emoji clásico entra EN EL CURSOR, no al final", async () => {
    const { textarea } = renderComposer();
    escribir(textarea, "hola mundo", 4);

    await abrirPicker();
    fireEvent.click(screen.getByRole("tab", { name: "Clásicos" }));
    fireEvent.click(screen.getByRole("button", { name: "😎" }));

    expect(textarea.value).toBe("hola😎 mundo");
  });

  it("después de insertar, el cursor queda DESPUÉS del emoji y el foco vuelve al campo", async () => {
    const { textarea } = renderComposer();
    escribir(textarea, "hola mundo", 4);

    await abrirPicker();
    fireEvent.click(screen.getByRole("tab", { name: "Clásicos" }));
    fireEvent.click(screen.getByRole("button", { name: "😀" }));

    await waitFor(() => expect(document.activeElement).toBe(textarea));
    expect(textarea.selectionStart).toBe(4 + "😀".length);
  });

  it("un emoji de la comunidad entra como código corto", async () => {
    const { textarea } = renderComposer();
    escribir(textarea, "hola", 4);

    await abrirPicker();
    fireEvent.click(screen.getByRole("button", { name: /Agregar KLK/ }));

    expect(textarea.value).toBe("hola:klk:");
  });

  it("y se separa de lo que sigue: `:klk:que` se lee como un error de tipeo", async () => {
    const { textarea } = renderComposer();
    escribir(textarea, "hola", 2);

    await abrirPicker();
    fireEvent.click(screen.getByRole("button", { name: /Agregar KLK/ }));

    expect(textarea.value).toBe("ho:klk: la");
  });

  it("reemplaza lo que esté seleccionado, como cualquier campo de texto", async () => {
    const { textarea } = renderComposer();
    fireEvent.change(textarea, { target: { value: "hola mundo" } });
    textarea.setSelectionRange(5, 10);

    await abrirPicker();
    fireEvent.click(screen.getByRole("tab", { name: "Clásicos" }));
    fireEvent.click(screen.getByRole("button", { name: "🔥" }));

    expect(textarea.value).toBe("hola 🔥");
  });

  it("Escape cierra el panel y devuelve el foco al botón", async () => {
    renderComposer();
    await abrirPicker();

    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Abrir los emojis" }));
  });

  it("tocar afuera cierra el panel", async () => {
    renderComposer();
    await abrirPicker();

    await act(async () => {
      fireEvent.pointerDown(document.body);
    });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("con el catálogo vacío igual quedan los clásicos: el campo nunca se queda sin emojis", async () => {
    catalogo.result = { ok: true, emojis: [] };
    renderComposer();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Abrir los emojis" }));
    });

    await waitFor(() => screen.getByText("Todavía no tenemos los emojis nuestros"));
    expect(screen.getByRole("tab", { name: "Clásicos" })).toBeTruthy();

    catalogo.result = {
      ok: true,
      emojis: [
        {
          id: "e-1",
          slug: "klk",
          label: "KLK",
          alt: "Saludo con la mano en alto",
          url: "https://cdn.test/klk.png",
          category: "saludos",
          scope: "global",
        },
      ],
    };
  });
});
