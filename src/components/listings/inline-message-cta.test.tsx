// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * El mensaje inline es el pedido central de la call 2026-07-24: escribirle a
 * quien vende SIN salir de la publicación. Acá se fija lo que es propio de ESTE
 * módulo —el cableado con la server action y la traducción de cada código a una
 * frase humana—; la mecánica del composer (abrir, enviar, Escape, reintento
 * tras entrar) vive en `messaging/inline-contact.test.tsx`.
 *
 * La regla que no se negocia: contactar nunca navega. El 2026-08-20 se cayó el
 * último muro —el link a `/entrar`— y en su lugar quedó la hoja de sesión.
 */

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const auth = vi.hoisted(() => ({ require: vi.fn() }));

vi.mock("@/app/(app)/mensajes/inline-actions", () => ({
  sendListingMessageAction: mocks.send,
}));

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

import { INLINE_MESSAGE_COPY as C, InlineMessageCta } from "./inline-message-cta";

const LISTING_ID = "11111111-1111-4111-8111-111111111111";

function renderCta(overrides: Partial<React.ComponentProps<typeof InlineMessageCta>> = {}) {
  return render(<InlineMessageCta listingId={LISTING_ID} isLoggedIn {...overrides} />);
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
  nav.push.mockReset();
  auth.require.mockReset();
});

afterEach(cleanup);

describe("InlineMessageCta", () => {
  it("sin sesión abre la hoja de entrar encima de la publicación, sin navegar", () => {
    renderCta({ isLoggedIn: false });

    fireEvent.click(screen.getByRole("button", { name: C.cta }));

    expect(nav.push).not.toHaveBeenCalled();
    expect(auth.require).toHaveBeenCalledTimes(1);
    // Ya no hay link a /entrar: ese era el último muro que expulsaba.
    expect(screen.queryByRole("link", { name: C.cta })).toBeNull();

    const args = auth.require.mock.calls[0]?.[0] as { onAuthenticated: () => void };
    act(() => args.onAuthenticated());
    expect(screen.getByLabelText(C.fieldLabel)).toBeTruthy();
  });

  it("enviar manda el body al action y confirma sin cambiar de ruta", async () => {
    mocks.send.mockResolvedValue({ ok: true, conversationId: "conv-1" });
    renderCta();
    openAndType("Hola, ¿sigue disponible?");

    fireEvent.click(screen.getByRole("button", { name: C.send }));

    expect(await screen.findByText(C.successTitle)).toBeTruthy();
    expect(mocks.send).toHaveBeenCalledWith({
      listingId: LISTING_ID,
      body: "Hola, ¿sigue disponible?",
    });
    expect(screen.getByRole("link", { name: /Abrir el chat/ }).getAttribute("href")).toBe(
      "/mensajes/conv-1",
    );
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(C.fieldLabel)).toBeNull();
  });

  it("si ya había conversación no la pinta como alta nueva", async () => {
    mocks.send.mockResolvedValue({ ok: true, conversationId: "conv-7", reused: true });
    renderCta();
    openAndType("Otra consulta");

    fireEvent.click(screen.getByRole("button", { name: C.send }));

    expect(await screen.findByText(C.reusedTitle)).toBeTruthy();
    expect(screen.queryByText(C.successTitle)).toBeNull();
  });

  it("error 'self': explica que es tu propia publicación y cierra el composer", async () => {
    mocks.send.mockResolvedValue({ ok: false, code: "self" });
    renderCta();
    openAndType("Me interesa");

    fireEvent.click(screen.getByRole("button", { name: C.send }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(C.errors.self);
    expect(screen.queryByText(C.successTitle)).toBeNull();
    expect(screen.queryByLabelText(C.fieldLabel)).toBeNull();
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

  it("error 'unauthenticated': ofrece entrar ahí mismo, no un link que expulse", async () => {
    mocks.send.mockResolvedValue({ ok: false, code: "unauthenticated" });
    renderCta();
    openAndType("Hola");

    fireEvent.click(screen.getByRole("button", { name: C.send }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(C.errors.unauthenticated);
    expect(screen.getByRole("button", { name: C.loginCta })).toBeTruthy();
    expect(screen.queryByRole("link", { name: C.loginCta })).toBeNull();
  });

  it("un code desconocido cae al error genérico en vez de romper", async () => {
    mocks.send.mockResolvedValue({ ok: false, code: "algo-nuevo" });
    renderCta();
    openAndType("Hola");

    fireEvent.click(screen.getByRole("button", { name: C.send }));

    expect((await screen.findByRole("alert")).textContent).toContain(C.errors.error);
  });
});
