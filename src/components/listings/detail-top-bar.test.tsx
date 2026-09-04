// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * La barra del detalle de un aviso es la MISMA barra que la de las portadas y
 * los formularios: desde el 2026-09-04 se construye sobre `SectionTopBar` para
 * que "Volver" esté siempre en el mismo lugar, con la misma palabra y con la
 * misma red de seguridad.
 *
 * Lo que se prueba acá es justamente eso —la unificación—, no las acciones de
 * guardar/compartir, que ya tienen su camino: que el control diga "Volver", y
 * que un aviso abierto desde un link compartido (sin historial de la app
 * detrás) NO tire a la persona fuera de la app sino a la portada del vertical.
 */

const nav = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn(), pathname: "/propiedades/abc" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: nav.back, push: nav.push }),
  usePathname: () => nav.pathname,
}));

vi.mock("@/app/(app)/feed/engagement-actions", () => ({
  recordListingViewAction: vi.fn(async () => ({ ok: true })),
  recordListingShareAction: vi.fn(async () => ({ ok: true })),
  toggleSaveAction: vi.fn(async () => ({ ok: true, saved: true })),
}));

vi.mock("@/components/ui", () => ({
  BottomSheet: () => null,
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/trust", () => ({
  ReportScamButton: () => null,
  ReportSheet: () => null,
}));

import { DetailTopBar } from "./detail-top-bar";

beforeEach(() => {
  nav.back.mockClear();
  nav.push.mockClear();
  nav.pathname = "/propiedades/abc";
  window.history.replaceState(null, "", "/propiedades/abc");
});

afterEach(cleanup);

describe("DetailTopBar sobre SectionTopBar", () => {
  it('el control de salida es el "Volver" compartido', () => {
    render(<DetailTopBar title="Depto en Queens" listingId="abc" />);
    expect(screen.getByRole("button", { name: "Volver" })).toBeDefined();
  });

  it("sin historial de la app (link compartido) vuelve a la portada del vertical", () => {
    render(<DetailTopBar title="Depto en Queens" listingId="abc" />);

    fireEvent.click(screen.getByRole("button", { name: "Volver" }));

    expect(nav.push).toHaveBeenCalledWith("/propiedades");
    expect(nav.back).not.toHaveBeenCalled();
  });

  it("una subpantalla del aviso vuelve al aviso, no al vertical", () => {
    nav.pathname = "/negocios/abc/editar";
    render(<DetailTopBar title="Editar" listingId="abc" />);

    fireEvent.click(screen.getByRole("button", { name: "Volver" }));

    expect(nav.push).toHaveBeenCalledWith("/negocios/abc");
  });
});
