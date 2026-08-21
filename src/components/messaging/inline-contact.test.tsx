// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * El contrato de "contactar sin cortar el mambo" (cliente 2026-08-20).
 *
 * Lo que se fija acá es lo que se rompió cuatro veces en este repo:
 *  1. Contactar NO navega. Ni al enviar, ni sin sesión, ni al confirmar.
 *  2. Cuando la conversación YA existía, la confirmación lo DICE. Un alta nueva
 *     pintada sobre un hilo viejo es un éxito falso, y es exactamente el defecto
 *     que la revisión encontró en otro módulo.
 *  3. Sin sesión se pide la hoja en el lugar y, al volver, la acción se reanuda
 *     sola — sin volver a pasar por el guard, que reabriría la hoja en bucle.
 */

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const auth = vi.hoisted(() => ({ require: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh }),
  usePathname: () => "/marketplace/abc",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/auth/auth-sheet", () => ({
  AUTH_REASON: { message: "Entrá y escribile" },
  useRequireAuth: () => auth.require,
}));

import { InlineContact, listingMessageOutcome } from "./inline-contact";

const COPY = {
  trigger: "Contactar",
  fieldLabel: "Escribí tu mensaje",
  placeholder: "Hola, me interesa.",
  send: "Enviar mensaje",
  cancel: "Cancelar",
  hint: "Tu teléfono no se comparte",
  sentTitle: "Mensaje enviado",
  sentBody: "Te avisamos acá apenas te respondan.",
  reusedTitle: "Lo sumamos al chat que ya tenían",
  reusedBody: "No abrimos nada nuevo.",
  threadLink: "Abrir el chat",
  retryLogin: "Entrar a mi cuenta",
};

function renderContact(
  overrides: Partial<React.ComponentProps<typeof InlineContact>> = {},
) {
  const onSend = vi.fn().mockResolvedValue({ ok: true, conversationId: "conv-1" });
  const props = { isLoggedIn: true, copy: COPY, onSend, ...overrides };
  render(<InlineContact {...props} />);
  return props.onSend;
}

/** Abre el composer y escribe. Devuelve el textarea. */
function openAndType(text: string): HTMLTextAreaElement {
  fireEvent.click(screen.getByRole("button", { name: COPY.trigger }));
  const textarea = screen.getByLabelText(COPY.fieldLabel) as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: text } });
  return textarea;
}

beforeEach(() => {
  nav.push.mockReset();
  nav.refresh.mockReset();
  auth.require.mockReset();
});

afterEach(cleanup);

