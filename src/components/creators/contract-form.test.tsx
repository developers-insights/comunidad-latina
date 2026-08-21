// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * CONTRATAR SIN SALIR DEL PERFIL (cliente 2026-08-20: "mientras menos pasos
 * mejor").
 *
 * Dos cosas distintas se fijan acá, y conviene no confundirlas:
 *
 *  1. SIN CUENTA, la puerta se pide ANTES de abrir el formulario. Es a propósito
 *     y va contra el patrón del resto de la app: son cuatro campos, y los
 *     caminos de entrada que se van del navegador (Google, enlace mágico)
 *     vuelven en otra carga, sin árbol de React — o sea, sin lo escrito.
 *  2. CON LA SESIÓN VENCIDA a mitad de camino, la puerta se apila SOBRE la
 *     propuesta ya escrita y el envío se reintenta solo. Antes esto era un
 *     `router.push` a /entrar y el contrato a medio escribir se perdía entero.
 */

const state = vi.hoisted(() => ({
  result: { ok: true, contractId: "c-9" } as
    | { ok: true; contractId: string }
    | { ok: false; needsAuth?: boolean; error: string },
  propose: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/app/(app)/creadores/actions", () => ({
  proposeContract: (input: unknown) => {
    state.propose(input);
    return Promise.resolve(state.result);
  },
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
import { ContractForm } from "./contract-form";
import { COPY } from "./copy";

const C = COPY.contract;

function montar(isAuthenticated: boolean) {
  return render(
    <AuthSheetProvider>
      <ContractForm
        creatorId="creador-1"
        creatorName="Lucía"
        triggerLabel="Contratar este paquete"
        isAuthenticated={isAuthenticated}
      />
    </AuthSheetProvider>,
  );
}

/** Deja la propuesta lista para enviar (mínimos que valida el cliente). */
function completar() {
  fireEvent.change(screen.getByLabelText(new RegExp(C.titleLabel)), {
    target: { value: "Tres reels para el restaurante" },
  });
  fireEvent.change(screen.getByLabelText(new RegExp(C.scopeLabel)), {
    target: { value: "Tres videos verticales de 30 segundos, editados." },
  });
  fireEvent.change(screen.getByLabelText(C.amountLabel, { exact: false }), {
    target: { value: "800" },
  });
}

describe("ContractForm — la puerta no saca del perfil", () => {
  beforeEach(() => {
    state.result = { ok: true, contractId: "c-9" };
    state.propose.mockClear();
    state.push.mockClear();
  });
  afterEach(cleanup);

  it("sin cuenta pide entrar ANTES de hacer escribir nada, y no navega", async () => {
    montar(false);
    fireEvent.click(screen.getByRole("button", { name: /Contratar este paquete/ }));

    expect(await screen.findByText(AUTH_REASON.contract)).toBeTruthy();
    expect(state.push).not.toHaveBeenCalled();
    // La propuesta todavía no se abrió: nadie escribe cuatro campos para
    // descubrir al final que le falta la cuenta.
    expect(screen.queryByText(C.proposeIntro)).toBeNull();
  });

  it("al entrar, la propuesta se abre sola con el paquete ya cargado", async () => {
    montar(false);
    fireEvent.click(screen.getByRole("button", { name: /Contratar este paquete/ }));
    fireEvent.click(await screen.findByText("stub-entrar"));

    expect(await screen.findByText(C.proposeIntro)).toBeTruthy();
  });

  it("cerrar sin entrar no deja la propuesta abriéndose sola en la próxima sesión", async () => {
    montar(false);
    fireEvent.click(screen.getByRole("button", { name: /Contratar este paquete/ }));
    // Se arrepiente: cierra con Escape, que es la salida de teclado de la hoja.
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText(AUTH_REASON.contract)).toBeNull());
    expect(screen.queryByText(C.proposeIntro)).toBeNull();
  });

  it("si la sesión se vence con el formulario lleno, no expulsa: pide la puerta y reintenta", async () => {
    state.result = { ok: false, needsAuth: true, error: "Necesitás entrar." };
    montar(true);
    fireEvent.click(screen.getByRole("button", { name: /Contratar este paquete/ }));
    completar();
    fireEvent.click(screen.getByRole("button", { name: C.create }));

    expect(await screen.findByText(AUTH_REASON.contract)).toBeTruthy();
    expect(state.push).not.toHaveBeenCalled();
    // Lo escrito sigue ahí: la propuesta no se desmontó.
    expect(
      (screen.getByLabelText(new RegExp(C.titleLabel)) as HTMLInputElement).value,
    ).toBe("Tres reels para el restaurante");

    state.result = { ok: true, contractId: "c-9" };
    fireEvent.click(await screen.findByText("stub-entrar"));

    await waitFor(() => expect(state.propose).toHaveBeenCalledTimes(2));
    // El reintento manda EXACTAMENTE lo mismo: nada que volver a tipear.
    expect(state.propose.mock.calls[1]![0]).toEqual(state.propose.mock.calls[0]![0]);
    await waitFor(() =>
      expect(state.push).toHaveBeenCalledWith("/creadores/colaboraciones/c-9"),
    );
  });
});
