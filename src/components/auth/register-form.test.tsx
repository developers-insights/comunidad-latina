// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PASSWORD_COPY } from "@/lib/auth/password-policy";

const mocks = vi.hoisted(() => ({ registerAction: vi.fn() }));

vi.mock("@/app/(auth)/actions", () => ({ registerAction: mocks.registerAction }));

import { RegisterForm } from "./register-form";

beforeEach(() => {
  mocks.registerAction.mockReset();
  mocks.registerAction.mockResolvedValue({ ok: true });
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
