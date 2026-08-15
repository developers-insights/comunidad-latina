// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AssistantChat } from "./assistant-chat";
import { ASSISTANT_COPY as COPY } from "./copy";

/**
 * El fetch a /api/assistant y el loop de reader.read() no tenían
 * AbortController: al navegar fuera con una respuesta a mitad de streaming,
 * el stream seguía corriendo y disparando setState sobre un componente ya
 * desmontado. Acá se prueba que `send()` viaja con una señal, que esa señal
 * se aborta al desmontar, y que un AbortError durante el stream NO le muestra
 * el error genérico a la persona (irse de la pantalla no es una falla).
 */

afterEach(cleanup);

// jsdom no implementa scrollIntoView — el auto-scroll del hilo lo llama en
// cuanto hay un primer mensaje.
Element.prototype.scrollIntoView = vi.fn();

// El auto-scroll del hilo consulta window.matchMedia directo (no vía el hook
// del repo) para decidir "smooth" vs "auto" — ajeno a este fix, pero sin
// stub jsdom no lo implementa y el efecto tira.
function stubMatchMedia() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function typeAndSend(question: string) {
  fireEvent.change(screen.getByLabelText(COPY.input.label), {
    target: { value: question },
  });
  fireEvent.click(screen.getByRole("button", { name: COPY.input.send }));
}

describe("AssistantChat: aborta el stream al desmontar", () => {
  it("pasa un AbortSignal al fetch y lo aborta cuando el componente se desmonta", async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      // Nunca resuelve dentro de este test: lo que importa es la señal.
      return new Promise(() => {});
    });
    vi.stubGlobal("fetch", fetchMock);
    stubMatchMedia();

    const { unmount } = render(<AssistantChat isAnon={false} initialAnonRemaining={null} />);

    await act(async () => {
      typeAndSend("¿Cómo saco turno en el consulado?");
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    expect(capturedSignal?.aborted).toBe(true);

    vi.unstubAllGlobals();
  });

  it("un AbortError a mitad de stream no muestra el error genérico", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: () =>
            Promise.reject(new DOMException("The operation was aborted.", "AbortError")),
        }),
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    stubMatchMedia();

    render(<AssistantChat isAnon={false} initialAnonRemaining={null} />);

    await act(async () => {
      typeAndSend("¿Dónde saco la licencia de conducir?");
    });

    // El catch de AbortError vuelve sin tocar el mensaje: sigue "escribiendo"
    // (burbuja vacía en estado streaming), nunca el fallback de error.
    await waitFor(() => {
      expect(screen.queryByText(COPY.errors.generic)).toBeNull();
    });
    expect(screen.getByRole("status", { name: COPY.typing })).toBeTruthy();

    vi.unstubAllGlobals();
  });
});
