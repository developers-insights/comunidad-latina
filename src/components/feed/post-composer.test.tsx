// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui";

/**
 * Composer del feed — rediseño 2026-07-27 (call con el cliente).
 *
 * Lo que este archivo ancla del contrato NUEVO:
 *  1. en reposo NO hay recuadros de "Agregar foto" / "Agregar video": el único
 *     disparador es la fila "¿Qué querés publicar?";
 *  2. esa fila abre el menú con los 10 tipos;
 *  3. foto y video disparan su selector y siguen en la HOJA de texto;
 *  4. pregunta abre la hoja con su vista previa y el interruptor de encuesta;
 *  5. escribir y publicar SIN medio no es un error: aparecen los dos caminos
 *     (sumar medio o publicarlo como pregunta) y el texto NO se pierde;
 *  6. el saludo por franja horaria sigue en pie.
 *
 * Dependencias pesadas (router, supabase, server actions) van stubeadas —
 * mismo patrón que comments-sheet.test.tsx — porque lo que se testea es el
 * flujo de la UI, no la subida real.
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
  const span = ({
    children,
    ...props
  }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <span {...filter(props)}>{children}</span>
  );
  const p = ({
    children,
    ...props
  }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <p {...filter(props)}>{children}</p>
  );
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    m: { div, span, p },
    motion: { div, span, p },
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

/** Escribe en el campo rápido del composer (el de arriba, no el de la hoja). */
function typeQuick(text: string) {
  const field = document.getElementById("post-composer-body") as HTMLTextAreaElement;
  fireEvent.change(field, { target: { value: text } });
  return field;
}

afterEach(cleanup);

describe("PostComposer — un solo disparador", () => {
  it("en reposo NO hay recuadros de agregar foto ni de agregar video", () => {
    mount();
    // El único lugar donde vuelven a aparecer es DENTRO de la hoja de texto.
    expect(screen.queryByRole("button", { name: COPY.composer.addPhotos })).toBeNull();
    expect(screen.queryByRole("button", { name: COPY.composer.addVideo })).toBeNull();
    expect(screen.queryByRole("button", { name: COPY.composer.addMorePhotos })).toBeNull();
  });

  it("la fila-disparador es la única puerta y abre el menú con los 10 tiles", async () => {
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
      // Empleos tiene su propio flujo de publicación (como Marketplace y
      // Creadores): el tile ya no pasa por el /publicar genérico.
      [COPY.composer.createMenu.tiles.job.title, "/empleos/publicar"],
      [COPY.composer.createMenu.tiles.product.title, "/marketplace/publicar"],
      [COPY.composer.createMenu.tiles.creatorService.title, "/creadores/publicar"],
    ];

    for (const [title, href] of expectations) {
      const link = screen.getByRole("link", { name: new RegExp(title) });
      expect(link.getAttribute("href")).toBe(href);
    }
  });

  it("el tile Foto dispara el input de fotos oculto (y cierra el menú)", async () => {
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
});

describe("PostComposer — la pregunta abre su propio paso", () => {
  it("el tile Pregunta abre la hoja con vista previa y encuesta apagada", async () => {
    mount();
    await openMenu();

    fireEvent.click(screen.getByText(COPY.composer.createMenu.tiles.question.title));

    expect(await screen.findByText(COPY.composer.compose.questionTitle)).toBeTruthy();
    const toggle = screen.getByRole("switch", { name: new RegExp(COPY.composer.compose.pollLabel) });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("el interruptor de encuesta se prende y se apaga", async () => {
    mount();
    await openMenu();
    fireEvent.click(screen.getByText(COPY.composer.createMenu.tiles.question.title));

    const toggle = await screen.findByRole("switch", {
      name: new RegExp(COPY.composer.compose.pollLabel),
    });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("con la encuesta prendida la vista previa ya muestra Sí y No", async () => {
    mount();
    typeQuick("¿Conviene mudarse a Jackson Heights?");
    await openMenu();
    fireEvent.click(screen.getByText(COPY.composer.createMenu.tiles.question.title));

    fireEvent.click(
      await screen.findByRole("switch", { name: new RegExp(COPY.composer.compose.pollLabel) }),
    );

    expect(screen.getByText(COPY.composer.compose.previewLabel)).toBeTruthy();
    expect(screen.getAllByText(COPY.post.poll.yes).length).toBeGreaterThan(0);
    expect(screen.getAllByText(COPY.post.poll.no).length).toBeGreaterThan(0);
  });
});

describe("PostComposer — la regla de la imagen no es un error", () => {
  it("publicar texto solo abre los dos caminos en vez de fallar", async () => {
    mount();
    typeQuick("Hoy abrió la feria del barrio y estaba llenísima.");

    fireEvent.click(screen.getByRole("button", { name: new RegExp(COPY.composer.publish) }));

    expect(await screen.findByText(COPY.composer.needsMedia.sheetTitle)).toBeTruthy();
    expect(screen.getByText(COPY.composer.needsMedia.withMediaTitle)).toBeTruthy();
    expect(screen.getByText(COPY.composer.needsMedia.asQuestionTitle)).toBeTruthy();
  });

  it('"Con una foto o un video" abre el selector, no publica a ciegas', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    mount();
    typeQuick("Hoy abrió la feria del barrio y estaba llenísima.");
    fireEvent.click(screen.getByRole("button", { name: new RegExp(COPY.composer.publish) }));

    fireEvent.click(await screen.findByText(COPY.composer.needsMedia.withMediaTitle));

    const clicked = clickSpy.mock.instances[0] as unknown as HTMLInputElement;
    expect(clicked.id).toBe("post-composer-photos");
    clickSpy.mockRestore();
  });

  it('"Como pregunta" pasa a la hoja de pregunta SIN perder lo escrito', async () => {
    const written = "¿Alguien sabe a qué hora abre la feria del barrio?";
    mount();
    typeQuick(written);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(COPY.composer.publish) }));

    fireEvent.click(await screen.findByText(COPY.composer.needsMedia.asQuestionTitle));

    expect(await screen.findByText(COPY.composer.compose.questionTitle)).toBeTruthy();
    const sheetField = document.getElementById("composer-sheet-body") as HTMLTextAreaElement;
    expect(sheetField.value).toBe(written);
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
