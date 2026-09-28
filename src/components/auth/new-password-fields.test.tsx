// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PASSWORD_COPY } from "@/lib/auth/password-policy";
import {
  NEW_PASSWORD_COPY,
  NewPasswordFields,
  validateNewPassword,
} from "./new-password-fields";

afterEach(cleanup);

function Harness({ passwordError }: { passwordError?: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  return (
    <NewPasswordFields
      idPrefix="t"
      password={password}
      confirm={confirm}
      onPasswordChange={setPassword}
      onConfirmChange={setConfirm}
      passwordError={passwordError}
    />
  );
}

const passwordInput = () => document.getElementById("t-password") as HTMLInputElement;
const confirmInput = () => document.getElementById("t-password-confirm") as HTMLInputElement;
const ruleStatus = (label: string) => screen.getByText(new RegExp(`^${label}: `)).textContent;

describe("NewPasswordFields — checklist", () => {
  it("cada regla pasa de pendiente a lista a medida que se escribe", () => {
    render(<Harness />);

    expect(ruleStatus("Al menos 8 caracteres")).toContain(NEW_PASSWORD_COPY.rulePending);
    expect(ruleStatus("Una letra mayúscula")).toContain(NEW_PASSWORD_COPY.rulePending);
    expect(ruleStatus("Un número")).toContain(NEW_PASSWORD_COPY.rulePending);

    fireEvent.change(passwordInput(), { target: { value: "Casa" } });
    expect(ruleStatus("Una letra mayúscula")).toContain(NEW_PASSWORD_COPY.ruleMet);
    expect(ruleStatus("Al menos 8 caracteres")).toContain(NEW_PASSWORD_COPY.rulePending);

    fireEvent.change(passwordInput(), { target: { value: "Casa2026" } });
    expect(ruleStatus("Al menos 8 caracteres")).toContain(NEW_PASSWORD_COPY.ruleMet);
    expect(ruleStatus("Un número")).toContain(NEW_PASSWORD_COPY.ruleMet);
  });

  it("no marca error mientras se escribe: recién al salir del campo", () => {
    render(<Harness />);

    fireEvent.change(passwordInput(), { target: { value: "casa" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(passwordInput().getAttribute("aria-invalid")).toBeNull();

    fireEvent.blur(passwordInput());
    expect(screen.getByRole("alert").textContent).toContain(PASSWORD_COPY.short);
    expect(passwordInput().getAttribute("aria-invalid")).toBe("true");

    fireEvent.change(passwordInput(), { target: { value: "casas" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("el error que llega del submit se muestra aunque no haya blur", () => {
    render(<Harness passwordError={PASSWORD_COPY.uppercase} />);
    expect(screen.getByRole("alert").textContent).toContain(PASSWORD_COPY.uppercase);
  });

  it("describe el campo con el checklist para lectores de pantalla", () => {
    render(<Harness />);
    expect(passwordInput().getAttribute("aria-describedby")).toBe("t-password-rules");
  });
});

describe("NewPasswordFields — confirmación", () => {
  it("sin contenido no muestra ningún indicador", () => {
    render(<Harness />);
    expect(screen.queryByText(NEW_PASSWORD_COPY.match)).toBeNull();
    expect(screen.queryByText(NEW_PASSWORD_COPY.noMatchYet)).toBeNull();
  });

  it("mientras no coinciden avisa en neutro, y el error recién sale al salir del campo", () => {
    render(<Harness />);
    fireEvent.change(passwordInput(), { target: { value: "Casa2026" } });
    fireEvent.change(confirmInput(), { target: { value: "Casa20" } });

    expect(screen.getByText(NEW_PASSWORD_COPY.noMatchYet)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.blur(confirmInput());
    expect(screen.getByRole("alert").textContent).toContain(PASSWORD_COPY.mismatch);
    expect(confirmInput().getAttribute("aria-invalid")).toBe("true");
  });

  it("cuando coinciden lo confirma", () => {
    render(<Harness />);
    fireEvent.change(passwordInput(), { target: { value: "Casa2026" } });
    fireEvent.change(confirmInput(), { target: { value: "Casa2026" } });

    expect(screen.getByText(NEW_PASSWORD_COPY.match)).toBeTruthy();
    fireEvent.blur(confirmInput());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("cada campo tiene su propio botón de mostrar/ocultar", () => {
    render(<Harness />);
    const toggles = screen.getAllByRole("button", { pressed: false });
    expect(toggles).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(passwordInput().type).toBe("text");
    expect(confirmInput().type).toBe("password");
  });
});

describe("validateNewPassword", () => {
  it("devuelve el primer problema de la política", () => {
    expect(validateNewPassword("casa2026", "casa2026")).toEqual({
      password: PASSWORD_COPY.uppercase,
    });
  });

  it("pide la confirmación cuando falta", () => {
    expect(validateNewPassword("Casa2026", "")).toEqual({
      passwordConfirm: PASSWORD_COPY.confirmRequired,
    });
  });

  it("marca que no coinciden", () => {
    expect(validateNewPassword("Casa2026", "Casa2027")).toEqual({
      passwordConfirm: PASSWORD_COPY.mismatch,
    });
  });

  it("todo bien → sin errores", () => {
    expect(validateNewPassword("Casa2026", "Casa2026")).toEqual({});
  });
});
