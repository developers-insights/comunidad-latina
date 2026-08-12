// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/toast";

/**
 * `TagPolicyRow` — la fila "Quién puede etiquetarte" de Ajustes › Privacidad.
 *
 * Cubre lo que pide el spec explícitamente: guarda sola (sin botón), el
 * control VUELVE a la opción anterior si el guardado falla y lo avisa con un
 * toast visible (nunca queda un interruptor mintiendo), y la semántica de
 * radiogroup para teclado/lector de pantalla.
 */

const mocks = vi.hoisted(() => ({
  saveTagPolicyAction: vi.fn(),
}));

vi.mock("./tag-policy-actions", () => ({ saveTagPolicyAction: mocks.saveTagPolicyAction }));

import { TagPolicyRow } from "./tag-policy-row";

function renderRow(initial: "everyone" | "following" | "nobody" = "everyone") {
  return render(
    <ToastProvider>
      <TagPolicyRow initialPolicy={initial} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe("estado inicial", () => {
  it("marca la opción actual y arma un radiogroup con las tres", () => {
    renderRow("following");

    const group = screen.getByRole("radiogroup", { name: "Quién puede etiquetarte" });
    expect(group).toBeTruthy();

    const options = screen.getAllByRole("radio");
    expect(options).toHaveLength(3);

    const active = screen.getByRole("radio", { name: /Sólo a quienes seguís/ });
    expect(active.getAttribute("aria-checked")).toBe("true");

    const inactive = screen.getByRole("radio", { name: /Cualquiera de tu comunidad/ });
    expect(inactive.getAttribute("aria-checked")).toBe("false");
  });

  it("dice que las etiquetas ya puestas no se borran solas", () => {
    renderRow();
    expect(screen.getByText(/no se borran solas/)).toBeTruthy();
  });
});

describe("guardar", () => {
  it("tocar una opción la marca de una y llama a la action con el valor nuevo", async () => {
    mocks.saveTagPolicyAction.mockResolvedValue({ ok: true });
    renderRow("everyone");

    fireEvent.click(screen.getByRole("radio", { name: /Nadie/ }));

    expect(screen.getByRole("radio", { name: /Nadie/ }).getAttribute("aria-checked")).toBe(
      "true",
    );
    await waitFor(() => expect(mocks.saveTagPolicyAction).toHaveBeenCalledWith("nobody"));
  });

  it("tocar la opción que ya está activa no dispara guardado", () => {
    mocks.saveTagPolicyAction.mockResolvedValue({ ok: true });
    renderRow("everyone");

    fireEvent.click(screen.getByRole("radio", { name: /Cualquiera de tu comunidad/ }));

    expect(mocks.saveTagPolicyAction).not.toHaveBeenCalled();
  });

  it("guardado exitoso muestra el acuse 'Guardado'", async () => {
    mocks.saveTagPolicyAction.mockResolvedValue({ ok: true });
    renderRow("everyone");

    fireEvent.click(screen.getByRole("radio", { name: /Sólo a quienes seguís/ }));

    await waitFor(() => expect(screen.getByText("Guardado")).toBeTruthy());
  });

  it("si falla, VUELVE a la opción anterior y avisa con un toast visible", async () => {
    mocks.saveTagPolicyAction.mockResolvedValue({ ok: false, code: "error" });
    renderRow("everyone");

    fireEvent.click(screen.getByRole("radio", { name: /Nadie/ }));

    await waitFor(() => {
      expect(screen.getByText(/No pudimos guardar tu elección/)).toBeTruthy();
    });
    expect(screen.getByRole("radio", { name: /Cualquiera de tu comunidad/ }).getAttribute(
      "aria-checked",
    )).toBe("true");
    expect(screen.getByRole("radio", { name: /Nadie/ }).getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("si la action rechaza (red caída), también vuelve atrás y avisa", async () => {
    mocks.saveTagPolicyAction.mockRejectedValue(new Error("network"));
    renderRow("everyone");

    fireEvent.click(screen.getByRole("radio", { name: /Nadie/ }));

    await waitFor(() => {
      expect(screen.getByText(/No pudimos guardar tu elección/)).toBeTruthy();
    });
    expect(screen.getByRole("radio", { name: /Cualquiera de tu comunidad/ }).getAttribute(
      "aria-checked",
    )).toBe("true");
  });
});
