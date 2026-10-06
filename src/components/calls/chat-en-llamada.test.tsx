/** @vitest-environment jsdom */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { ChatEnLlamada } from "./chat-en-llamada";
import { Controles } from "./controles";
import {
  MensajesEnVuelo,
  useEnvioOptimista,
} from "@/components/messaging/en-vuelo";

afterEach(cleanup);

beforeEach(() => {
  Element.prototype.scrollTo =
    vi.fn() as unknown as typeof Element.prototype.scrollTo;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("reduce"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

function Hilo({ mensajes }: { mensajes: { id: string; propio: boolean }[] }) {
  const optimista = useEnvioOptimista();
  return (
    <div>
      <button type="button" onClick={() => optimista?.agregar("hola en vuelo")}>
        enviar
      </button>
      {mensajes.map((m) => (
        <p key={m.id}>{m.id}</p>
      ))}
      <MensajesEnVuelo mensajes={mensajes} />
    </div>
  );
}

function Escenario({
  mensajes,
}: {
  mensajes: { id: string; propio: boolean }[];
}) {
  const [abierto, setAbierto] = useState(false);
  const [noLeidos, setNoLeidos] = useState(0);
  return (
    <>
      <Controles
        kind="video"
        micApagado={false}
        camaraApagada={false}
        sonidoApagado={false}
        puedeAgregar
        chatDisponible
        chatAbierto={abierto}
        noLeidos={noLeidos}
        onMic={vi.fn()}
        onCamara={vi.fn()}
        onSonido={vi.fn()}
        onAgregar={vi.fn()}
        onChat={() => {
          setAbierto((a) => !a);
          setNoLeidos(0);
        }}
        onFinalizar={vi.fn()}
      />
      <ChatEnLlamada
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        onNuevosAjenos={(n) => {
          if (!abierto) setNoLeidos((x) => x + n);
        }}
        titulo="Chat con Ana"
        subtitulo={null}
      >
        <Hilo mensajes={mensajes} />
      </ChatEnLlamada>
    </>
  );
}

const panel = () =>
  document.querySelector<HTMLElement>(
    'section[aria-label="Chat de la llamada"]',
  )!;

describe("ChatEnLlamada", () => {
  it("abre y cierra el panel sin salir de la pantalla (nada de window.open)", () => {
    const abrir = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<Escenario mensajes={[{ id: "m1", propio: false }]} />);

    expect(panel().hidden).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Abrir el chat" }));
    expect(panel().hidden).toBe(false);
    expect(screen.getByText("Chat con Ana")).toBeTruthy();
    expect(abrir).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Cerrar el chat", pressed: true }),
    );
    expect(panel().hidden).toBe(true);
  });

  it("cierra con Escape y con el botón de la cabecera", () => {
    render(<Escenario mensajes={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir el chat" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(panel().hidden).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Abrir el chat" }));
    const dentro = screen.getAllByRole("button", { name: "Cerrar el chat" });
    fireEvent.click(dentro[dentro.length - 1]);
    expect(panel().hidden).toBe(true);
  });

  it("mantiene el hilo montado con el panel cerrado", () => {
    render(<Escenario mensajes={[{ id: "m1", propio: false }]} />);
    expect(screen.getByText("m1", { selector: "p" })).toBeTruthy();
  });

  it("cuenta como no leídos sólo los mensajes ajenos que llegan con el panel cerrado", () => {
    const { rerender } = render(
      <Escenario mensajes={[{ id: "m1", propio: false }]} />,
    );
    expect(screen.queryByTestId("insignia-chat")).toBeNull();

    rerender(
      <Escenario
        mensajes={[
          { id: "m1", propio: false },
          { id: "m2", propio: false },
          { id: "m3", propio: true },
          { id: "m4", propio: false },
        ]}
      />,
    );
    expect(screen.getByTestId("insignia-chat").textContent).toBe("2");
    expect(
      screen.getByRole("button", { name: "Abrir el chat, 2 mensajes nuevos" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Abrir el chat/ }));
    expect(screen.queryByTestId("insignia-chat")).toBeNull();
  });

  it("pinta el mensaje al instante y lo retira cuando llega el real", () => {
    const { rerender } = render(
      <Escenario mensajes={[{ id: "m1", propio: false }]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Abrir el chat" }));

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "enviar" }));
    });
    expect(screen.getByText("hola en vuelo")).toBeTruthy();
    expect(screen.getByText("Enviando…")).toBeTruthy();

    rerender(
      <Escenario
        mensajes={[
          { id: "m1", propio: false },
          { id: "m2", propio: true },
        ]}
      />,
    );
    expect(screen.queryByText("hola en vuelo")).toBeNull();
  });
});
