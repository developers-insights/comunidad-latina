// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui";
import type { SaveTagsResult, SearchTaggableResult } from "@/app/(app)/feed/tag-actions";
import type {
  AttachPostMusicResult,
  ListMusicTracksResult,
} from "@/app/(app)/feed/music-actions";

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

const {
  createPostAction,
  prepareMediaUploadAction,
  bakePhoto,
  saveTagsAction,
  attachPostMusicAction,
  listMusicTracksAction,
  searchTaggableMembersAction,
} = vi.hoisted(() => ({
  createPostAction: vi.fn(),
  prepareMediaUploadAction: vi.fn(),
  // Los dos pasos que corren DESPUÉS de publicar (necesitan el postId).
  // Los tipos de resultado van EXPLÍCITOS: sin eso TypeScript infiere el caso
  // feliz del default (`ok: true`) y ningún test podría simular un fallo.
  saveTagsAction: vi.fn(
    async (): Promise<SaveTagsResult> => ({ ok: true, tagged: [], rejected: [] }),
  ),
  attachPostMusicAction: vi.fn(
    async (): Promise<AttachPostMusicResult> => ({ ok: true, startSeconds: 0 }),
  ),
  listMusicTracksAction: vi.fn(
    async (): Promise<ListMusicTracksResult> => ({ ok: true, tracks: [] }),
  ),
  searchTaggableMembersAction: vi.fn(
    async (): Promise<SearchTaggableResult> => ({ ok: true, people: [] }),
  ),
  // Por default, "hornea" devolviendo el mismo File que recibió — los tests
  // que necesitan distinguir el archivo horneado del original lo sobrescriben.
  bakePhoto: vi.fn(async (file: File) => file),
}));

