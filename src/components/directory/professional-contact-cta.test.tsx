// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * "Contactar" en la CARD del directorio (spec cliente: cada perfil muestra
 * "Ver perfil" Y "Contactar"). Antes sólo estaba "Ver perfil" — acá se fija que
 * el segundo botón manda por la MISMA server action protegida, nunca navega, y
 * que la ficha externa (sin cuenta) explica en vez de intentar un mensaje que
 * la base va a rechazar.
 */

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const auth = vi.hoisted(() => ({ require: vi.fn() }));

vi.mock("@/app/(app)/mensajes/inline-actions", () => ({
  sendListingMessageAction: mocks.send,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh }),
  usePathname: () => "/profesionales",
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

import { ProfessionalContactCta } from "./professional-contact-cta";

const LISTING_ID = "33333333-3333-4333-8333-333333333333";
const FIELD_LABEL = "Escribí tu mensaje";

function renderCta(
  overrides: Partial<React.ComponentProps<typeof ProfessionalContactCta>> = {},
) {
  return render(
    <ProfessionalContactCta
      listingId={LISTING_ID}
      title="Estudio Jurídico Pérez"
      isLoggedIn
      isExternal={false}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  mocks.send.mockReset();
  nav.push.mockReset();
  auth.require.mockReset();
});

afterEach(cleanup);

describe("ProfessionalContactCta: ficha con cuenta", () => {
  it("tocar 'Contactar' abre el composer ahí mismo, sin navegar", () => {
    renderCta();

    fireEvent.click(screen.getByRole("button", { name: "Contactar" }));

    expect(screen.getByLabelText(FIELD_LABEL)).toBeTruthy();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("el placeholder menciona el nombre del profesional", () => {
    renderCta({ title: "Estudio Jurídico Pérez" });
    fireEvent.click(screen.getByRole("button", { name: "Contactar" }));

    expect(
      screen.getByPlaceholderText('Hola, quería consultarte por "Estudio Jurídico Pérez".'),
    ).toBeTruthy();
  });

  it("enviar usa sendListingMessageAction con el listingId de la ficha", async () => {
    mocks.send.mockResolvedValue({ ok: true, conversationId: "conv-9" });
    renderCta();
    fireEvent.click(screen.getByRole("button", { name: "Contactar" }));
    fireEvent.change(screen.getByLabelText(FIELD_LABEL), {
      target: { value: "¿Tomás casos de inmigración?" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje" }));

    expect(await screen.findByText("Mensaje enviado")).toBeTruthy();
    expect(mocks.send).toHaveBeenCalledWith({
      listingId: LISTING_ID,
      body: "¿Tomás casos de inmigración?",
    });
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("si ya había conversación, lo dice en vez de festejar un alta nueva", async () => {
    mocks.send.mockResolvedValue({ ok: true, conversationId: "conv-9", reused: true });
    renderCta();
    fireEvent.click(screen.getByRole("button", { name: "Contactar" }));
    fireEvent.change(screen.getByLabelText(FIELD_LABEL), { target: { value: "Otra consulta" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje" }));

    expect(await screen.findByText("Lo sumamos al chat que ya tenían")).toBeTruthy();
    expect(screen.queryByText("Mensaje enviado")).toBeNull();
  });

  it("sin sesión abre la hoja de entrar sobre la lista, sin navegar a /entrar", () => {
    renderCta({ isLoggedIn: false });

    fireEvent.click(screen.getByRole("button", { name: "Contactar" }));

    expect(nav.push).not.toHaveBeenCalled();
    expect(auth.require).toHaveBeenCalledTimes(1);

    const args = auth.require.mock.calls[0]?.[0] as { onAuthenticated: () => void };
    act(() => args.onAuthenticated());
    expect(screen.getByLabelText(FIELD_LABEL)).toBeTruthy();
  });
});

describe("ProfessionalContactCta: ficha de fuente externa (sin cuenta)", () => {
  it("no ofrece un composer que la base rechazaría", () => {
    renderCta({ isExternal: true, externalName: "Directorio Comunitario" });

    fireEvent.click(screen.getByRole("button", { name: "Contactar" }));

    expect(screen.queryByLabelText(FIELD_LABEL)).toBeNull();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("explica de dónde salió el perfil, nombrando la fuente", async () => {
    renderCta({ isExternal: true, externalName: "Directorio Comunitario" });

    fireEvent.click(screen.getByRole("button", { name: "Contactar" }));

    expect(await screen.findByText(/Directorio Comunitario/)).toBeTruthy();
  });
});
