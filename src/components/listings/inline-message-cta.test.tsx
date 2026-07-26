// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * El mensaje inline es el pedido central de la call 2026-07-24: escribirle a
 * quien vende SIN salir de la publicación. Acá se fija ese contrato de
 * interacción — expandir en el lugar, enviar, colapsar a "Enviado" — y que cada
 * error del action tenga una frase humana en pantalla, no un code.
 *
 * El server action y el toast van stubeados: lo que se testea es el componente.
 */

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/app/(app)/mensajes/inline-actions", () => ({
  sendListingMessageAction: mocks.send,
}));

// El barrel @/components/ui reexporta ./toast: mockear el módulo real alcanza
// para que Button/Spinner sigan siendo los de verdad.
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast, dismiss: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { INLINE_MESSAGE_COPY as C, InlineMessageCta } from "./inline-message-cta";

const LISTING_ID = "11111111-1111-4111-8111-111111111111";

function renderCta(overrides: Partial<React.ComponentProps<typeof InlineMessageCta>> = {}) {
  return render(
    <InlineMessageCta
      listingId={LISTING_ID}
      isLoggedIn
      nextPath="/marketplace/abc"
      {...overrides}
    />,
  );
}

/** Abre el composer y escribe un mensaje. Devuelve el textarea. */
function openAndType(text: string): HTMLTextAreaElement {
  fireEvent.click(screen.getByRole("button", { name: C.cta }));
  const textarea = screen.getByLabelText(C.fieldLabel) as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: text } });
  return textarea;
}

beforeEach(() => {
  mocks.send.mockReset();
  mocks.toast.mockReset();
});

afterEach(cleanup);

describe("InlineMessageCta", () => {
  it("sin sesión no muestra composer: lleva a entrar y vuelve a la pantalla", () => {
    renderCta({ isLoggedIn: false, nextPath: "/eventos/e1" });

    const link = screen.getByRole("link", { name: C.cta });
    expect(link.getAttribute("href")).toBe(`/entrar?next=${encodeURIComponent("/eventos/e1")}`);
    expect(screen.queryByLabelText(C.fieldLabel)).toBeNull();
  });

  it("el botón expande el composer en el lugar, sin navegar", () => {
    renderCta();
    expect(screen.queryByLabelText(C.fieldLabel)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: C.cta }));

    expect(screen.getByLabelText(C.fieldLabel)).toBeTruthy();
    expect(screen.getByRole("button", { name: C.send })).toBeTruthy();
  });

  it("enviar con éxito colapsa a 'Enviado', linkea a Mensajes y avisa por toast", async () => {
    mocks.send.mockResolvedValue({ ok: true, conversationId: "conv-1" });
    renderCta();
    openAndType("Hola, ¿sigue disponible?");

    fireEvent.click(screen.getByRole("button", { name: C.send }));

    expect(await screen.findByText(C.sentLabel)).toBeTruthy();
    expect(mocks.send).toHaveBeenCalledWith({
      listingId: LISTING_ID,
      body: "Hola, ¿sigue disponible?",
    });
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: C.successTitle, variant: "success" }),
    );

    const link = screen.getByRole("link", { name: C.sentLink });
    expect(link.getAttribute("href")).toBe("/mensajes");
    // El composer se fue: el bloque quedó colapsado.
    expect(screen.queryByLabelText(C.fieldLabel)).toBeNull();
  });

  it("Enter envía y Shift+Enter no", async () => {
    mocks.send.mockResolvedValue({ ok: true, conversationId: "conv-1" });
    renderCta();
    const textarea = openAndType("Consulta rápida");

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(mocks.send).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
  });

  it("un mensaje vacío no llama al action", () => {
    renderCta();
    fireEvent.click(screen.getByRole("button", { name: C.cta }));

    const sendButton = screen.getByRole("button", { name: C.send });
    fireEvent.click(sendButton);

    expect(mocks.send).not.toHaveBeenCalled();
    expect((sendButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("error 'self': explica que es tu propia publicación y no colapsa a enviado", async () => {
    mocks.send.mockResolvedValue({ ok: false, code: "self" });
    renderCta();
    openAndType("Me interesa");

    fireEvent.click(screen.getByRole("button", { name: C.send }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(C.errors.self);
    expect(screen.queryByText(C.sentLabel)).toBeNull();
  });

  it("error 'blocked': copy humano, sin exponer el code", async () => {
    mocks.send.mockResolvedValue({ ok: false, code: "blocked" });
    renderCta();
    openAndType("Hola");

    fireEvent.click(screen.getByRole("button", { name: C.send }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(C.errors.blocked);
    expect(alert.textContent).not.toContain("blocked");
  });

  it("error 'unauthenticated': suma la salida a entrar de vuelta", async () => {
    mocks.send.mockResolvedValue({ ok: false, code: "unauthenticated" });
    renderCta({ nextPath: "/marketplace/xyz" });
    openAndType("Hola");

    fireEvent.click(screen.getByRole("button", { name: C.send }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(C.errors.unauthenticated);
    expect(screen.getByRole("link", { name: C.loginCta }).getAttribute("href")).toBe(
      `/entrar?next=${encodeURIComponent("/marketplace/xyz")}`,
    );
  });

  it("un code desconocido cae al error genérico en vez de romper", async () => {
    mocks.send.mockResolvedValue({ ok: false, code: "algo-nuevo" });
    renderCta();
    openAndType("Hola");

    fireEvent.click(screen.getByRole("button", { name: C.send }));

    expect((await screen.findByRole("alert")).textContent).toContain(C.errors.error);
  });
});
