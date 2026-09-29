// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PASSWORD_COPY } from "@/lib/auth/password-policy";
import { USERNAME_CHECK_DEBOUNCE_MS } from "./use-username-availability";

const mocks = vi.hoisted(() => ({
  registerAction: vi.fn(),
  checkUsernameAvailabilityAction: vi.fn(),
}));

vi.mock("@/app/(auth)/actions", () => ({ registerAction: mocks.registerAction }));
// Sin este mock, el chequeo en vivo dispararía la server action REAL (headers(),
// Supabase admin) en cada test que toca el campo de usuario — incluidos los que
// no tienen nada que ver con la disponibilidad del handle.
vi.mock("@/app/(auth)/username-actions", () => ({
  checkUsernameAvailabilityAction: mocks.checkUsernameAvailabilityAction,
}));

import { RegisterForm } from "./register-form";

beforeEach(() => {
  mocks.registerAction.mockReset();
  mocks.registerAction.mockResolvedValue({ ok: true });
  mocks.checkUsernameAvailabilityAction.mockReset();
  mocks.checkUsernameAvailabilityAction.mockResolvedValue({ status: "unknown" });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

function fillValid(overrides: { password?: string; confirm?: string } = {}) {
  const set = (id: string, value: string) =>
    fireEvent.change(document.getElementById(id) as HTMLInputElement, { target: { value } });
  set("register-name", "Rosa");
  set("register-lastname", "Martínez");
  set("register-email", "rosa@ejemplo.com");
  set("register-password", overrides.password ?? "Casa2026");
  set("register-password-confirm", overrides.confirm ?? "Casa2026");
  fireEvent.click(document.getElementById("register-age") as HTMLInputElement);
  fireEvent.click(document.getElementById("register-terms") as HTMLInputElement);
}

const submit = () => fireEvent.click(screen.getByRole("button", { name: "Crear mi cuenta" }));

describe("RegisterForm — contraseña", () => {
  it("no llama al servidor si las contraseñas no coinciden, y enfoca la confirmación", () => {
    render(<RegisterForm onSuccess={vi.fn()} />);
    fillValid({ confirm: "Casa2027" });
    submit();

    expect(mocks.registerAction).not.toHaveBeenCalled();
    expect(screen.getByText(PASSWORD_COPY.mismatch)).toBeTruthy();
    expect(document.activeElement?.id).toBe("register-password-confirm");
  });

  it("no llama al servidor si la contraseña no cumple la política", () => {
    render(<RegisterForm onSuccess={vi.fn()} />);
    fillValid({ password: "casa2026", confirm: "casa2026" });
    submit();

    expect(mocks.registerAction).not.toHaveBeenCalled();
    expect(screen.getByText(PASSWORD_COPY.uppercase)).toBeTruthy();
    expect(document.activeElement?.id).toBe("register-password");
  });

  it("manda password y passwordConfirm al servidor", async () => {
    const onSuccess = vi.fn();
    render(<RegisterForm onSuccess={onSuccess} />);
    fillValid();
    submit();

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("rosa@ejemplo.com"));
    expect(mocks.registerAction).toHaveBeenCalledWith(
      expect.objectContaining({ password: "Casa2026", passwordConfirm: "Casa2026" }),
    );
  });

  it("muestra el error de confirmación que devuelve el servidor", async () => {
    mocks.registerAction.mockResolvedValue({
      ok: false,
      fieldErrors: { passwordConfirm: PASSWORD_COPY.mismatch },
    });
    render(<RegisterForm onSuccess={vi.fn()} />);
    fillValid();
    submit();

    await waitFor(() => expect(screen.getByText(PASSWORD_COPY.mismatch)).toBeTruthy());
  });
});

describe("RegisterForm — disponibilidad del username en vivo", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  const usernameField = () => document.getElementById("register-username") as HTMLInputElement;
  const setUsername = (value: string) => fireEvent.change(usernameField(), { target: { value } });

  async function settle(ms = USERNAME_CHECK_DEBOUNCE_MS + 10) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("un formato inválido se resuelve local, sin llamar al server", async () => {
    render(<RegisterForm onSuccess={vi.fn()} />);
    setUsername("rosa martinez");
    await settle();

    expect(mocks.checkUsernameAvailabilityAction).not.toHaveBeenCalled();
    expect(screen.getByText("Solo letras sin acento, números, punto y guion bajo.")).toBeTruthy();
  });

  it("espera el debounce y consulta UNA vez con el valor final", async () => {
    mocks.checkUsernameAvailabilityAction.mockResolvedValue({ status: "available" });
    render(<RegisterForm onSuccess={vi.fn()} />);

    setUsername("ro");
    await settle(100);
    setUsername("rosa");
    await settle(100);
    setUsername("rosa.m");
    await settle();

    expect(mocks.checkUsernameAvailabilityAction).toHaveBeenCalledTimes(1);
    expect(mocks.checkUsernameAvailabilityAction).toHaveBeenCalledWith("rosa.m");
    expect(screen.getByText("Disponible")).toBeTruthy();
  });

  it("tomado: muestra el mismo mensaje que el error del servidor al enviar", async () => {
    mocks.checkUsernameAvailabilityAction.mockResolvedValue({
      status: "taken",
      message: "Ese nombre de usuario ya está en uso en esta comunidad. Probá con otro.",
    });
    render(<RegisterForm onSuccess={vi.fn()} />);

    setUsername("rosa.martinez");
    await settle();

    expect(
      screen.getByText("Ese nombre de usuario ya está en uso en esta comunidad. Probá con otro."),
    ).toBeTruthy();
  });

  it("una respuesta vieja que llega tarde no pisa el resultado del valor actual", async () => {
    let resolveFirst!: (value: { status: "taken"; message: string }) => void;
    mocks.checkUsernameAvailabilityAction.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );

    render(<RegisterForm onSuccess={vi.fn()} />);

    setUsername("rosa");
    await settle();
    expect(mocks.checkUsernameAvailabilityAction).toHaveBeenCalledTimes(1);

    // Se sigue escribiendo antes de que la primera respuesta llegue.
    mocks.checkUsernameAvailabilityAction.mockResolvedValueOnce({ status: "available" });
    setUsername("rosa.martinez");
    await settle();

    // La respuesta vieja ("rosa" → tomado) llega recién ahora: no puede pisar
    // el resultado de "rosa.martinez" ("available"), que es el valor vigente.
    await act(async () => {
      resolveFirst({ status: "taken", message: "Ese nombre de usuario ya está en uso en esta comunidad. Probá con otro." });
    });

    expect(screen.getByText("Disponible")).toBeTruthy();
  });

  it("apenas el handle deja de coincidir con uno tomado, el error desaparece", async () => {
    mocks.checkUsernameAvailabilityAction.mockResolvedValue({
      status: "taken",
      message: "Ese nombre de usuario ya está en uso en esta comunidad. Probá con otro.",
    });
    render(<RegisterForm onSuccess={vi.fn()} />);

    setUsername("rosa");
    await settle();
    expect(
      screen.getByText("Ese nombre de usuario ya está en uso en esta comunidad. Probá con otro."),
    ).toBeTruthy();

    mocks.checkUsernameAvailabilityAction.mockResolvedValue({ status: "available" });
    setUsername("rosa2");
    await settle();

    expect(
      screen.queryByText("Ese nombre de usuario ya está en uso en esta comunidad. Probá con otro."),
    ).toBeNull();
    expect(screen.getByText("Disponible")).toBeTruthy();
  });

  it("no bloquea el botón de enviar cuando el chequeo queda en 'unknown'", async () => {
    mocks.checkUsernameAvailabilityAction.mockResolvedValue({ status: "unknown" });
    render(<RegisterForm onSuccess={vi.fn()} />);

    setUsername("rosa.martinez");
    await settle();

    const boton = screen.getByRole("button", { name: "Crear mi cuenta" }) as HTMLButtonElement;
    // El botón sólo se deshabilita por el consentimiento (edad + términos),
    // nunca por el resultado del chequeo en vivo.
    fireEvent.click(document.getElementById("register-age") as HTMLInputElement);
    fireEvent.click(document.getElementById("register-terms") as HTMLInputElement);
    expect(boton.disabled).toBe(false);
  });
});
