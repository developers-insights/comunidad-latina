/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui";

vi.mock("./actions", () => ({
  sendPhoneCodeAction: vi.fn(),
  verifyPhoneCodeAction: vi.fn(),
  removePhoneAction: vi.fn(),
}));

import { PhoneVerification } from "./phone-verification";

afterEach(cleanup);

function renderPaso1() {
  render(
    <ToastProvider>
      <PhoneVerification verifiedPhone={null} ttlMinutes={10} />
    </ToastProvider>,
  );
}

describe("PhoneVerification — consentimiento de SMS", () => {
  it("el botón de enviar código queda descrito por el aviso de consentimiento", () => {
    renderPaso1();

    const boton = screen.getByRole("button", { name: /código/i });
    const avisoId = boton.getAttribute("aria-describedby")?.split(" ").find((id) => id === "sms-consent");
    const aviso = avisoId ? document.getElementById(avisoId) : null;

    expect(aviso?.textContent).toMatch(/SMS con tu código de verificación/);
    expect(aviso?.textContent).toMatch(/tarifas de mensajes y datos/);
    expect(aviso?.textContent).toMatch(/STOP/);
    expect(aviso?.textContent).toMatch(/HELP/);
  });

  it("enlaza la Política de SMS", () => {
    renderPaso1();

    expect(screen.getByRole("link", { name: /Política de SMS/i }).getAttribute("href")).toBe(
      "/legal/sms",
    );
  });

  it("aclara que verificar el teléfono es opcional", () => {
    renderPaso1();

    expect(document.body.textContent).toMatch(/opcional/i);
  });
});
