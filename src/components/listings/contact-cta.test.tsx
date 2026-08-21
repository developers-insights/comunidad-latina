// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * "Contactar" era el peor de los cortes: hacía `router.push('/mensajes')` — a la
 * bandeja GENÉRICA, ni siquiera al hilo— y la persona perdía el aviso, las
 * fotos y el scroll del listado del que venía (cliente 2026-08-20).
 *
 * Lo que se fija acá:
 *  - contactar NO navega, ni con sesión ni sin ella;
 *  - el mensaje viaja por la server action que ya existía (mismo
 *    `request_contact` por debajo: el contacto protegido §9.2 no se abarata);
 *  - "ya había conversación" no se pinta como alta nueva;
 *  - el clic se sigue contando como `chat` en `cta_clicks`, que es de lo que
 *    vive el panel del dueño;
 *  - el aviso de fuente externa sigue sin composer, porque ahí no hay a quién
 *    escribirle dentro de la app.
 */

const mocks = vi.hoisted(() => ({ send: vi.fn(), recordClick: vi.fn() }));
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const auth = vi.hoisted(() => ({ require: vi.fn() }));

vi.mock("@/app/(app)/mensajes/inline-actions", () => ({
  sendListingMessageAction: mocks.send,
}));

vi.mock("@/lib/monetization/actions", () => ({
  recordCtaClickAction: mocks.recordClick,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh }),
  usePathname: () => "/propiedades/abc",
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

import { ContactCta, ListingActions } from "./contact-cta";
import { COPY } from "./copy";

const LISTING_ID = "11111111-1111-4111-8111-111111111111";
const FIELD_LABEL = "Escribí tu mensaje";
const SEND = "Enviar mensaje";

function renderCta(overrides: Partial<React.ComponentProps<typeof ContactCta>> = {}) {
  return render(
    <ContactCta listingId={LISTING_ID} isLoggedIn isExternal={false} {...overrides} />,
  );
}

function openAndType(text: string) {
  fireEvent.click(screen.getByRole("button", { name: COPY.detail.contactCta }));
  fireEvent.change(screen.getByLabelText(FIELD_LABEL), { target: { value: text } });
}

beforeEach(() => {
  mocks.send.mockReset();
  mocks.recordClick.mockReset();
  nav.push.mockReset();
  auth.require.mockReset();
});

afterEach(cleanup);

describe("ContactCta", () => {
  it("contactar abre el composer en la barra y no navega a /mensajes", () => {
    renderCta();

    fireEvent.click(screen.getByRole("button", { name: COPY.detail.contactCta }));

    expect(screen.getByLabelText(FIELD_LABEL)).toBeTruthy();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("cuenta el clic como `chat` en cta_clicks al abrir el composer", () => {
    renderCta();

    fireEvent.click(screen.getByRole("button", { name: COPY.detail.contactCta }));

    expect(mocks.recordClick).toHaveBeenCalledWith({
      listingId: LISTING_ID,
      kind: "chat",
    });
  });

  it("enviar pasa por la server action y confirma en el lugar, con el hilo como opción", async () => {
    mocks.send.mockResolvedValue({ ok: true, conversationId: "conv-3" });
    renderCta();
    openAndType("¿Todavía está disponible?");

    fireEvent.click(screen.getByRole("button", { name: SEND }));

    expect(await screen.findByText("Mensaje enviado")).toBeTruthy();
    expect(mocks.send).toHaveBeenCalledWith({
      listingId: LISTING_ID,
      body: "¿Todavía está disponible?",
    });
    expect(screen.getByRole("link", { name: /Abrir el chat/ }).getAttribute("href")).toBe(
      "/mensajes/conv-3",
    );
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("si ya había conversación lo dice, en vez de festejar un alta que no pasó", async () => {
    mocks.send.mockResolvedValue({ ok: true, conversationId: "conv-3", reused: true });
    renderCta();
    openAndType("Otra consulta");

    fireEvent.click(screen.getByRole("button", { name: SEND }));

    expect(await screen.findByText("Lo sumamos al chat que ya tenían")).toBeTruthy();
    expect(screen.queryByText("Mensaje enviado")).toBeNull();
  });

  it("sin sesión pide entrar sobre el aviso y reanuda ahí mismo", () => {
    renderCta({ isLoggedIn: false });

    fireEvent.click(screen.getByRole("button", { name: COPY.detail.contactCta }));

    expect(nav.push).not.toHaveBeenCalled();
    const args = auth.require.mock.calls[0]?.[0] as { onAuthenticated: () => void };
    act(() => args.onAuthenticated());

    expect(screen.getByLabelText(FIELD_LABEL)).toBeTruthy();
  });

  it("aviso de fuente externa: no hay composer, se explica de dónde salió", () => {
    renderCta({ isExternal: true, externalName: "Radio Comunidad" });

    fireEvent.click(screen.getByRole("button", { name: COPY.detail.contactCta }));

    expect(screen.queryByLabelText(FIELD_LABEL)).toBeNull();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
  });
});

describe("ListingActions", () => {
  function renderActions(
    overrides: Partial<React.ComponentProps<typeof ListingActions>> = {},
  ) {
    return render(
      <ListingActions
        listingId={LISTING_ID}
        kind="business"
        tier="premium"
        subject="Panadería Doña Rosa"
        values={{ phone: "+13055550134" }}
        {...overrides}
      />,
    );
  }

  it("el chat de la fila abre el composer sin sacarte de los otros botones", () => {
    renderActions();

    fireEvent.click(screen.getByRole("button", { name: /Escribirle a Panadería Doña Rosa/i }));

    expect(screen.getByLabelText(FIELD_LABEL)).toBeTruthy();
    expect(nav.push).not.toHaveBeenCalled();
    // Los botones externos siguen ahí: el composer no se comió la fila.
    expect(screen.getByRole("link", { name: /Panadería Doña Rosa/ })).toBeTruthy();
  });

  it("un aviso gratuito no renderiza la fila", () => {
    const { container } = renderActions({ tier: "free" });
    expect(container.firstChild).toBeNull();
  });
});
