// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui";

/**
 * Composer del feed — rediseño 2026-07-29 (pedido de Manuel).
 *
 * Lo que este archivo ancla del contrato NUEVO:
 *  1. en reposo hay UNA sola cosa, sin campo de texto ni botón Publicar afuera:
 *     la tarjeta "¿Qué querés publicar?" — tocarla es lo único que hace algo;
 *  2. esa tarjeta abre el menú con los 11 tipos (10 + Texto, 2026-07-29);
 *  3. foto y video disparan su selector y siguen en la HOJA de texto;
 *  4. Texto abre la hoja con su propia vista previa, sin encuesta;
 *  5. Pregunta abre la hoja con su vista previa y el interruptor de encuesta;
 *  6. Texto y Pregunta publican con su `kind` correcto — la regla "todo post
 *     lleva imagen" ya no necesita una hoja aparte que la explique: ningún
 *     camino de la UI llega a "escribí y publicá sin medio" para poder
 *     violarla (ver el docblock de post-composer.tsx).
 *
 * Dependencias pesadas (router, supabase, server actions) van stubeadas —
 * mismo patrón que comments-sheet.test.tsx — porque lo que se testea es el
 * flujo de la UI, no la subida real.
 */

const { createPostAction, prepareMediaUploadAction } = vi.hoisted(() => ({
  createPostAction: vi.fn(),
  prepareMediaUploadAction: vi.fn(),
}));

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
// server-only) — se stubean. `createPostAction` sí se ejecuta en los dos
// tests de publicación (Texto/Pregunta): son los únicos que necesitan una
// respuesta resuelta para inspeccionar el `kind` que viajó.
vi.mock("@/app/(app)/feed/actions", () => ({
  createPostAction,
  prepareMediaUploadAction,
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

/**
 * `modules` vacío = nadie decidió nada en el panel, que es el default de
 * `moduleAvailability`: el menú de crear sale con las once opciones.
 */
function mount(viewerName = "Ana Gómez") {
  return render(
    <ToastProvider>
      <PostComposer
        viewerName={viewerName}
        viewerAvatarUrl={null}
        modules={{}}
        modulesSoon={{}}
      />
    </ToastProvider>,
  );
}

function openMenu() {
  fireEvent.click(screen.getByText(COPY.composer.createMenu.rowLabel));
  return screen.findByText(COPY.composer.createMenu.sheetTitle);
}

/** El textarea de la HOJA (el único que existe: ya no hay uno afuera). */
function sheetBody(): HTMLTextAreaElement {
  return document.getElementById("composer-sheet-body") as HTMLTextAreaElement;
}

afterEach(() => {
  cleanup();
  createPostAction.mockReset();
  prepareMediaUploadAction.mockReset();
});

describe("PostComposer — un solo elemento en reposo", () => {
  it("no hay campo de texto ni botón Publicar afuera de la hoja", () => {
    mount();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(COPY.composer.publish) })).toBeNull();
  });

  it("en reposo NO hay recuadros de agregar foto ni de agregar video", () => {
    mount();
    // El único lugar donde vuelven a aparecer es DENTRO de la hoja de texto.
    expect(screen.queryByRole("button", { name: COPY.composer.addPhotos })).toBeNull();
    expect(screen.queryByRole("button", { name: COPY.composer.addVideo })).toBeNull();
    expect(screen.queryByRole("button", { name: COPY.composer.addMorePhotos })).toBeNull();
  });

  it("la tarjeta entera es el disparador y abre el menú con los 11 tiles", async () => {
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

describe("PostComposer — Texto abre su propio paso, sin encuesta", () => {
  it("el tile Texto abre la hoja con su título y sin interruptor de encuesta", async () => {
    mount();
    await openMenu();

    fireEvent.click(screen.getByText(COPY.composer.createMenu.tiles.text.title));

    expect(await screen.findByText(COPY.composer.compose.textTitle)).toBeTruthy();
    // `kind='text'` nunca lleva poll_kind (0041/0043): el interruptor no existe.
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("sin escribir todavía, muestra el placeholder de la vista previa", async () => {
    mount();
    await openMenu();
    fireEvent.click(screen.getByText(COPY.composer.createMenu.tiles.text.title));

    // Aparece dos veces a propósito: la vista previa Y el <label> sr-only del
    // textarea comparten el mismo texto (mismo patrón que questionPlaceholder).
    await waitFor(() => {
      expect(screen.getAllByText(COPY.composer.compose.textPlaceholder).length).toBeGreaterThan(0);
    });
  });

  it("publica con kind='text' (no 'post' ni 'question')", async () => {
    createPostAction.mockResolvedValue({ ok: true, status: "published" });
    mount();
    await openMenu();
    fireEvent.click(screen.getByText(COPY.composer.createMenu.tiles.text.title));

    fireEvent.change(await screen.findByLabelText(COPY.composer.compose.textPlaceholder), {
      target: { value: "Hoy abrió la feria del barrio y estaba llenísima." },
    });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(COPY.composer.publish) }));

    await waitFor(() => expect(createPostAction).toHaveBeenCalledTimes(1));
    const sent = createPostAction.mock.calls[0]?.[0] as FormData;
    expect(sent.get("kind")).toBe("text");
    expect(sent.get("pollKind")).toBeNull();
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
    await openMenu();
    fireEvent.click(screen.getByText(COPY.composer.createMenu.tiles.question.title));

    fireEvent.change(await screen.findByLabelText(COPY.composer.compose.questionPlaceholder), {
      target: { value: "¿Conviene mudarse a Jackson Heights?" },
    });
    fireEvent.click(
      screen.getByRole("switch", { name: new RegExp(COPY.composer.compose.pollLabel) }),
    );

    expect(screen.getByText(COPY.composer.compose.previewLabel)).toBeTruthy();
    expect(screen.getAllByText(COPY.post.poll.yes).length).toBeGreaterThan(0);
    expect(screen.getAllByText(COPY.post.poll.no).length).toBeGreaterThan(0);
  });

  it("publica con kind='question' y la encuesta cuando está prendida", async () => {
    createPostAction.mockResolvedValue({ ok: true, status: "published" });
    mount();
    await openMenu();
    fireEvent.click(screen.getByText(COPY.composer.createMenu.tiles.question.title));

    fireEvent.change(await screen.findByLabelText(COPY.composer.compose.questionPlaceholder), {
      target: { value: "¿Alguien sabe a qué hora abre la feria?" },
    });
    fireEvent.click(
      screen.getByRole("switch", { name: new RegExp(COPY.composer.compose.pollLabel) }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(COPY.composer.compose.publishQuestion) }),
    );

    await waitFor(() => expect(createPostAction).toHaveBeenCalledTimes(1));
    const sent = createPostAction.mock.calls[0]?.[0] as FormData;
    expect(sent.get("kind")).toBe("question");
    expect(sent.get("pollKind")).toBe("yes_no");
  });
});

describe("PostComposer — el cuerpo no se pierde si cambiás de idea", () => {
  it("cerrar Texto sin publicar y abrir Pregunta conserva lo ya escrito", async () => {
    // Mismo criterio que el viejo flujo "¿cómo lo mostramos?" (needsMedia,
    // ya retirado): un cambio de tipo de publicación nunca debería borrar lo
    // que la persona ya tipeó. `body` vive en PostComposer, no en la hoja.
    mount();
    await openMenu();
    fireEvent.click(screen.getByText(COPY.composer.createMenu.tiles.text.title));
    fireEvent.change(await screen.findByLabelText(COPY.composer.compose.textPlaceholder), {
      target: { value: "Che, esto lo escribí como texto." },
    });

    // Cerrar sin publicar (botón "Cerrar" del pie de la hoja).
    fireEvent.click(screen.getByRole("button", { name: COPY.composer.compose.close }));
    await openMenu();
    fireEvent.click(screen.getByText(COPY.composer.createMenu.tiles.question.title));

    expect(sheetBody().value).toBe("Che, esto lo escribí como texto.");
  });
});

describe("PostComposer — el tope de publicaciones se explica como lo que es", () => {
  /** Escribe un texto y toca Publicar; devuelve cuando la action ya corrió. */
  async function publicarTexto() {
    mount();
    await openMenu();
    fireEvent.click(screen.getByText(COPY.composer.createMenu.tiles.text.title));
    fireEvent.change(await screen.findByLabelText(COPY.composer.compose.textPlaceholder), {
      target: { value: "Otra publicación más, van muchas seguidas." },
    });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(COPY.composer.publish) }));
    await waitFor(() => expect(createPostAction).toHaveBeenCalledTimes(1));
  }

  it("no le echa la culpa al sistema cuando el tope fue del volumen de la persona", async () => {
    // El copy genérico ("algo no cargó bien de nuestro lado — no es tu culpa")
    // sería FALSO acá: no falló nada. Y peor, no dice qué hacer.
    createPostAction.mockResolvedValue({ ok: false, code: "rate-limited" });
    await publicarTexto();

    expect(await screen.findByText(COPY.composer.rateLimitedTitle)).toBeTruthy();
    expect(screen.getByText(COPY.composer.rateLimitedBody)).toBeTruthy();
    expect(screen.queryByText(COPY.composer.errorTitle)).toBeNull();
    expect(screen.queryByText(COPY.composer.errorBody)).toBeNull();
  });

  it("le saca el miedo a que la cuenta esté en problemas", async () => {
    // Para nuestro público, que la app frene algo se lee como "me bloquearon".
    createPostAction.mockResolvedValue({ ok: false, code: "rate-limited" });
    await publicarTexto();

    expect(await screen.findByText(/tu cuenta está bien/i)).toBeTruthy();
  });

  it("un error REAL del servidor sí muestra el copy genérico", async () => {
    // Contraste: el mensaje de arriba no puede haberse comido el caso honesto.
    createPostAction.mockResolvedValue({ ok: false, code: "error" });
    await publicarTexto();

    expect(await screen.findByText(COPY.composer.errorTitle)).toBeTruthy();
    expect(screen.queryByText(COPY.composer.rateLimitedTitle)).toBeNull();
  });
});
