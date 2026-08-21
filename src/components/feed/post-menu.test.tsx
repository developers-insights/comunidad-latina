// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Tests del MENÚ ⋯ de una publicación (0097).
 *
 * Se testea QUÉ SE OFRECE y a quién, que los rótulos digan lo que la acción HACE
 * (no el estado), y que "Abrir en otra pestaña" sea un enlace de verdad. Que un
 * ítem no se muestre NO es la seguridad —eso está probado en
 * `post-menu-actions.test.ts` y contra la base real—, pero ofrecer de más sería
 * mandar a la gente a un rechazo.
 */

const mocks = vi.hoisted(() => ({
  togglePin: vi.fn(),
  toggleHide: vi.fn(),
  toggleCommentsLocked: vi.fn(),
  toast: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/app/(app)/feed/post-menu-actions", () => ({
  togglePinPostAction: mocks.togglePin,
  toggleHidePostAction: mocks.toggleHide,
  toggleCommentsLockedAction: mocks.toggleCommentsLocked,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }),
  // `useRequireAuth` (hoja de entrada) lo usa para saber a dónde volver cuando
  // el menú se renderiza fuera del provider, como en este test.
  usePathname: () => "/feed",
}));
vi.mock("@/components/ui", async () => {
  const react = await import("react");
  type Nodo = React.ReactNode;
  return {
    // El BottomSheet real trae motion + portal + foco atrapado. Acá sólo
    // interesa qué filas hay adentro cuando está abierto.
    BottomSheet: ({
      open,
      children,
      ariaLabel,
    }: {
      open: boolean;
      children: Nodo;
      ariaLabel?: string;
    }) => (open ? react.createElement("div", { role: "dialog", "aria-label": ariaLabel }, children) : null),
    Dialog: ({ open, children }: { open: boolean; children: Nodo }) =>
      open ? react.createElement("div", { role: "alertdialog" }, children) : null,
    Button: ({ children, ...props }: Record<string, unknown> & { children: Nodo }) =>
      react.createElement("button", props as never, children),
    useToast: () => ({ toast: mocks.toast }),
  };
});
vi.mock("@/components/trust", async () => {
  const react = await import("react");
  return {
    ReportScamButton: ({ onReport }: { onReport: () => void }) =>
      react.createElement("button", { type: "button", onClick: onReport }, "Reportar"),
    ReportSheet: () => null,
  };
});

import { PostMenu } from "./post-menu";

const ME = "yo";
const OTHER = "otra-persona";
const POST_ID = "post-1";

function renderMenu(props: Partial<React.ComponentProps<typeof PostMenu>> = {}) {
  return render(
    <PostMenu
      postId={POST_ID}
      authorId={ME}
      viewerId={ME}
      postBody="hola"
      postStatus="published"
      {...props}
    />,
  );
}