// El horneado real usa canvas (no existe en jsdom) — se stubea acá, igual que
// las server actions. Los tests de este archivo verifican QUÉ se manda al
// publicar (el archivo que devuelve `bakePhoto`), no CÓMO se dibuja el canvas
// (eso lo cubre bake-photo.test.ts, si existe, contra el módulo real).
vi.mock("@/lib/media/bake-photo", () => ({ bakePhoto }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  // El host lee `pathname` para decidir refresh() vs push("/feed") al publicar
  // (ver post-composer.tsx) — estos tests siempre montan como si ya se
  // estuviera en el feed.
  usePathname: () => "/feed",
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

// Etiquetas (0089) y música (0090): el composer las monta y las guarda después
// de publicar. Acá sólo se verifica el CABLEADO — que se llamen con el postId
// recién creado y que un fallo no voltee la publicación; lo que hace cada
// action contra la base ya lo cubren tag-actions.test.ts / music-actions.test.ts.
vi.mock("@/app/(app)/feed/tag-actions", () => ({
  saveTagsAction,
  searchTaggableMembersAction,
  removeTagAction: vi.fn(),
}));
vi.mock("@/app/(app)/feed/music-actions", () => ({
  attachPostMusicAction,
  listMusicTracksAction,
  detachPostMusicAction: vi.fn(),
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

import { PostComposerHost } from "./post-composer";
import { ComposerTrigger } from "./composer-trigger";
import { COPY } from "./copy";
import { TAGGER_COPY } from "./people-tagger-copy";
import { MUSIC_COPY } from "./music-copy";

/**
 * `modules` vacío = nadie decidió nada en el panel, que es el default de
 * `moduleAvailability`: el menú de crear sale con las once opciones.
 *
 * `PostComposerHost` + `ComposerTrigger` por separado, como en la app real
 * (el host vive en el shell, el trigger en el feed) — ver composer-context.tsx.
 */
function mount(viewerName = "Ana Gómez") {
  return render(
    <ToastProvider>
      <PostComposerHost modules={{}} modulesSoon={{}}>
        <ComposerTrigger viewerName={viewerName} viewerAvatarUrl={null} />
      </PostComposerHost>
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
  bakePhoto.mockReset();
  bakePhoto.mockImplementation(async (file: File) => file);
  saveTagsAction.mockReset();
  saveTagsAction.mockResolvedValue({ ok: true, tagged: [], rejected: [] });
  attachPostMusicAction.mockReset();
  attachPostMusicAction.mockResolvedValue({ ok: true, startSeconds: 0 });
  listMusicTracksAction.mockReset();
  listMusicTracksAction.mockResolvedValue({ ok: true, tracks: [] });
  searchTaggableMembersAction.mockReset();
  searchTaggableMembersAction.mockResolvedValue({ ok: true, people: [] });
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

describe("PostComposer — una foto se publica sin escribir nada", () => {
  /**
   * Feedback cliente 2026-08-05: "si la persona no quiere subir ningún texto
   * relacionado, que le deje publicar — porque acá si no pongo algo no me deja
   * publicar. Que se pueda publicar así de una."
   *
   * Este test cubre el camino COMPLETO (elegir foto → hoja → Publicar), que es
   * donde estaba el segundo freno: además del botón apagado, `submit()` cortaba
   * en seco con `trimmed.length < 2` y el toque no hacía absolutamente nada.
   */
  function pickPhoto() {
    const input = document.getElementById("post-composer-photos") as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "feria.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });
  }

  it("elegir una foto y tocar Publicar manda kind='post' con el cuerpo vacío", async () => {
    createPostAction.mockResolvedValue({ ok: true, status: "published" });
    mount();
    await openMenu();
    fireEvent.click(screen.getByText(COPY.composer.createMenu.tiles.photo.title));
    pickPhoto();

    const publish = await screen.findByRole("button", {
      name: new RegExp(COPY.composer.publish),
    });
    expect(publish.hasAttribute("disabled")).toBe(false);
    fireEvent.click(publish);

    await waitFor(() => expect(createPostAction).toHaveBeenCalledTimes(1));
    const sent = createPostAction.mock.calls[0]?.[0] as FormData;
    expect(sent.get("kind")).toBe("post");
    expect(sent.get("body")).toBe("");
    expect(sent.getAll("photos").length).toBe(1);
  });

  it("el pie sigue viajando cuando la persona sí escribe", async () => {
    createPostAction.mockResolvedValue({ ok: true, status: "published" });
    mount();
    await openMenu();
    fireEvent.click(screen.getByText(COPY.composer.createMenu.tiles.photo.title));
    pickPhoto();

    fireEvent.change(sheetBody(), { target: { value: "Se llenó la feria." } });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(COPY.composer.publish) }));

    await waitFor(() => expect(createPostAction).toHaveBeenCalledTimes(1));
    const sent = createPostAction.mock.calls[0]?.[0] as FormData;
    expect(sent.get("body")).toBe("Se llenó la feria.");
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

describe("PostComposer — composer premium (más fotos + horneado al publicar)", () => {
  function pickPhoto(name = "feria.jpg") {
    const input = document.getElementById("post-composer-photos") as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });
  }

  it("el cupo subió a 10: la foto número 11 se rechaza con el aviso correcto", async () => {
    mount();
    await openMenu();
    fireEvent.click(screen.getByText(COPY.composer.createMenu.tiles.photo.title));

    const input = document.getElementById("post-composer-photos") as HTMLInputElement;
    const files = Array.from(
      { length: 11 },
      (_, index) => new File([new Uint8Array([index])], `foto-${index}.jpg`, { type: "image/jpeg" }),
    );
    fireEvent.change(input, { target: { files } });

    expect(await screen.findByText(COPY.composer.photoLimit)).toBeTruthy();
    expect(screen.getByText("10 de 10 fotos")).toBeTruthy();
  });

  it("publicar manda el archivo HORNEADO (bakePhoto), no el original", async () => {
    const baked = new File([new Uint8Array([9, 9, 9])], "horneada.jpg", { type: "image/jpeg" });
    bakePhoto.mockResolvedValue(baked);
    createPostAction.mockResolvedValue({ ok: true, status: "published" });

    mount();
    await openMenu();
    fireEvent.click(screen.getByText(COPY.composer.createMenu.tiles.photo.title));
    pickPhoto();

    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(COPY.composer.publish) }),
    );

    await waitFor(() => expect(createPostAction).toHaveBeenCalledTimes(1));
    expect(bakePhoto).toHaveBeenCalledTimes(1);
    const sent = createPostAction.mock.calls[0]?.[0] as FormData;
    const sentPhoto = sent.getAll("photos")[0] as File;
    expect(sentPhoto.name).toBe("horneada.jpg");
  });

  it("hornea TODAS las fotos, no sólo las que pasaron por el editor", async () => {
    createPostAction.mockResolvedValue({ ok: true, status: "published" });
    mount();
    await openMenu();
    fireEvent.click(screen.getByText(COPY.composer.createMenu.tiles.photo.title));

    const input = document.getElementById("post-composer-photos") as HTMLInputElement;
    const files = [
      new File([new Uint8Array([1])], "a.jpg", { type: "image/jpeg" }),
      new File([new Uint8Array([2])], "b.jpg", { type: "image/jpeg" }),
      new File([new Uint8Array([3])], "c.jpg", { type: "image/jpeg" }),
    ];
    fireEvent.change(input, { target: { files } });

    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(COPY.composer.publish) }),
    );

    await waitFor(() => expect(createPostAction).toHaveBeenCalledTimes(1));
    // Ninguna se tocó en el editor y aun así las 3 pasaron por bakePhoto —
    // es la recompresión SIEMPRE, no un efecto opt-in.
    expect(bakePhoto).toHaveBeenCalledTimes(3);
  });

  /**
   * EL FRENO QUE FALTABA (2026-08-11). Con 10 fotos permitidas, una publicación
   * puede pasarse del tamaño que la server action acepta. Si no lo miramos
   * ANTES de llamarla, Next corta el request y la persona ve un error opaco —o
   * nada. El servidor valida igual (`checkPhotoPayload`): esto es cortesía, no
   * seguridad.
   */
  function pickPhotos(count: number) {
    const input = document.getElementById("post-composer-photos") as HTMLInputElement;
    const files = Array.from(
      { length: count },
      (_, index) => new File([new Uint8Array([index])], `foto-${index}.jpg`, { type: "image/jpeg" }),
    );
    fireEvent.change(input, { target: { files } });
  }

  it("si las fotos horneadas se pasan del total, avisa claro y NO llama a la action", async () => {
    // Cada una entra sola; el problema son las diez juntas.
    bakePhoto.mockImplementation(async () =>
      new File([new Uint8Array(1_100_000)], "horneada.jpg", { type: "image/jpeg" }),
    );
    createPostAction.mockResolvedValue({ ok: true, status: "published" });

    mount();
    await openMenu();
    fireEvent.click(screen.getByText(COPY.composer.createMenu.tiles.photo.title));
    pickPhotos(10);

    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(COPY.composer.publish) }),
    );

    expect(await screen.findByText(COPY.composer.photosTooHeavyTitle)).toBeTruthy();
    expect(screen.getByText(COPY.composer.photosTooHeavyBody)).toBeTruthy();
    expect(createPostAction).not.toHaveBeenCalled();
  });

  it("si UNA foto no se pudo achicar, lo dice por esa foto y no manda nada", async () => {
    bakePhoto.mockImplementation(async () =>
      new File([new Uint8Array(4_000_000)], "sin-achicar.jpg", { type: "image/jpeg" }),
    );
    createPostAction.mockResolvedValue({ ok: true, status: "published" });

    mount();
    await openMenu();
    fireEvent.click(screen.getByText(COPY.composer.createMenu.tiles.photo.title));
    pickPhoto();

    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(COPY.composer.publish) }),
    );

    expect(await screen.findByText(COPY.composer.photoCantShrinkTitle)).toBeTruthy();
    expect(createPostAction).not.toHaveBeenCalled();
  });

  it("si el filtro no se pudo aplicar, reintenta SIN filtro antes de mandar el crudo", async () => {
    // El fallback de `bakePhoto` devuelve el archivo ORIGINAL: en un navegador
    // sin `ctx.filter` eso significaba mandar 5 MB crudos por la server action.
    // Perder el efecto es aceptable; perder la recompresión, no.
    const original = new File([new Uint8Array(3_000_000)], "cruda.jpg", { type: "image/jpeg" });
    const recomprimida = new File([new Uint8Array(300_000)], "recomprimida.jpg", {
      type: "image/jpeg",
    });
    bakePhoto.mockImplementation(
      async (_file: File, options?: { filterCss?: string; onFallback?: (r: string) => void }) => {
        if (options?.filterCss) {
          options.onFallback?.("el navegador no soporta ctx.filter");
          return original;
        }
        return recomprimida;
      },
    );
    createPostAction.mockResolvedValue({ ok: true, status: "published" });

    mount();
    await openMenu();
    fireEvent.click(screen.getByText(COPY.composer.createMenu.tiles.photo.title));
    pickPhoto();

    // Abrir el editor de esa foto y elegir un filtro (sin filtro no hay nada
    // que pueda fallar: `filterCss` viajaría vacío).
    fireEvent.click(await screen.findByRole("button", { name: `${COPY.composer.editPhoto} 1` }));
    // Los chips del carrusel son radios de verdad (`input type="radio"`), no
    // botones: el grupo tiene 16 opciones y las flechas del teclado tienen que
    // moverse entre ellas sin que lo implementemos a mano.
    fireEvent.click(await screen.findByRole("radio", { name: /Cálido/ }));
    fireEvent.click(screen.getByRole("button", { name: COPY.composer.photoEditor.done }));

    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(COPY.composer.publish) }),
    );

    await waitFor(() => expect(createPostAction).toHaveBeenCalledTimes(1));
    expect(bakePhoto).toHaveBeenCalledTimes(2);
    // El stub declara un solo parámetro (`file`), así que las `options` del
    // segundo argumento no están en el tipo de la tupla — se leen a mano.
    const retryOptions = (bakePhoto.mock.calls[1] as unknown[])[1];
    expect(retryOptions).toMatchObject({ filterCss: "" });
    const sent = createPostAction.mock.calls[0]?.[0] as FormData;
    expect((sent.getAll("photos")[0] as File).name).toBe("recomprimida.jpg");
  });

  it("si bakePhoto avisa un fallback, se ve un toast que no bloquea la publicación", async () => {
    const original = new File([new Uint8Array([1])], "original.jpg", { type: "image/jpeg" });
    bakePhoto.mockImplementation(async (_file, options?: { onFallback?: (reason: string) => void }) => {
      options?.onFallback?.("el navegador no soporta ctx.filter");
      return original;
    });
    createPostAction.mockResolvedValue({ ok: true, status: "published" });

    mount();
    await openMenu();
    fireEvent.click(screen.getByText(COPY.composer.createMenu.tiles.photo.title));
    pickPhoto();

    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(COPY.composer.publish) }),
    );

    expect(await screen.findByText(COPY.composer.bakeFallbackTitle)).toBeTruthy();
    await waitFor(() => expect(createPostAction).toHaveBeenCalledTimes(1));
    const sent = createPostAction.mock.calls[0]?.[0] as FormData;
    expect((sent.getAll("photos")[0] as File).name).toBe("original.jpg");
  });
});

