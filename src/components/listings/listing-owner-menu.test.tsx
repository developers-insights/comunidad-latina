// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  LISTING_MENU_COPY,
  ListingOwnerMenu,
  ListingOwnerMenuOverlay,
} from "./listing-owner-menu";
import { EDICION_COPY } from "@/lib/listings/edicion";

/**
 * EL GATE DE LA TARJETA.
 *
 * No es la seguridad —la autorización la deciden las server actions y la RLS—
 * pero sí es lo que decide si alguien ve un botón que promete algo. Lo que este
 * archivo ancla es justamente eso: sobre un aviso ajeno no se dibuja NADA (ni
 * un hueco), y las filas que se ofrecen son las que el estado de la fila admite.
 *
 * Si mañana alguien "simplifica" el gate a `viewerId != null`, acá se rompe.
 */

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
const toast = vi.hoisted(() => ({ toast: vi.fn() }));
const actions = vi.hoisted(() => ({ pausarAvisoAction: vi.fn(), eliminarAvisoAction: vi.fn() }));
const auth = vi.hoisted(() => ({ requireAuth: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: nav.refresh }),
  usePathname: () => "/marketplace",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("motion/react", async () => (await import("@/test/motion-mock")).motionMock());

vi.mock("@/components/ui", async () => {
  const real = await vi.importActual<typeof import("@/components/ui")>("@/components/ui");
  return { ...real, useToast: () => ({ toast: toast.toast }) };
});

vi.mock("@/app/(app)/publicaciones/eliminar-action", () => ({
  eliminarAvisoAction: actions.eliminarAvisoAction,
}));

vi.mock("@/components/auth/auth-sheet", () => ({
  AUTH_REASON: { report: "report" },
  useRequireAuth: () => auth.requireAuth,
}));

vi.mock("@/components/trust", async () => {
  const react = await import("react");
  return {
    ReportScamButton: ({ onReport }: { onReport: () => void }) =>
      react.createElement("button", { type: "button", onClick: onReport }, "Reportar"),
    ReportSheet: ({ open, targetKind, targetId }: { open: boolean; targetKind: string; targetId: string }) =>
      open ? react.createElement("div", { "data-testid": "report-sheet" }, `${targetKind}:${targetId}`) : null,
  };
});

vi.mock("@/app/(app)/publicaciones/editar-actions", () => ({
  pausarAvisoAction: actions.pausarAvisoAction,
  // La hoja de edición se monta perezosa dentro del menú: sus dos acciones se
  // doblan para que importar el módulo no arrastre el runtime del server.
  cargarAvisoParaEditar: vi.fn(),
  editarAvisoAction: vi.fn(),
}));

const BASE = {
  listingId: "44444444-4444-4444-8444-444444444444",
  kind: "product",
  title: "Bicicleta rodado 29",
};

beforeEach(() => {
  vi.clearAllMocks();
  actions.pausarAvisoAction.mockResolvedValue({ ok: true, status: "paused" });
});

afterEach(cleanup);

describe("sobre un aviso ajeno no hay menú", () => {
  it("sin `esMio` no se dibuja ni el botón", () => {
    render(<ListingOwnerMenu {...BASE} esMio={false} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("el overlay tampoco deja un contenedor vacío ocupando la esquina", () => {
    const { container } = render(<ListingOwnerMenuOverlay {...BASE} esMio={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("con `esMio` el botón existe y nombra el aviso — hay muchos ⋯ en una grilla", () => {
    render(<ListingOwnerMenu {...BASE} esMio />);
    expect(
      screen.getByRole("button", { name: `${EDICION_COPY.menu.abrir} · ${BASE.title}` }),
    ).toBeTruthy();
  });
});

describe("qué ofrece el menú según el estado", () => {
  function abrir(props: Partial<React.ComponentProps<typeof ListingOwnerMenu>> = {}) {
    render(<ListingOwnerMenu {...BASE} esMio {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Opciones/ }));
  }

  it("publicado: editar y pausar, nunca 'volver a publicar'", async () => {
    abrir({ status: "published" });
    await waitFor(() => screen.getByText(EDICION_COPY.menu.editar));
    expect(screen.getByText(EDICION_COPY.menu.pausar)).toBeTruthy();
    expect(screen.queryByText(EDICION_COPY.menu.reactivar)).toBeNull();
  });

  it("pausado: volver a publicar, nunca 'pausar' de nuevo", async () => {
    abrir({ status: "paused" });
    await waitFor(() => screen.getByText(EDICION_COPY.menu.reactivar));
    expect(screen.queryByText(EDICION_COPY.menu.pausar)).toBeNull();
  });

  it("pausado por denuncias: no se ofrece levantarlo", async () => {
    abrir({ status: "paused", pausadoPorReportes: true });
    await waitFor(() => screen.getByText(EDICION_COPY.menu.editar));
    expect(screen.queryByText(EDICION_COPY.menu.reactivar)).toBeNull();
    expect(screen.queryByText(EDICION_COPY.menu.pausar)).toBeNull();
  });

  it("un negocio va a su página de edición, no a la hoja", async () => {
    abrir({ kind: "business" });
    const link = await waitFor(() =>
      screen.getByText(EDICION_COPY.menu.editarNegocio).closest("a"),
    );
    expect(link?.getAttribute("href")).toBe(`/negocios/${BASE.listingId}/editar`);
    expect(screen.queryByText(EDICION_COPY.menu.editar)).toBeNull();
  });

  it("promocionar lleva al flujo de impulsar de ese aviso", async () => {
    abrir();
    const link = await waitFor(() => screen.getByText(LISTING_MENU_COPY.promocionar).closest("a"));
    expect(link?.getAttribute("href")).toBe(`/impulsar/${BASE.listingId}`);
  });

  it("abrir en otra pestaña es un enlace de verdad a la página del aviso", async () => {
    abrir();
    const link = await waitFor(() =>
      screen.getByText(LISTING_MENU_COPY.abrirEnOtraPestana).closest("a"),
    );
    expect(link?.getAttribute("href")).toBe(`/marketplace/${BASE.listingId}`);
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("eliminar va al final y no borra sin confirmar", async () => {
    abrir({ status: "published" });
    fireEvent.click(await waitFor(() => screen.getByText(LISTING_MENU_COPY.eliminar)));
    expect(actions.eliminarAvisoAction).not.toHaveBeenCalled();
    expect(await screen.findByText(LISTING_MENU_COPY.eliminarTitulo)).toBeTruthy();
  });

  it("confirmar elimina el aviso con la marca de confirmación", async () => {
    actions.eliminarAvisoAction.mockResolvedValue({ ok: true });
    abrir({ status: "published" });
    fireEvent.click(await waitFor(() => screen.getByText(LISTING_MENU_COPY.eliminar)));
    fireEvent.click(await screen.findByText(LISTING_MENU_COPY.eliminarConfirmar));
    await waitFor(() =>
      expect(actions.eliminarAvisoAction).toHaveBeenCalledWith({
        listingId: BASE.listingId,
        confirmed: true,
      }),
    );
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
  });

  it("un negocio no se elimina desde acá: tiene su propia página", async () => {
    abrir({ kind: "business" });
    await waitFor(() => screen.getByText(EDICION_COPY.menu.editarNegocio));
    expect(screen.queryByText(LISTING_MENU_COPY.eliminar)).toBeNull();
  });

  it("el dueño no se reporta a sí mismo", async () => {
    abrir({ reportable: true, haySesion: true });
    await waitFor(() => screen.getByText(EDICION_COPY.menu.editar));
    expect(screen.queryByText("Reportar")).toBeNull();
  });
});

describe("sobre un aviso ajeno en el feed", () => {
  it("se ofrece abrir en otra pestaña y reportar, nada del dueño", async () => {
    render(<ListingOwnerMenu {...BASE} esMio={false} reportable haySesion />);
    fireEvent.click(screen.getByRole("button", { name: /Opciones/ }));
    await waitFor(() => screen.getByText("Reportar"));
    expect(screen.getByText(LISTING_MENU_COPY.abrirEnOtraPestana)).toBeTruthy();
    expect(screen.queryByText(EDICION_COPY.menu.editar)).toBeNull();
    expect(screen.queryByText(LISTING_MENU_COPY.promocionar)).toBeNull();
    expect(screen.queryByText(LISTING_MENU_COPY.eliminar)).toBeNull();
  });

  it("reportar abre la hoja contra el aviso", async () => {
    render(<ListingOwnerMenu {...BASE} esMio={false} reportable haySesion />);
    fireEvent.click(screen.getByRole("button", { name: /Opciones/ }));
    fireEvent.click(await waitFor(() => screen.getByText("Reportar")));
    expect((await screen.findByTestId("report-sheet")).textContent).toBe(
      `listing:${BASE.listingId}`,
    );
  });

  it("sin sesión, reportar pide entrar primero", async () => {
    render(<ListingOwnerMenu {...BASE} esMio={false} reportable haySesion={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Opciones/ }));
    fireEvent.click(await waitFor(() => screen.getByText("Reportar")));
    expect(auth.requireAuth).toHaveBeenCalled();
    expect(screen.queryByTestId("report-sheet")).toBeNull();
  });
});

describe("pausar", () => {
  it("llama a la action y recién con el ok cambia el rótulo a 'volver a publicar'", async () => {
    render(<ListingOwnerMenu {...BASE} esMio status="published" />);
    fireEvent.click(screen.getByRole("button", { name: /Opciones/ }));
    fireEvent.click(await waitFor(() => screen.getByText(EDICION_COPY.menu.pausar)));

    await waitFor(() =>
      expect(actions.pausarAvisoAction).toHaveBeenCalledWith({
        listingId: BASE.listingId,
        pausar: true,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Opciones/ }));
    await waitFor(() => screen.getByText(EDICION_COPY.menu.reactivar));
  });

  it("si el servidor rechaza, el rótulo NO se mueve y se dice qué pasó", async () => {
    actions.pausarAvisoAction.mockResolvedValue({
      ok: false,
      error: EDICION_COPY.errores.noSeEdita,
    });
    render(<ListingOwnerMenu {...BASE} esMio status="published" />);
    fireEvent.click(screen.getByRole("button", { name: /Opciones/ }));
    fireEvent.click(await waitFor(() => screen.getByText(EDICION_COPY.menu.pausar)));

    await waitFor(() => expect(toast.toast).toHaveBeenCalled());
    expect(toast.toast.mock.calls[0][0]).toMatchObject({ variant: "danger" });
    expect(nav.refresh).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Opciones/ }));
    await waitFor(() => screen.getByText(EDICION_COPY.menu.pausar));
  });
});

describe("volver a publicar", () => {
  async function reactivar() {
    render(<ListingOwnerMenu {...BASE} esMio status="paused" />);
    fireEvent.click(screen.getByRole("button", { name: /Opciones/ }));
    fireEvent.click(await waitFor(() => screen.getByText(EDICION_COPY.menu.reactivar)));
    await waitFor(() => expect(toast.toast).toHaveBeenCalled());
    return toast.toast.mock.calls[0][0];
  }

  it("si volvió a la vista, lo dice en vez de prometer una revisión", async () => {
    actions.pausarAvisoAction.mockResolvedValue({ ok: true, status: "published" });
    expect(await reactivar()).toMatchObject({ title: EDICION_COPY.ok.reactivadaVisibleTitulo });
  });

  it("si quedó en revisión, avisa que la mandamos a revisión", async () => {
    actions.pausarAvisoAction.mockResolvedValue({ ok: true, status: "pending_review" });
    expect(await reactivar()).toMatchObject({ title: EDICION_COPY.ok.reactivadaTitulo });
  });
});
