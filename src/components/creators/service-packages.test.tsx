// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * PAQUETES: UN SOLO BOTÓN PARA TODOS (cliente 2026-08-20: "mientras menos pasos
 * mejor").
 *
 * Acá había dos CTA distintos según hubiera sesión o no. El de quien no tenía
 * cuenta era un `<Link href="/entrar?next=…">`: sacaba a la persona del perfil,
 * la dejaba en otra pantalla y —si volvía— la devolvía al tope de la página, sin
 * el paquete que había elegido. Lo que se fija es que ese enlace ya no existe y
 * que el botón es el mismo que ve todo el mundo.
 */

const state = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("@/app/(app)/creadores/actions", () => ({
  proposeContract: vi.fn(async () => ({ ok: true, contractId: "c-1" })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push, refresh: state.refresh, replace: vi.fn() }),
  usePathname: () => "/creadores/perfil/creador-1",
}));

vi.mock("@/components/auth/auth-sheet-panel", () => ({
  AuthSheetPanel: ({ onAuthenticated }: { onAuthenticated: () => void }) => (
    <button type="button" onClick={onAuthenticated}>
      stub-entrar
    </button>
  ),
}));

import { AUTH_REASON, AuthSheetProvider } from "@/components/auth/auth-sheet";
import { ServicePackages } from "./service-packages";
import { COPY } from "./copy";

const PAQUETE = {
  id: "pkg-1",
  title: "Pack de tres reels",
  description: "Tres videos verticales para tus redes.",
  includes: ["Guion", "Edición"],
  priceCents: 120_000,
  currency: "USD",
  deliveryDays: 7,
  active: true,
  sortOrder: 0,
};

function montar(isAuthenticated: boolean) {
  return render(
    <AuthSheetProvider>
      <ServicePackages
        packages={[PAQUETE]}
        creatorId="creador-1"
        creatorName="Lucía"
        isAuthenticated={isAuthenticated}
      />
    </AuthSheetProvider>,
  );
}

describe("ServicePackages — contratar sin cuenta", () => {
  afterEach(() => {
    cleanup();
    state.push.mockClear();
  });

  it("ya no hay un enlace a /entrar: el CTA es el mismo con o sin cuenta", () => {
    montar(false);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("button", { name: new RegExp(COPY.packages.hireCta) })).toBeTruthy();
  });

  it("tocarlo sin cuenta abre la puerta acá mismo, sin cambiar de pantalla", async () => {
    montar(false);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(COPY.packages.hireCta) }));

    expect(await screen.findByText(AUTH_REASON.contract)).toBeTruthy();
    expect(state.push).not.toHaveBeenCalled();
  });

  it("al entrar, la propuesta se abre con el paquete ya cargado", async () => {
    montar(false);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(COPY.packages.hireCta) }));
    fireEvent.click(await screen.findByText("stub-entrar"));

    // El título del paquete llega prellenado: elegirlo de nuevo sería el paso
    // que vinimos a sacar.
    const titulo = (await screen.findByLabelText(
      new RegExp(COPY.contract.titleLabel),
    )) as HTMLInputElement;
    expect(titulo.value).toBe(PAQUETE.title);
  });
});
