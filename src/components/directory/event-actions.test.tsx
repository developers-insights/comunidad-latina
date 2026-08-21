// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * ANOTARSE A UN EVENTO SIN PERDER EL EVENTO (cliente 2026-08-20: "mientras
 * menos pasos mejor").
 *
 * Sin sesión, "Quiero ir" era un enlace a /entrar: la persona perdía la fecha,
 * el lugar y el mapa que estaba leyendo, y volvía —si volvía— para tocar de
 * nuevo el mismo botón. Lo que se fija acá es que el CTA es UNO SOLO para todos,
 * que no navega, y que al entrar la anotación se aplica sola.
 */

const state = vi.hoisted(() => ({
  result: { ok: true, interested: true } as
    | { ok: true; interested: boolean }
    | { ok: false; needsAuth?: boolean; error?: string },
  toggleInterest: vi.fn(),
  toast: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/app/(app)/eventos/actions", () => ({
  toggleEventInterestAction: (eventId: string) => {
    state.toggleInterest(eventId);
    return Promise.resolve(state.result);
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push, refresh: state.refresh, replace: vi.fn() }),
  usePathname: () => "/eventos/evento-1",
}));

vi.mock("@/components/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui")>();
  return { ...actual, useToast: () => ({ toast: state.toast }) };
});

vi.mock("@/components/auth/auth-sheet-panel", () => ({
  AuthSheetPanel: ({ onAuthenticated }: { onAuthenticated: () => void }) => (
    <button type="button" onClick={onAuthenticated}>
      stub-entrar
    </button>
  ),
}));

import { AUTH_REASON, AuthSheetProvider } from "@/components/auth/auth-sheet";
import { EventActions } from "./event-actions";
import { COPY } from "./copy";

const C = COPY.events.detail;

function montar(isLoggedIn: boolean) {
  return render(
    <AuthSheetProvider>
      <EventActions
        eventId="evento-1"
        eventTitle="Peña del sábado"
        isLoggedIn={isLoggedIn}
        initialInterested={false}
        initialCount={4}
      />
    </AuthSheetProvider>,
  );
}

describe("EventActions — anotarse sin sesión", () => {
  beforeEach(() => {
    state.result = { ok: true, interested: true };
    state.toggleInterest.mockClear();
    state.toast.mockClear();
    state.push.mockClear();
  });
  afterEach(cleanup);

  it("el CTA es el mismo con o sin cuenta: ya no hay un enlace a /entrar", () => {
    montar(false);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("button", { name: new RegExp(C.goingCta) })).toBeTruthy();
  });

  it("tocar 'Quiero ir' sin sesión abre la puerta acá mismo y no gasta un viaje al server", async () => {
    montar(false);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(C.goingCta) }));

    expect(await screen.findByText(AUTH_REASON.interest)).toBeTruthy();
    expect(state.push).not.toHaveBeenCalled();
    // Sabemos de antemano que no hay sesión: pedirle al server que lo confirme
    // es un viaje que alguien paga con datos móviles.
    expect(state.toggleInterest).not.toHaveBeenCalled();
  });

  it("al entrar queda anotada sola, con el contador movido", async () => {
    montar(false);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(C.goingCta) }));
    fireEvent.click(await screen.findByText("stub-entrar"));

    await waitFor(() => expect(state.toggleInterest).toHaveBeenCalledWith("evento-1"));
    expect(await screen.findByText(new RegExp(C.goingActive))).toBeTruthy();
    expect(screen.getByText(C.interestedCount(5))).toBeTruthy();
    expect(state.push).not.toHaveBeenCalled();
  });

  it("con sesión vencida el server pide la puerta y el reintento se aplica solo", async () => {
    // La sesión existía al pintar la página y se venció mientras leía el evento:
    // el reintento entra DIRECTO por el camino con sesión, sin volver a pasar
    // por el guard de anónimo (que reabriría la hoja en bucle).
    state.result = { ok: false, needsAuth: true, error: "Para anotarte necesitás entrar." };
    montar(true);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(C.goingCta) }));

    expect(await screen.findByText(AUTH_REASON.interest)).toBeTruthy();
    expect(state.push).not.toHaveBeenCalled();

    state.result = { ok: true, interested: true };
    fireEvent.click(await screen.findByText("stub-entrar"));

    expect(await screen.findByText(new RegExp(C.goingActive))).toBeTruthy();
    expect(state.toggleInterest).toHaveBeenCalledTimes(2);
  });
});