/**
 * =============================================================================
 * MÚSICA Y ETIQUETAS, CABLEADAS AL COMPOSER (0089 / 0090)
 * =============================================================================
 *
 * Los dos selectores estaban escritos y NO montados: `tagSlot` y `musicSlot`
 * viajaban sin pasar, así que para quien usa la app las dos features no
 * existían. Lo que este bloque ancla es justamente eso — que estén montadas y
 * que lo elegido llegue a la base con el `postId` recién creado.
 *
 * La secuencia es publicar → guardar, porque las dos referencian un post que
 * antes no existía. Por eso también se ancla que un fallo del segundo paso NO
 * pueda voltear el primero: la publicación ya salió.
 */
describe("PostComposer — música y etiquetas montadas en la hoja", () => {
  const TRACK = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Cumbia del barrio",
    artist: "Los del Sur",
    durationSeconds: 180,
    previewUrl: "https://example.test/cumbia.mp3",
    licenseKind: "cc0" as const,
    attributionRequired: false,
    attributionText: null,
    category: "tropical" as const,
  };

  function pickPhoto() {
    const input = document.getElementById("post-composer-photos") as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "feria.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });
  }

  async function openPhotoComposer() {
    mount();
    await openMenu();
    fireEvent.click(screen.getByText(COPY.composer.createMenu.tiles.photo.title));
    pickPhoto();
    await screen.findByRole("button", { name: new RegExp(COPY.composer.publish) });
  }

  it("con una foto elegida se ven las dos filas: etiquetar y música", async () => {
    await openPhotoComposer();
    expect(screen.getByText(TAGGER_COPY.row.label)).toBeTruthy();
    expect(screen.getByText(MUSIC_COPY.add)).toBeTruthy();
  });

  /**
   * La insignia de la pista y el sonido viven sobre el MEDIO de la publicación:
   * en un texto no habría ni dónde anunciarla ni sobre qué sonar. Etiquetar, en
   * cambio, sí tiene sentido — un texto también puede hablar de alguien.
   */
  it("en modo Texto se puede etiquetar, pero no aparece la música", async () => {
    mount();
    await openMenu();
    fireEvent.click(screen.getByText(COPY.composer.createMenu.tiles.text.title));

    expect(await screen.findByText(TAGGER_COPY.row.label)).toBeTruthy();
    expect(screen.queryByText(MUSIC_COPY.add)).toBeNull();
  });

  it("elegir una canción y publicar la asocia al post recién creado", async () => {
    listMusicTracksAction.mockResolvedValue({ ok: true, tracks: [TRACK] });
    createPostAction.mockResolvedValue({
      ok: true,
      status: "published",
      postId: "22222222-2222-4222-8222-222222222222",
    });

    await openPhotoComposer();

    // Abrir la hoja de música, elegir la pista y confirmar.
    fireEvent.click(screen.getByText(MUSIC_COPY.add));
    fireEvent.click(await screen.findByText(TRACK.title));
    fireEvent.click(screen.getByRole("button", { name: MUSIC_COPY.done }));

    // La fila ya muestra lo elegido: elegir y ver lo elegido son el mismo paso.
    expect(await screen.findByText(TRACK.title)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: new RegExp(COPY.composer.publish) }));

    await waitFor(() => expect(attachPostMusicAction).toHaveBeenCalledTimes(1));
    expect(attachPostMusicAction).toHaveBeenCalledWith({
      postId: "22222222-2222-4222-8222-222222222222",
      trackId: TRACK.id,
      startSeconds: 0,
    });
  });

  it("si la música no se pudo asociar, la publicación igual salió y se avisa", async () => {
    listMusicTracksAction.mockResolvedValue({ ok: true, tracks: [TRACK] });
    attachPostMusicAction.mockResolvedValue({ ok: false, code: "error" });
    createPostAction.mockResolvedValue({
      ok: true,
      status: "published",
      postId: "22222222-2222-4222-8222-222222222222",
    });

    await openPhotoComposer();
    fireEvent.click(screen.getByText(MUSIC_COPY.add));
    fireEvent.click(await screen.findByText(TRACK.title));
    fireEvent.click(screen.getByRole("button", { name: MUSIC_COPY.done }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(COPY.composer.publish) }));

    // Las dos cosas son verdad a la vez y las dos se dicen.
    expect(await screen.findByText(COPY.composer.successTitle)).toBeTruthy();
    expect(await screen.findByText(MUSIC_COPY.attachFailed)).toBeTruthy();
  });

  it("sin música elegida no se llama a la action de música", async () => {
    createPostAction.mockResolvedValue({
      ok: true,
      status: "published",
      postId: "22222222-2222-4222-8222-222222222222",
    });
    await openPhotoComposer();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(COPY.composer.publish) }));

    await waitFor(() => expect(createPostAction).toHaveBeenCalledTimes(1));
    expect(attachPostMusicAction).not.toHaveBeenCalled();
    expect(saveTagsAction).not.toHaveBeenCalled();
  });

  it("etiquetar a alguien y publicar guarda esa etiqueta en el post nuevo", async () => {
    searchTaggableMembersAction.mockResolvedValue({
      ok: true,
      people: [
        { id: "33333333-3333-4333-8333-333333333333", displayName: "Ana Gómez", avatarUrl: null },
      ],
    });
    createPostAction.mockResolvedValue({
      ok: true,
      status: "published",
      postId: "22222222-2222-4222-8222-222222222222",
    });

    await openPhotoComposer();

    fireEvent.click(screen.getByText(TAGGER_COPY.row.label));
    const search = await screen.findByPlaceholderText(TAGGER_COPY.sheet.searchPlaceholder);
    fireEvent.change(search, { target: { value: "ana" } });

    fireEvent.click(
      await screen.findByRole("button", { name: TAGGER_COPY.sheet.add("Ana Gómez") }, { timeout: 3000 }),
    );
    fireEvent.click(screen.getByRole("button", { name: TAGGER_COPY.sheet.done }));

    fireEvent.click(screen.getByRole("button", { name: new RegExp(COPY.composer.publish) }));

    await waitFor(() => expect(saveTagsAction).toHaveBeenCalledTimes(1));
    expect(saveTagsAction).toHaveBeenCalledWith({
      postId: "22222222-2222-4222-8222-222222222222",
      profileIds: ["33333333-3333-4333-8333-333333333333"],
    });
  });
});
