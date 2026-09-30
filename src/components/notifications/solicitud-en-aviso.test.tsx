// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SolicitudEnAviso } from "./solicitud-en-aviso";
import { COPY } from "./copy";
import type { SolicitudDelAviso } from "@/lib/notifications/solicitud";

const toast = vi.fn();
vi.mock("@/components/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui")>();
  return { ...actual, useToast: () => ({ toast }) };
});

const responder = vi.fn();
vi.mock("@/app/(app)/notificaciones/solicitud-actions", () => ({
  responderSolicitudAction: (input: unknown) => responder(input),
}));

const SOLICITUD: SolicitudDelAviso = {
  conversationId: "55555555-5555-4555-8555-555555555555",
  estado: "pendiente",
  actor: { id: "88888888-8888-4888-8888-888888888888", nombre: "Nacho", avatarUrl: null },
};

function mount(props: Partial<Parameters<typeof SolicitudEnAviso>[0]> = {}) {
  return render(
    <SolicitudEnAviso
      notificationId="66666666-6666-4666-8666-666666666666"
      solicitud={SOLICITUD}
      titulo="Nacho quiere hablar con vos"
      createdAt="2026-09-30T21:20:49.883Z"
      timeLabel="hace 1 min"
      leida={false}
      {...props}
    />,
  );
}

beforeEach(() => {
  responder.mockReset();
  toast.mockReset();
});
afterEach(cleanup);

describe("SolicitudEnAviso", () => {
  it("nombre y avatar llevan al perfil de quien pide", () => {
    mount();
    const enlaces = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href") === `/perfil/${SOLICITUD.actor.id}`);
    expect(enlaces).toHaveLength(2);
    expect(screen.getByText("Nacho")).toBeTruthy();
    expect(screen.getByText(/quiere hablar con vos/)).toBeTruthy();
  });

  it("confirmar muta al instante, sin esperar a la base, y ofrece escribirle", async () => {
    let resolver: (v: unknown) => void = () => {};
    responder.mockReturnValue(new Promise((r) => (resolver = r)));
    const onLeida = vi.fn();
    mount({ onLeida });

    fireEvent.click(screen.getByRole("button", { name: COPY.solicitud.confirmarLabel("Nacho") }));

    expect(await screen.findByText(COPY.solicitud.aceptada)).toBeTruthy();
    expect(onLeida).toHaveBeenCalledTimes(1);
    expect(responder).toHaveBeenCalledWith({
      notificationId: "66666666-6666-4666-8666-666666666666",
      conversationId: SOLICITUD.conversationId,
      decision: "confirmar",
    });

    resolver({ ok: true, estado: "aceptada" });
    const escribir = await screen.findByRole("link", {
      name: COPY.solicitud.escribirLabel("Nacho"),
    });
    expect(escribir.getAttribute("href")).toBe(`/mensajes/${SOLICITUD.conversationId}`);
  });

  it("el doble toque manda una sola respuesta", async () => {
    responder.mockReturnValue(new Promise(() => {}));
    mount();
    const boton = screen.getByRole("button", { name: COPY.solicitud.confirmarLabel("Nacho") });
    fireEvent.click(boton);
    fireEvent.click(boton);
    await waitFor(() => expect(responder).toHaveBeenCalledTimes(1));
  });

  it("si falla, vuelve a los botones y muestra el error", async () => {
    responder.mockResolvedValue({ ok: false, code: "error" });
    mount();

    fireEvent.click(screen.getByRole("button", { name: COPY.solicitud.eliminarLabel("Nacho") }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: COPY.solicitud.confirmarLabel("Nacho") }),
    ).toBeTruthy();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "danger" }));
  });

  it("si ya se había resuelto en otro lado, muestra el estado real", async () => {
    responder.mockResolvedValue({ ok: false, code: "ya_resuelta", estado: "aceptada" });
    mount();

    fireEvent.click(screen.getByRole("button", { name: COPY.solicitud.eliminarLabel("Nacho") }));

    expect(await screen.findByText(COPY.solicitud.aceptada)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("una solicitud ya respondida no ofrece botones", () => {
    mount({ solicitud: { ...SOLICITUD, estado: "eliminada" } });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(COPY.solicitud.eliminada)).toBeTruthy();
  });
});
