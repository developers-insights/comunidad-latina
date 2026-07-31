// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReportProductRow } from "./report-product-row";
import { MARKETPLACE_REPORT_REASONS } from "./report-reasons";

/**
 * Lo que se verifica: que el reporte del Marketplace use EL MISMO sheet y la
 * MISMA server action que el resto de la app (no un segundo sistema), y que
 * los motivos que ofrece sean los de la política de `/legal/marketplace`.
 */

/** Firma tipada, cuerpo vacío: lo que se verifica es CON QUÉ se la llama. */
const reportTargetAction =
  vi.fn<(input: Record<string, unknown>) => Promise<{ ok: true }>>();
reportTargetAction.mockResolvedValue({ ok: true });

vi.mock("@/app/(app)/reportes/actions", () => ({
  reportTargetAction: (input: Record<string, unknown>) => reportTargetAction(input),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));

const PRODUCT_ID = "019f39cf-1111-4111-8111-111111111111";

function openSheet() {
  render(<ReportProductRow productId={PRODUCT_ID} productTitle="Zapatillas talla 9" />);
  fireEvent.click(screen.getByRole("button", { name: /reportar este producto/i }));
}

describe("ReportProductRow", () => {
  afterEach(() => {
    cleanup();
    // `mockClear` y no `mockReset`: reset borraría también el valor de retorno
    // y el segundo test vería una promesa `undefined`.
    reportTargetAction.mockClear();
  });

  it("ofrece reportar y leer la política, juntos", () => {
    render(<ReportProductRow productId={PRODUCT_ID} productTitle="Zapatillas talla 9" />);
    expect(screen.getByRole("button", { name: /reportar este producto/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /qué no se puede vender/i }).getAttribute("href")).toBe(
      "/legal/marketplace",
    );
  });

  it("abre la hoja con los motivos del Marketplace, no los genéricos", () => {
    openSheet();
    for (const reason of MARKETPLACE_REPORT_REASONS) {
      expect(screen.getByRole("radio", { name: reason })).toBeTruthy();
    }
    // Y NO los genéricos, que no sirven para denunciar un producto.
    expect(screen.queryByRole("radio", { name: /me trató mal/i })).toBeNull();
  });

  it("envía por la MISMA server action unificada, con el motivo elegido", async () => {
    openSheet();
    fireEvent.click(screen.getByRole("radio", { name: "Artículo prohibido" }));
    fireEvent.click(screen.getByRole("button", { name: /enviar reporte/i }));

    await waitFor(() => expect(reportTargetAction).toHaveBeenCalledTimes(1));
    expect(reportTargetAction.mock.calls[0]![0]).toMatchObject({
      targetKind: "listing",
      targetId: PRODUCT_ID,
      reason: "Artículo prohibido",
    });
  });

  it("el primer motivo viene preseleccionado — reportar son 2 toques", () => {
    openSheet();
    const first = screen.getByRole("radio", { name: MARKETPLACE_REPORT_REASONS[0] });
    expect((first as HTMLInputElement).checked).toBe(true);
  });
});