describe("InlineContact", () => {
  it("el botón abre el composer en el lugar y no navega a ningún lado", () => {
    renderContact();
    expect(screen.queryByLabelText(COPY.fieldLabel)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: COPY.trigger }));

    expect(screen.getByLabelText(COPY.fieldLabel)).toBeTruthy();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("enviar confirma en la misma pantalla y deja el hilo como opción", async () => {
    const onSend = renderContact();
    openAndType("¿Sigue disponible?");

    fireEvent.click(screen.getByRole("button", { name: COPY.send }));

    expect(await screen.findByText(COPY.sentTitle)).toBeTruthy();
    expect(onSend).toHaveBeenCalledWith("¿Sigue disponible?");
    // La confirmación es una región viva: sin cambio de ruta, es lo único que
    // le avisa a un lector de pantalla que la acción salió.
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Abrir el chat/ }).getAttribute("href")).toBe(
      "/mensajes/conv-1",
    );
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(COPY.fieldLabel)).toBeNull();
  });

  it("si la conversación ya existía lo dice, y NO lo pinta como alta nueva", async () => {
    renderContact({
      onSend: vi.fn().mockResolvedValue({ ok: true, conversationId: "conv-9", reused: true }),
    });
    openAndType("Otra consulta");

    fireEvent.click(screen.getByRole("button", { name: COPY.send }));

    expect(await screen.findByText(COPY.reusedTitle)).toBeTruthy();
    expect(screen.getByText(COPY.reusedBody)).toBeTruthy();
    expect(screen.queryByText(COPY.sentTitle)).toBeNull();
    expect(screen.queryByText(COPY.sentBody)).toBeNull();
  });

  it("sin el dato de reuso usa el texto neutro en vez de inventar", async () => {
    renderContact({
      onSend: vi.fn().mockResolvedValue({ ok: true, conversationId: "conv-1" }),
    });
    openAndType("Hola");

    fireEvent.click(screen.getByRole("button", { name: COPY.send }));

    expect(await screen.findByText(COPY.sentTitle)).toBeTruthy();
    expect(screen.queryByText(COPY.reusedTitle)).toBeNull();
  });

  it("sin sesión pide la hoja en el lugar —no navega— y al volver abre el composer", () => {
    renderContact({ isLoggedIn: false });

    fireEvent.click(screen.getByRole("button", { name: COPY.trigger }));

    expect(nav.push).not.toHaveBeenCalled();
    expect(auth.require).toHaveBeenCalledTimes(1);
    const args = auth.require.mock.calls[0]?.[0] as { onAuthenticated: () => void };

    // El reintento corre en el closure de ANTES de entrar: `isLoggedIn` sigue
    // valiendo false. Si volviera a pasar por el guard, reabriría la hoja.
    act(() => args.onAuthenticated());

    expect(screen.getByLabelText(COPY.fieldLabel)).toBeTruthy();
    expect(auth.require).toHaveBeenCalledTimes(1);
  });

  it("un mensaje vacío no llama al action", () => {
    const onSend = renderContact();
    fireEvent.click(screen.getByRole("button", { name: COPY.trigger }));

    const sendButton = screen.getByRole("button", { name: COPY.send });
    fireEvent.click(sendButton);

    expect(onSend).not.toHaveBeenCalled();
    expect((sendButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("Enter envía y Shift+Enter no", async () => {
    const onSend = renderContact();
    const textarea = openAndType("Consulta rápida");

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(await screen.findByText(COPY.sentTitle)).toBeTruthy();
  });

  it("Escape cierra el composer y devuelve el foco al botón", () => {
    renderContact();
    const textarea = openAndType("Algo");

    fireEvent.keyDown(textarea, { key: "Escape" });

    expect(screen.queryByLabelText(COPY.fieldLabel)).toBeNull();
    expect(screen.getByRole("button", { name: COPY.trigger })).toBeTruthy();
  });

  it("un error se lee como frase humana y no colapsa a enviado", async () => {
    renderContact({
      onSend: vi.fn().mockResolvedValue({ ok: false, message: "No pudimos enviarlo." }),
    });
    openAndType("Hola");

    fireEvent.click(screen.getByRole("button", { name: COPY.send }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("No pudimos enviarlo.");
    expect(screen.queryByText(COPY.sentTitle)).toBeNull();
  });

  it("sesión vencida: reintenta el envío tras entrar, sin navegar", async () => {
    const onSend = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        message: "Se cerró tu sesión.",
        needsAuth: true,
      })
      .mockResolvedValueOnce({ ok: true, conversationId: "conv-2" });
    renderContact({ onSend });
    openAndType("Me interesa");

    fireEvent.click(screen.getByRole("button", { name: COPY.send }));
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: COPY.retryLogin }));
    const args = auth.require.mock.calls[0]?.[0] as { onAuthenticated: () => void };
    act(() => args.onAuthenticated());

    expect(await screen.findByText(COPY.sentTitle)).toBeTruthy();
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(onSend).toHaveBeenLastCalledWith("Me interesa");
    expect(nav.push).not.toHaveBeenCalled();
  });
});

describe("listingMessageOutcome", () => {
  const errors = {
    self: "Este aviso es tuyo.",
    blocked: "No podemos entregar este mensaje.",
    unauthenticated: "Se cerró tu sesión.",
    "tenant-mismatch": "Algo no cuadra con tu sesión.",
    invalid: "Escribí un poquito más.",
    error: "No pudimos enviarlo.",
  };

  it("propaga el reuso que informa el action", () => {
    expect(
      listingMessageOutcome({ ok: true, conversationId: "c1", reused: true }, errors),
    ).toEqual({ ok: true, conversationId: "c1", reused: true });
  });

  it("traduce el code a una frase humana y nunca lo muestra crudo", () => {
    const outcome = listingMessageOutcome({ ok: false, code: "blocked" }, errors);
    expect(outcome).toEqual({
      ok: false,
      message: errors.blocked,
      needsAuth: false,
      collapse: false,
    });
  });

  it("un code desconocido cae al error genérico en vez de romper", () => {
    const outcome = listingMessageOutcome(
      // Un contrato que crece no puede dejar la pantalla muda.
      { ok: false, code: "algo-nuevo" } as never,
      errors,
    );
    expect(outcome).toEqual({
      ok: false,
      message: errors.error,
      needsAuth: false,
      collapse: false,
    });
  });
});
