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
  useCommentsSheet: () => ({ open: vi.fn() }),
}));

import { PostActions } from "./post-actions";
import { COPY } from "./copy";

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
