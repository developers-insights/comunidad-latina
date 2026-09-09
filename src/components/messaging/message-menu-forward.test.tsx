// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock("motion/react", async () => (await import("@/test/motion-mock")).motionMock());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/design/use-overlay", () => ({
  useBodyScrollLock: vi.fn(),
  useFocusTrap: vi.fn(),
  useMounted: () => true,
}));
vi.mock("@/components/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui")>();
  return { ...actual, useToast: () => ({ toast: state.toast }) };
});
vi.mock("@/app/(app)/mensajes/mensaje-actions", () => ({
  editarMensajeAction: vi.fn(),
  eliminarMensajeAction: vi.fn(),
  reportarMensajeAction: vi.fn(),
}));
vi.mock("./reaction-bar", () => ({ ReactionBar: () => null }));
vi.mock("./reply-quote", () => ({ useResponder: () => null }));
vi.mock("@/components/share", () => ({
  esCompartidoKind: () => false,
  CompartirSheet: ({
    open,
    mensajeOrigen,
  }: {
    open: boolean;
    mensajeOrigen?: { ambito: string; mensajeId: string; hiloId: string };
  }) =>
    open ? (
      <section role="dialog" aria-label="Reenvío genérico">
        {JSON.stringify(mensajeOrigen)}
      </section>
    ) : null,
}));

import { MessageActions } from "./message-menu";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MessageActions", () => {
  it("permite reenviar un mensaje de texto por referencia aunque no sea contenido compartido", () => {
    render(
      <MessageActions
        ambito="directo"
        mensajeId="55555555-5555-4555-8555-555555555555"
        hiloId="33333333-3333-4333-8333-333333333333"
        isOwn
        kind="texto"
        createdAt={new Date().toISOString()}
        body="Hola"
        autorNombre="Ana"
        compartido={null}
      >
        <span>Hola</span>
      </MessageActions>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Opciones del mensaje" }));
    fireEvent.click(screen.getByRole("button", { name: "Reenviar" }));

    expect(screen.getByRole("dialog", { name: "Reenvío genérico" }).textContent).toContain(
      '"mensajeId":"55555555-5555-4555-8555-555555555555"',
    );
  });
});
