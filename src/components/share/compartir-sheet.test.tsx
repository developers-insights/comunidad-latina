// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const state = vi.hoisted(() => ({
  compartir: vi.fn(),
  reenviar: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/app/(app)/mensajes/compartir-actions", () => ({
  compartirEnChatAction: state.compartir,
}));
vi.mock("./reenviar-mensaje-action", () => ({ reenviarMensajeAction: state.reenviar }));
vi.mock("motion/react", async () => (await import("@/test/motion-mock")).motionMock());
vi.mock("@/components/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui")>();
  return {
    ...actual,
    BottomSheet: ({
      open,
      title,
      children,
    }: {
      open: boolean;
      title: string;
      children: React.ReactNode;
    }) =>
      open ? (
        <section role="dialog" aria-label={title}>
          {children}
        </section>
      ) : null,
    useToast: () => ({ toast: state.toast }),
  };
});

import { CompartirSheet } from "./compartir-sheet";

const MENSAJE_ID = "55555555-5555-4555-8555-555555555555";
const HILO_ID = "33333333-3333-4333-8333-333333333333";
const DESTINO_ID = "88888888-8888-4888-8888-888888888888";
const POST_ID = "44444444-4444-4444-8444-444444444444";
const URL = `https://comunidad.test/feed/${POST_ID}`;

beforeEach(() => {
  vi.clearAllMocks();
  state.compartir.mockResolvedValue({ ok: true, enviados: 1, fallidos: 0 });
  state.reenviar.mockResolvedValue({ ok: true, enviados: 1, fallidos: 0 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        recientes: true,
        destinos: [
          {
            tipo: "persona",
            id: DESTINO_ID,
            nombre: "Ana Pérez",
            avatarUrl: null,
            detalle: "Amiga",
            verificado: false,
          },
        ],
      }),
    })),
  );
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn(async () => undefined) },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CompartirSheet", () => {
  it("reenvía cualquier mensaje por referencia al origen", async () => {
    const onClose = vi.fn();
    render(
      <CompartirSheet
        open
        onClose={onClose}
        mensajeOrigen={{ ambito: "directo", mensajeId: MENSAJE_ID, hiloId: HILO_ID }}
        titulo="Mensaje de Ana"
      />,
    );

    fireEvent.click(await screen.findByRole("checkbox", { name: "Enviar a Ana Pérez" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar a 1" }));

    await waitFor(() =>
      expect(state.reenviar).toHaveBeenCalledWith({
        origen: { ambito: "directo", mensajeId: MENSAJE_ID, hiloId: HILO_ID },
        destinos: [{ tipo: "persona", id: DESTINO_ID }],
      }),
    );
    expect(state.compartir).not.toHaveBeenCalled();
  });

  it("ofrece salidas directas a Facebook e Instagram", async () => {
    render(
      <CompartirSheet
        open
        onClose={vi.fn()}
        kind="post"
        id={POST_ID}
        url={URL}
        titulo="Fiesta del barrio"
      />,
    );

    expect(screen.getByRole("button", { name: "Compartir en Facebook" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Compartir en Instagram" })).toBeTruthy();
  });

  it("si el navegador bloquea Facebook conserva una salida copiando el enlace", async () => {
    const onClose = vi.fn();
    const onCompartidoAfuera = vi.fn();
    vi.spyOn(window, "open").mockReturnValue(null);

    render(
      <CompartirSheet
        open
        onClose={onClose}
        kind="post"
        id={POST_ID}
        url={URL}
        titulo="Fiesta del barrio"
        onCompartidoAfuera={onCompartidoAfuera}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Compartir en Facebook" }));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(URL));
    expect(onCompartidoAfuera).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
