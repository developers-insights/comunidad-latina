// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ListingOwnerMenu, ListingOwnerMenuOverlay } from "./listing-owner-menu";
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
const actions = vi.hoisted(() => ({ pausarAvisoAction: vi.fn() }));

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

  it("nunca ofrece eliminar desde la grilla: lo irreversible vive en /publicaciones", async () => {
    abrir({ status: "published" });
    await waitFor(() => screen.getByText(EDICION_COPY.menu.editar));
    expect(screen.queryByText(/Eliminar/i)).toBeNull();
    expect(
      screen.getByText(EDICION_COPY.menu.verMisPublicaciones).closest("a")?.getAttribute("href"),
    ).toBe("/publicaciones");
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
