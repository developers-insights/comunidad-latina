// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * Contactar a un profesional mandaba a `/mensajes` (la bandeja genérica), así
 * que la persona perdía el perfil que estaba evaluando —reseñas, verificación,
 * precios— justo cuando decidía contratarlo. Cliente 2026-08-20: "sin sacarte
 * del feed; si no es como que te corta el mambo".
 *
 * Se fija que el contacto se resuelve acá, que sigue pasando por la server
 * action existente y que el reuso de conversación se dice, no se disimula.
 */

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const auth = vi.hoisted(() => ({ require: vi.fn() }));

vi.mock("@/app/(app)/mensajes/inline-actions", () => ({
  sendListingMessageAction: mocks.send,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh }),
  usePathname: () => "/profesionales/abc",
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

import { DirectoryContactCta } from "./directory-contact-cta";

const LISTING_ID = "22222222-2222-4222-8222-222222222222";
const FIELD_LABEL = "Escribí tu mensaje";

function renderCta(
  overrides: Partial<React.ComponentProps<typeof DirectoryContactCta>> = {},
) {
  return render(
    <DirectoryContactCta
      listingId={LISTING_ID}
      returnPath="/profesionales/abc"
      isLoggedIn
      isExternal={false}
      {...overrides}
    />,
  );
}

function openAndType(text: string) {
  fireEvent.click(screen.getByRole("button", { name: "Contactar" }));
  fireEvent.change(screen.getByLabelText(FIELD_LABEL), { target: { value: text } });
}

beforeEach(() => {
  mocks.send.mockReset();
  nav.push.mockReset();
  auth.require.mockReset();
});

afterEach(cleanup);

describe("DirectoryContactCta", () => {
  it("contactar abre el composer sobre el perfil y no navega", () => {
    renderCta();

    fireEvent.click(screen.getByRole("button", { name: "Contactar" }));

    expect(screen.getByLabelText(FIELD_LABEL)).toBeTruthy();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("enviar usa la server action de siempre y confirma en el lugar", async () => {
    mocks.send.mockResolvedValue({ ok: true, conversationId: "conv-5" });
    renderCta();
    openAndType("¿Estás tomando trabajos?");

    fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje" }));

    expect(await screen.findByText("Mensaje enviado")).toBeTruthy();
    expect(mocks.send).toHaveBeenCalledWith({
      listingId: LISTING_ID,
      body: "¿Estás tomando trabajos?",
    });
    expect(screen.getByRole("link", { name: /Abrir el chat/ }).getAttribute("href")).toBe(
      "/mensajes/conv-5",
    );
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("si ya había conversación no la presenta como nueva", async () => {
    mocks.send.mockResolvedValue({ ok: true, conversationId: "conv-5", reused: true });
    renderCta();
    openAndType("Una consulta más");

    fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje" }));

    expect(await screen.findByText("Lo sumamos al chat que ya tenían")).toBeTruthy();
    expect(screen.queryByText("Mensaje enviado")).toBeNull();
  });

  it("el perfil propio se explica con calma y cierra el composer", async () => {
    mocks.send.mockResolvedValue({ ok: false, code: "self" });
    renderCta();
    openAndType("Hola");

    fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Este perfil es tuyo");
    expect(screen.queryByLabelText(FIELD_LABEL)).toBeNull();
  });

  it("sin sesión pide entrar sobre el perfil y reanuda ahí mismo", () => {
    renderCta({ isLoggedIn: false });

    fireEvent.click(screen.getByRole("button", { name: "Contactar" }));

    expect(nav.push).not.toHaveBeenCalled();
    const args = auth.require.mock.calls[0]?.[0] as { onAuthenticated: () => void };
    act(() => args.onAuthenticated());

    expect(screen.getByLabelText(FIELD_LABEL)).toBeTruthy();
  });

  it("perfil de fuente externa: sin composer, se explica de dónde salió", () => {
    renderCta({ isExternal: true, externalName: "Guía Latina" });

    fireEvent.click(screen.getByRole("button", { name: "Contactar" }));

    expect(screen.queryByLabelText(FIELD_LABEL)).toBeNull();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
  });
});
