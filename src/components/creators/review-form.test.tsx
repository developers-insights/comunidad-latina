// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * DEJAR UNA RESEÑA NO PUEDE COSTAR LA RESEÑA (cliente 2026-08-20: "mientras
 * menos pasos mejor").
 *
 * Acá no llega gente anónima —el formulario aparece sobre un contrato propio ya
 * liberado—, pero una sesión sí se vence mientras alguien escribe. Antes eso era
 * un `router.push("/entrar")` en el peor momento: el componente se desmontaba y
 * las estrellas y el texto se iban con él. Lo que se fija es que la puerta se
 * abre encima, que lo escrito sigue ahí y que el envío se reintenta solo.
 */

const state = vi.hoisted(() => ({
  result: { ok: true } as { ok: true } | { ok: false; needsAuth?: boolean; error: string },
  submit: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/app/(app)/creadores/actions", () => ({
  submitReview: (input: unknown) => {
    state.submit(input);
    return Promise.resolve(state.result);
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push, refresh: state.refresh, replace: vi.fn() }),
  usePathname: () => "/creadores/colaboraciones/c-1",
}));

vi.mock("@/components/auth/auth-sheet-panel", () => ({
  AuthSheetPanel: ({ onAuthenticated }: { onAuthenticated: () => void }) => (
    <button type="button" onClick={onAuthenticated}>
      stub-entrar
    </button>
  ),
}));

import { AUTH_REASON, AuthSheetProvider } from "@/components/auth/auth-sheet";
import { ReviewForm } from "./review-form";
import { COPY } from "./copy";

const R = COPY.reviews;

function montarYEscribir() {
  render(
    <AuthSheetProvider>
      <ReviewForm contractId="c-1" rateeName="Lucía" />
    </AuthSheetProvider>,
  );
  fireEvent.click(screen.getByRole("radio", { name: R.starLabel(5) }));
  fireEvent.change(screen.getByLabelText(new RegExp(R.bodyLabel)), {
    target: { value: "Entregó antes de tiempo." },
  });
  fireEvent.click(screen.getByRole("button", { name: R.submit }));
}

describe("ReviewForm — sesión vencida", () => {
  beforeEach(() => {
    state.result = { ok: true };
    state.submit.mockClear();
    state.push.mockClear();
    state.refresh.mockClear();
  });
  afterEach(cleanup);

  it("no expulsa: pide la puerta encima y deja la reseña donde estaba", async () => {
    state.result = { ok: false, needsAuth: true, error: "Necesitás entrar." };
    montarYEscribir();

    expect(await screen.findByText(AUTH_REASON.review)).toBeTruthy();
    expect(state.push).not.toHaveBeenCalled();
    expect(
      (screen.getByLabelText(new RegExp(R.bodyLabel)) as HTMLTextAreaElement).value,
    ).toBe("Entregó antes de tiempo.");
  });

  it("al entrar se manda sola, con las mismas estrellas y el mismo texto", async () => {
    state.result = { ok: false, needsAuth: true, error: "Necesitás entrar." };
    montarYEscribir();

    state.result = { ok: true };
    fireEvent.click(await screen.findByText("stub-entrar"));

    await waitFor(() => expect(state.submit).toHaveBeenCalledTimes(2));
    expect(state.submit).toHaveBeenLastCalledWith({
      contractId: "c-1",
      rating: 5,
      body: "Entregó antes de tiempo.",
    });
    await waitFor(() => expect(state.refresh).toHaveBeenCalled());
  });
});
