// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * SEGUIR SIN QUE TE SAQUEN DE LA PANTALLA (cliente 2026-08-20: "mientras menos
 * pasos mejor").
 *
 * Este botón era el peor caso de toda la app: sin sesión hacía
 * `router.push("/entrar")` PELADO, sin `next`. La persona tocaba "Seguir" en la
 * tarjeta de una tienda y volvía —si volvía— al feed, sin el listado, sin su
 * scroll y sin la entidad que quería seguir.
 *
 * Lo que se fija acá es el contrato nuevo: que NO se navega, que la puerta se
 * abre encima, que al entrar el seguimiento se aplica solo, y que cerrar sin
 * entrar no deja un seguimiento armado esperando la próxima sesión.
 */

const state = vi.hoisted(() => ({
  result: { ok: true, following: true } as
    | { ok: true; following: boolean }
    | { ok: false; needsAuth?: boolean; error: string },
  toggleFollow: vi.fn(),
  toast: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/app/(app)/social/actions", () => ({
  toggleFollowAction: (input: unknown) => {
    state.toggleFollow(input);
    return Promise.resolve(state.result);
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push, refresh: state.refresh, replace: vi.fn() }),
  usePathname: () => "/negocios",
}));

vi.mock("@/components/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui")>();
  return { ...actual, useToast: () => ({ toast: state.toast }) };
});

// El panel de la hoja trae los formularios de auth y sus server actions: acá
// sólo interesa cuándo se monta y qué pasa al avisar que hay sesión.
vi.mock("@/components/auth/auth-sheet-panel", () => ({
  AuthSheetPanel: ({
    onAuthenticated,
    onDismiss,
  }: {
    onAuthenticated: () => void;
    onDismiss: () => void;
  }) => (
    <>
      <button type="button" onClick={onAuthenticated}>
        stub-entrar
      </button>
      <button type="button" onClick={onDismiss}>
        stub-cerrar
      </button>
    </>
  ),
}));

import { AUTH_REASON, AuthSheetProvider, useRequireAuth } from "@/components/auth/auth-sheet";
import { FollowButton } from "./follow-button";

const seguir = () => screen.getByRole("button", { name: "Seguir" });
const siguiendo = () => screen.getByRole("button", { name: "Siguiendo" });

/** Cualquier otra acción de la pantalla que también pida entrar. */
function OtraIsla() {
  const requireAuth = useRequireAuth();
  return (
    <button type="button" onClick={() => requireAuth({ reason: AUTH_REASON.save })}>
      otra cosa
    </button>
  );
}

function montar() {
  return render(
    <AuthSheetProvider>
      <FollowButton targetKind="listing" targetId="tienda-1" initialFollowing={false} />
      <OtraIsla />
    </AuthSheetProvider>,
  );
}

describe("FollowButton — sin sesión", () => {
  beforeEach(() => {
    state.result = { ok: true, following: true };
    state.toggleFollow.mockClear();
    state.toast.mockClear();
    state.push.mockClear();
    state.refresh.mockClear();
  });
  afterEach(cleanup);

  it("no navega: pide la cuenta encima de la misma pantalla", async () => {
    state.result = { ok: false, needsAuth: true, error: "Para seguir necesitás entrar." };
    montar();
    fireEvent.click(seguir());

    expect(await screen.findByText(AUTH_REASON.follow)).toBeTruthy();
    // Lo que el cliente pidió: nadie se mueve de pantalla.
    expect(state.push).not.toHaveBeenCalled();
    // Y el botón no miente mientras tanto: todavía no sigue a nadie.
    expect(seguir().getAttribute("aria-pressed")).toBe("false");
  });

  it("sin toast: el título de la hoja ya dice para qué hay que entrar", async () => {
    state.result = { ok: false, needsAuth: true, error: "Para seguir necesitás entrar." };
    montar();
    fireEvent.click(seguir());

    await screen.findByText(AUTH_REASON.follow);
    expect(state.toast).not.toHaveBeenCalled();
  });

  it("al entrar, el seguimiento se aplica solo: la persona no vuelve a tocar nada", async () => {
    state.result = { ok: false, needsAuth: true, error: "Para seguir necesitás entrar." };
    montar();
    fireEvent.click(seguir());

    // Ya con sesión, el server acepta.
    state.result = { ok: true, following: true };
    fireEvent.click(await screen.findByText("stub-entrar"));

    await waitFor(() => expect(siguiendo().getAttribute("aria-pressed")).toBe("true"));
    expect(state.toggleFollow).toHaveBeenCalledTimes(2);
    expect(state.toggleFollow).toHaveBeenLastCalledWith({
      targetKind: "listing",
      targetId: "tienda-1",
    });
    expect(state.push).not.toHaveBeenCalled();
  });

  it("cerrar sin entrar no deja un seguimiento fantasma para la próxima sesión", async () => {
    /**
     * La trampa que ya mordió una vez en el feed: armar el deseo ANTES de abrir
     * la hoja lo deja cargado aunque la persona se arrepienta, y se dispara con
     * cualquier entrada posterior — un "siguiendo" que nadie pidió. Acá el deseo
     * se arma DENTRO de `onAuthenticated`, así que cerrar lo descarta.
     */
    state.result = { ok: false, needsAuth: true, error: "Para seguir necesitás entrar." };
    montar();
    fireEvent.click(seguir());
    fireEvent.click(await screen.findByText("stub-cerrar"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Entra más tarde por CUALQUIER otro motivo: el seguir abandonado no revive.
    fireEvent.click(screen.getByText("otra cosa"));
    fireEvent.click(await screen.findByText("stub-entrar"));

    await waitFor(() => expect(state.toggleFollow).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Seguir" })).toBeTruthy();
  });

  it("un error que no es de sesión sigue siendo un aviso, no una puerta", async () => {
    state.result = { ok: false, error: "Eso que querés seguir ya no está disponible." };
    montar();
    fireEvent.click(seguir());

    await waitFor(() =>
      expect(state.toast).toHaveBeenCalledWith({
        variant: "danger",
        title: "Eso que querés seguir ya no está disponible.",
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(seguir()).toBeTruthy();
  });
});
