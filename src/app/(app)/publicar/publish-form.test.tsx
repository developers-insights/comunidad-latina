// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui";
import { COPY } from "@/components/listings";

/**
 * Preselect de /publicar por query param (?kind=, menú crear-post del feed —
 * §d). page.tsx valida el param y pasa `initialKind`; acá se testea SOLO lo
 * que ese prop cambia en el wizard: arranca en el paso 1 con el tipo ya
 * fijado (paso 0 salteado) y ofrece "Cambiar tipo" para volver al selector.
 * Sin el prop, todo se comporta IGUAL que antes del rediseño.
 */

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: unknown;
    children: React.ReactNode;
  }) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  }),
}));

// El submit real no aplica acá: solo se testea el arranque del wizard.
vi.mock("./actions", () => ({
  createListingDraft: vi.fn(),
  finalizeListing: vi.fn(),
}));

import { PublishForm } from "./publish-form";

const C = COPY.publish;

function mount(initialKind?: "property" | "business" | "professional" | "event" | "job") {
  return render(
    <ToastProvider>
      <PublishForm tenantId="tenant-1" initialKind={initialKind} />
    </ToastProvider>,
  );
}

afterEach(cleanup);

describe("PublishForm — sin preselect (uso de siempre)", () => {
  it("arranca en el selector de tipo (paso 0), sin 'Cambiar tipo'", () => {
    mount();
    expect(screen.getByText(C.steps.kind.title)).toBeTruthy();
    expect(screen.queryByText(C.steps.text.title)).toBeNull();
    expect(screen.queryByText("Cambiar tipo")).toBeNull();
  });

  it("ningún tipo queda preseleccionado", () => {
    mount();
    const radios = screen.getAllByRole("radio");
    expect(radios.some((radio) => radio.getAttribute("aria-checked") === "true")).toBe(false);
  });
});

describe("PublishForm — con preselect (?kind= del menú crear-post)", () => {
  it("arranca directo en el paso 1, con el selector salteado", () => {
    mount("business");
    expect(screen.getByText(C.steps.text.title)).toBeTruthy();
    expect(screen.queryByText(C.steps.kind.title)).toBeNull();
  });

  it('muestra un link discreto "Cambiar tipo"', () => {
    mount("property");
    expect(screen.getByText("Cambiar tipo")).toBeTruthy();
  });

  it('"Cambiar tipo" vuelve al selector, con el tipo preseleccionado resaltado', () => {
    mount("business");
    fireEvent.click(screen.getByText("Cambiar tipo"));

    expect(screen.getByText(C.steps.kind.title)).toBeTruthy();
    expect(screen.queryByText(C.steps.text.title)).toBeNull();
    const businessOption = screen.getByRole("radio", { name: /Negocio/ });
    expect(businessOption.getAttribute("aria-checked")).toBe("true");
  });

  it("cada kind válido preselecciona su propio paso 1 (sin volver al selector)", () => {
    for (const kind of ["property", "business", "professional", "event", "job"] as const) {
      const { unmount } = mount(kind);
      expect(screen.getByText(C.steps.text.title)).toBeTruthy();
      expect(screen.queryByText(C.steps.kind.title)).toBeNull();
      unmount();
    }
  });
});
