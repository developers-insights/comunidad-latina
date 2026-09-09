/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HojaAgregar } from "./hoja-agregar";
import { ToastProvider } from "@/components/ui";

afterEach(cleanup);

describe("HojaAgregar", () => {
  it("muestra quién está en línea antes de invitar", () => {
    render(
      <ToastProvider>
        <HojaAgregar
        open
        onClose={vi.fn()}
        candidatos={[
          {
            id: "11111111-1111-4111-8111-111111111111",
            displayName: "Ana Pérez",
            avatarUrl: null,
            enLinea: true,
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            displayName: "Luis Ruiz",
            avatarUrl: null,
            enLinea: false,
          },
        ]}
        yaEnLlamada={[]}
        cupo={8}
        onInvitar={vi.fn(async () => ({ ok: true as const, sumados: 1 }))}
        />
      </ToastProvider>,
    );

    expect(screen.getByText("Ana Pérez").parentElement?.textContent).toContain("En línea");
    expect(screen.getByText("Luis Ruiz").parentElement?.textContent).not.toContain("En línea");
  });
});