/** Abre la hoja del menú. `fireEvent` y no user-event: el repo no lo instala. */
function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: /más opciones/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.togglePin.mockResolvedValue({ ok: true });
  mocks.toggleHide.mockResolvedValue({ ok: true });
  mocks.toggleCommentsLocked.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe("qué ofrece el menú", () => {
  it("al autor: fijar, editar, ocultar y desactivar comentarios", () => {
    renderMenu();
    openMenu();

    expect(screen.getByRole("button", { name: "Fijar publicación" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Editar publicación" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ocultar del feed" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Desactivar comentarios" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Eliminar publicación" })).toBeTruthy();
  });

  it("a quien no publicó: NINGUNA acción de autor", () => {
    renderMenu({ authorId: OTHER });
    openMenu();

    expect(screen.queryByRole("button", { name: "Fijar publicación" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ocultar del feed" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Desactivar comentarios" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Eliminar publicación" })).toBeNull();
    // Lo que sí puede: reportar y abrir en otra pestaña.
    expect(screen.getByRole("button", { name: "Reportar" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Abrir en otra pestaña" })).toBeTruthy();
  });

  it("publicación en revisión: se puede eliminar, pero no fijar ni ocultar", () => {
    renderMenu({ postStatus: "pending_review" });
    openMenu();

    expect(screen.queryByRole("button", { name: "Fijar publicación" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ocultar del feed" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar publicación" })).toBeNull();
    // Bajar algo propio es un derecho aunque esté en revisión.
    expect(screen.getByRole("button", { name: "Eliminar publicación" })).toBeTruthy();
  });

  it("los rótulos dicen lo que la acción HACE, según el estado actual", () => {
    renderMenu({
      pinnedAt: "2026-08-13T10:00:00Z",
      commentsLockedAt: "2026-08-13T10:00:00Z",
    });
    openMenu();

    expect(screen.getByRole("button", { name: "Dejar de fijar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Activar comentarios" })).toBeTruthy();
  });

  it("oculta: ofrece volver a mostrarla", () => {
    renderMenu({ hiddenAt: "2026-08-13T10:00:00Z" });
    openMenu();

    expect(screen.getByRole("button", { name: "Volver a mostrar" })).toBeTruthy();
  });
});

/**
 * SIN AUTOR NO SE OFRECE REPORTAR (revisión 2026-08-20).
 *
 * El reporte viaja contra el PERFIL del autor. Si la cuenta ya no existe no hay
 * a quién reportar, y hasta hoy la fila se ofrecía igual: quien la tocaba sin
 * sesión pasaba por el formulario de entrada COMPLETO para que después la
 * pantalla no se moviera. El repo tiene como regla que todo error se ve; acá se
 * elige el camino de menos pasos y directamente no se abre la puerta.
 */
describe("reportar cuando la cuenta del autor ya no existe", () => {
  it("no ofrece 'Reportar' si no hay autor", () => {
    renderMenu({ authorId: null, viewerId: OTHER });
    openMenu();

    expect(screen.queryByRole("button", { name: "Reportar" })).toBeNull();
    // El resto del menú sigue entero: lo que se cae es sólo lo que no lleva a
    // ninguna parte.
    expect(screen.getByRole("link", { name: "Abrir en otra pestaña" })).toBeTruthy();
  });

  it("tampoco lo ofrece a quien no tiene sesión — el login sería un peaje a la nada", () => {
    renderMenu({ authorId: null, viewerId: null });
    openMenu();

    expect(screen.queryByRole("button", { name: "Reportar" })).toBeNull();
  });

  it("con autor sí lo ofrece, con y sin sesión", () => {
    renderMenu({ authorId: OTHER, viewerId: null });
    openMenu();
    expect(screen.getByRole("button", { name: "Reportar" })).toBeTruthy();

    cleanup();

    renderMenu({ authorId: OTHER, viewerId: ME });
    openMenu();
    expect(screen.getByRole("button", { name: "Reportar" })).toBeTruthy();
  });
});

describe("abrir en otra pestaña", () => {
  it("es un enlace real al detalle, con rel seguro (no un window.open)", async () => {
    renderMenu();
    openMenu();

    const link = screen.getByRole("link", { name: "Abrir en otra pestaña" });
    expect(link.getAttribute("href")).toBe(`/feed/${POST_ID}`);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });
});

describe("los toggles", () => {
  it("fijar llama a la action con el sentido correcto y avisa qué pasó", async () => {
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Fijar publicación" }));

    await waitFor(() =>
      expect(mocks.togglePin).toHaveBeenCalledWith({ postId: POST_ID, pin: true }),
    );
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Publicación fijada", variant: "success" }),
      ),
    );
  });

  it("ocultar también apaga el rótulo de fijada (la base desfija en la misma escritura)", async () => {
    renderMenu({ pinnedAt: "2026-08-13T10:00:00Z" });
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Ocultar del feed" }));
    await waitFor(() => expect(mocks.toggleHide).toHaveBeenCalled());

    openMenu();
    expect(screen.getByRole("button", { name: "Fijar publicación" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Dejar de fijar" })).toBeNull();
  });

  it("si el servidor rechaza, se muestra SU mensaje y el rótulo no cambia", async () => {
    mocks.togglePin.mockResolvedValue({
      ok: false,
      code: "denied",
      message: "Está oculta del feed. Volvé a mostrarla y después fijala.",
    });
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Fijar publicación" }));

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "danger",
          description: "Está oculta del feed. Volvé a mostrarla y después fijala.",
        }),
      ),
    );

    openMenu();
    expect(screen.getByRole("button", { name: "Fijar publicación" })).toBeTruthy();
  });
});
