// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui";

/**
 * Composer del feed — rediseño 2026-07-26. Acá se testea SOLO lo nuevo:
 * el menú "crear publicación" (fila-disparador → BottomSheet con los 10
 * tiles) y el saludo visible por franja + nombre. El resto del composer
 * (attach de foto/video síncrono, subida de video, publicar) ya tiene su
 * propio comportamiento probado en producción y no se toca acá.
 *
 * Dependencias pesadas (router, supabase, server actions) van stubeadas —
 * mismo patrón que comments-sheet.test.tsx / toast.test.tsx — porque lo que
 * se testea es la UI nueva, no la subida real ni el submit.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// next/link sin contexto de router: sólo un <a href>.
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
    auth: { getSession: async () => ({ data: { session: null } }) },
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  }),
}));

// Server actions reales no aplican en un test de UI (y arrastran cadenas de
// server-only) — se stubean, ninguno de estos tests llega a publicar.
vi.mock("@/app/(app)/feed/actions", () => ({
  createPostAction: vi.fn(),
  prepareMediaUploadAction: vi.fn(),
}));

// motion neutralizado: el DOM refleja el estado del BottomSheet al instante
// (mismo patrón que toast.test.tsx / comments-sheet.test.tsx).
vi.mock("motion/react", () => {
  const filter = (props: Record<string, unknown>) => {
    const {
      layout,
      initial,
      animate,
      exit,
      transition,
      drag,
      dragConstraints,
      dragElastic,
      onDragEnd,
      whileTap,
      whileHover,
      ...rest
    } = props;
    return rest;
  };
  const div = ({
    children,
    ...props
  }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <div {...filter(props)}>{children}</div>
  );
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    m: { div },
    motion: { div },
    useReducedMotion: () => false,
  };
});

import { PostComposer } from "./post-composer";
import { COPY } from "./copy";

function mount(viewerName = "Ana Gómez") {
  return render(
    <ToastProvider>
      <PostComposer viewerName={viewerName} viewerAvatarUrl={null} />
    </ToastProvider>,
  );
}

function openMenu() {
  fireEvent.click(screen.getByText(COPY.composer.createMenu.rowLabel));
  return screen.findByText(COPY.composer.createMenu.sheetTitle);
}

afterEach(cleanup);

describe("PostComposer — menú crear publicación", () => {
  it("la fila-disparador abre un sheet con los 10 tiles (foto/video/pregunta + los 7 módulos)", async () => {
    mount();
    await openMenu();

    for (const tile of Object.values(COPY.composer.createMenu.tiles)) {
      expect(screen.getByText(tile.title)).toBeTruthy();
      expect(screen.getByText(tile.description)).toBeTruthy();
    }
  });

  it("los 7 tiles de módulo navegan al href correcto", async () => {
    mount();
    await openMenu();

    const expectations: Array<[string, string]> = [
      [COPY.composer.createMenu.tiles.property.title, "/publicar?kind=property"],
      [COPY.composer.createMenu.tiles.business.title, "/publicar?kind=business"],
      [COPY.composer.createMenu.tiles.professional.title, "/publicar?kind=professional"],
      [COPY.composer.createMenu.tiles.event.title, "/publicar?kind=event"],
      [COPY.composer.createMenu.tiles.job.title, "/publicar?kind=job"],
      [COPY.composer.createMenu.tiles.product.title, "/marketplace/publicar"],
      [COPY.composer.createMenu.tiles.creatorService.title, "/creadores/publicar"],
    ];

    for (const [title, href] of expectations) {
      const link = screen.getByRole("link", { name: new RegExp(title) });
      expect(link.getAttribute("href")).toBe(href);
    }
  });

  it("el tile Foto dispara el input de fotos oculto (y cierra el sheet)", async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    mount();
    await openMenu();

    fireEvent.click(screen.getByText(COPY.composer.createMenu.tiles.photo.title));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const clicked = clickSpy.mock.instances[0] as unknown as HTMLInputElement;
    expect(clicked.id).toBe("post-composer-photos");
    expect(screen.queryByText(COPY.composer.createMenu.sheetTitle)).toBeNull();

    clickSpy.mockRestore();
  });

  it("el tile Video dispara el input de video oculto", async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    mount();
    await openMenu();

    fireEvent.click(screen.getByText(COPY.composer.createMenu.tiles.video.title));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const clicked = clickSpy.mock.instances[0] as unknown as HTMLInputElement;
    expect(clicked.id).toBe("post-composer-video");

    clickSpy.mockRestore();
  });

  it('el tile Pregunta activa el modo pregunta con un chip "Pregunta" removible', async () => {
    mount();
    await openMenu();

    fireEvent.click(screen.getByText(COPY.composer.createMenu.tiles.question.title));

    // El sheet cierra y el chip queda visible en el composer.
    expect(screen.queryByText(COPY.composer.createMenu.sheetTitle)).toBeNull();
    expect(await screen.findByText(COPY.composer.questionModeChip)).toBeTruthy();

    // Es removible: lo saca de nuevo del modo pregunta.
    fireEvent.click(screen.getByRole("button", { name: COPY.composer.questionModeRemove }));
    expect(screen.queryByText(COPY.composer.questionModeChip)).toBeNull();
  });
});

describe("PostComposer — saludo visible", () => {
  it("saluda por franja horaria y nombre de pila una vez montado", async () => {
    mount("Ana Gómez");
    const expected = COPY.composer.greetingByHour(new Date().getHours(), "Ana");
    expect(await screen.findByText(expected)).toBeTruthy();
  });

  it("sin display_name en el perfil: saluda igual de cálido, sin nombre", async () => {
    mount("");
    const expected = COPY.composer.greetingByHour(new Date().getHours(), null);
    expect(await screen.findByText(expected)).toBeTruthy();
  });
});
