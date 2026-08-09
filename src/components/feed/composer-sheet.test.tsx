// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * HOJA DE COMPOSICIÓN — dos contratos del feedback del cliente (2026-08-05).
 *
 * 1. PUBLICAR SIN TEXTO. "si la persona no quiere subir ningún texto
 *    relacionado, que le deje publicar — porque acá si no pongo algo no me deja
 *    publicar". Con foto o video el pie es opcional; en pregunta y texto el
 *    cuerpo ES la publicación y sigue siendo obligatorio. El mínimo de 2
 *    caracteres sólo aplica a lo que sí se escribió, y es EL MISMO que valida
 *    `createPostAction` (ver actions.test.ts) — si el botón dejara pasar algo
 *    que el servidor rechaza, la persona vería un error sin entender por qué.
 *
 * 2. LA VISTA PREVIA NO SE CORTA. "el fondo cortado": el banner fija su alto en
 *    125% de su ancho, así que a ancho completo pedía ~416px en un teléfono de
 *    375 y el área scrolleable de la hoja —con el teclado abierto— tiene ~215.
 *    Medido en el navegador: 78px de degradado fuera de cuadro. El arreglo
 *    invierte la dependencia (el ancho sale del alto disponible). jsdom no
 *    calcula layout, así que acá se ancla la ESTRUCTURA que lo hace posible;
 *    los números salieron de medir el DOM real.
 */

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

import { ComposerSheet, type ComposerMediaItem, type ComposerSheetProps } from "./composer-sheet";
import { EMPTY_DECLARATION_VALUE } from "@/components/integrity/originality-fields";
import { COPY } from "./copy";

const PHOTO: ComposerMediaItem = { id: "m1", kind: "photo", preview: "blob:foto" };
const VIDEO: ComposerMediaItem = {
  id: "m2",
  kind: "video",
  preview: "blob:video",
  durationSeconds: 30,
};

function mount(overrides: Partial<ComposerSheetProps> = {}) {
  const props: ComposerSheetProps = {
    open: true,
    onClose: vi.fn(),
    mode: "media",
    body: "",
    onBodyChange: vi.fn(),
    media: [],
    canAddPhoto: true,
    canAddVideo: true,
    onAddPhotos: vi.fn(),
    onAddVideo: vi.fn(),
    onRemoveMedia: vi.fn(),
    pollEnabled: false,
    onPollChange: vi.fn(),
    videoCategory: "otros",
    onVideoCategoryChange: vi.fn(),
    declaration: EMPTY_DECLARATION_VALUE,
    onDeclarationChange: vi.fn(),
    previewId: "preview-1",
    uploadPct: null,
    measuringVideo: false,
    isPending: false,
    onPublish: vi.fn(),
    ...overrides,
  };
  render(<ComposerSheet {...props} />);
  return props;
}

/** El botón de Publicar (en pregunta cambia de texto). */
function publishButton(mode: "media" | "text" | "question" = "media"): HTMLButtonElement {
  const name =
    mode === "question" ? COPY.composer.compose.publishQuestion : COPY.composer.publish;
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

afterEach(cleanup);

describe("ComposerSheet — con foto o video el texto es OPCIONAL", () => {
  it("una foto SIN texto ya habilita Publicar", () => {
    mount({ mode: "media", media: [PHOTO], body: "" });
    expect(publishButton().disabled).toBe(false);
  });

  it("un video SIN texto también habilita Publicar", () => {
    mount({ mode: "media", media: [VIDEO], body: "" });
    expect(publishButton().disabled).toBe(false);
  });

  it("publicar una foto sin texto llama a onPublish de verdad", () => {
    const props = mount({ mode: "media", media: [PHOTO], body: "" });
    fireEvent.click(publishButton());
    expect(props.onPublish).toHaveBeenCalledTimes(1);
  });

  it("sin foto NI video sigue apagado: un post kind='post' necesita medio", () => {
    mount({ mode: "media", media: [], body: "" });
    expect(publishButton().disabled).toBe(true);
  });

  it("con foto, un cuerpo de UN carácter apaga el botón (mismo mínimo que el servidor)", () => {
    mount({ mode: "media", media: [PHOTO], body: "a" });
    expect(publishButton().disabled).toBe(true);
  });

  it("con foto y dos caracteres vuelve a encenderse", () => {
    mount({ mode: "media", media: [PHOTO], body: "ok" });
    expect(publishButton().disabled).toBe(false);
  });

  it("un cuerpo de puros espacios cuenta como vacío, no como texto de 3 letras", () => {
    mount({ mode: "media", media: [PHOTO], body: "   " });
    expect(publishButton().disabled).toBe(false);
  });

  it("mientras publica, el botón no acepta un segundo toque", () => {
    mount({ mode: "media", media: [PHOTO], body: "", isPending: true });
    expect(screen.getByRole("button", { name: COPY.composer.publishing }).hasAttribute("disabled")).toBe(true);
  });

  it("el campo avisa que el pie es opcional, sin decir '(opcional)'", () => {
    mount({ mode: "media", media: [PHOTO], body: "" });
    const field = screen.getByLabelText(COPY.composer.compose.mediaPlaceholder(1, false));
    expect(field).toBeTruthy();
    expect(COPY.composer.compose.mediaPlaceholder(1, false)).toMatch(/si querés/);
  });
});

describe("ComposerSheet — en pregunta y texto el cuerpo sigue siendo obligatorio", () => {
  it("un texto vacío no se puede publicar: no hay nada que mandar", () => {
    mount({ mode: "text", body: "" });
    expect(publishButton("text").disabled).toBe(true);
  });

  it("una pregunta vacía tampoco", () => {
    mount({ mode: "question", body: "" });
    expect(publishButton("question").disabled).toBe(true);
  });

  it("un texto con cuerpo publica sin necesitar foto", () => {
    mount({ mode: "text", body: "Abrió la panadería nueva." });
    expect(publishButton("text").disabled).toBe(false);
  });

  it("una pregunta con cuerpo publica sin necesitar foto", () => {
    mount({ mode: "question", body: "¿A qué hora abre la feria?" });
    expect(publishButton("question").disabled).toBe(false);
  });
});

describe("ComposerSheet — la vista previa entra entera en la hoja", () => {
  /**
   * El marco de la vista previa. Se busca por la clase que hace el trabajo
   * porque es EXACTAMENTE lo que se rompió: sin ella el ancho manda y el alto
   * (125% de ese ancho) se sale de la hoja.
   */
  function previewFrame(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[class*="80cqh"]');
  }

  it("el ancho de la vista previa sale del ALTO disponible, no del ancho de la hoja", () => {
    mount({ mode: "text", body: "Abrió la panadería nueva." });
    const frame = previewFrame();
    expect(frame).not.toBeNull();
    // 80% del alto de la región = el ancho cuyo 4:5 entra justo.
    expect(frame?.className).toContain("w-[min(100%,80cqh)]");
    // Sin `max-h-full` el caso raro (texto que ni al 4:5 entra) volvería a
    // desbordar; con él lo que se recorta es texto, nunca el fondo.
    expect(frame?.className).toContain("max-h-full");
  });

  it("la región de la vista previa es un contenedor de tamaño y cede alto", () => {
    mount({ mode: "question", body: "¿A qué hora abre la feria?" });
    const region = document.querySelector<HTMLElement>('[class*="container-type:size"]');
    expect(region).not.toBeNull();
    // `flex-1` para tomar lo que sobra, `min-h-40` como piso en pantallas
    // chicas con el teclado abierto (ahí la hoja scrollea, que sí se resuelve).
    expect(region?.className).toContain("flex-1");
    expect(region?.className).toContain("min-h-40");
  });

  it("el mismo marco aplica a la pregunta y al texto", () => {
    mount({ mode: "question", body: "¿A qué hora abre la feria?" });
    expect(previewFrame()).not.toBeNull();
    cleanup();
    mount({ mode: "text", body: "Abrió la panadería nueva." });
    expect(previewFrame()).not.toBeNull();
  });

  it("antes de escribir no hay marco todavía: sólo la invitación", () => {
    mount({ mode: "text", body: "" });
    expect(previewFrame()).toBeNull();
    expect(screen.getAllByText(COPY.composer.compose.textPlaceholder).length).toBeGreaterThan(0);
  });
});

/**
 * DECLARACIÓN DE ORIGINALIDAD (pliego + 0061). Lo que se ancla acá no es cómo
 * se ve: es que exista donde tiene que existir, que NO exista donde no
 * significa nada, y que plegada siga siendo alcanzable y legible.
 */
describe("ComposerSheet — declaración de originalidad", () => {
  const C = COPY.composer.compose.declaration;

  function disclosure(): HTMLDetailsElement | null {
    return document.querySelector<HTMLDetailsElement>("details");
  }

  it("aparece con una foto, y nombra la foto (no 'el material')", () => {
    mount({ mode: "media", media: [PHOTO] });
    expect(screen.getByText(C.title(1, false))).toBeTruthy();
    expect(C.title(1, false)).toBe("Sobre esta foto");
  });

  it("aparece con un video y lo nombra video", () => {
    mount({ mode: "media", media: [VIDEO] });
    expect(screen.getByText(C.title(0, true))).toBeTruthy();
  });

  it("NO aparece sin archivo: en modo media sin medio no hay nada que declarar", () => {
    mount({ mode: "media", media: [] });
    expect(disclosure()).toBeNull();
  });

  it("NO aparece en una pregunta: no se registra ningún content_asset", () => {
    mount({ mode: "question", body: "¿A qué hora abre la feria?" });
    expect(disclosure()).toBeNull();
  });

  it("NO aparece en un texto, por lo mismo", () => {
    mount({ mode: "text", body: "Abrió la panadería nueva." });
    expect(disclosure()).toBeNull();
  });

  it("arranca PLEGADA: el composer rápido no se convierte en un formulario", () => {
    mount({ mode: "media", media: [PHOTO] });
    expect(disclosure()?.open).toBe(false);
  });

  it("plegada ya dice que es opcional y para qué sirve", () => {
    mount({ mode: "media", media: [PHOTO] });
    expect(screen.getByText(C.hint)).toBeTruthy();
    expect(C.hint.startsWith("Opcional")).toBe(true);
  });

  it("abrirla muestra los cuatro controles reales", () => {
    mount({ mode: "media", media: [PHOTO] });
    const details = disclosure();
    expect(details).not.toBeNull();
    details!.open = true;
    expect(screen.getByRole("checkbox")).toBeTruthy();
    expect(screen.getByRole("combobox")).toBeTruthy();
  });

  it("marcar la casilla propaga la declaración hacia arriba, no la guarda sola", () => {
    const props = mount({ mode: "media", media: [PHOTO] });
    disclosure()!.open = true;
    fireEvent.click(screen.getByRole("checkbox"));
    expect(props.onDeclarationChange).toHaveBeenCalledWith(
      expect.objectContaining({ originalityDeclared: true, licenseKind: "propio" }),
    );
  });

  it("ya declarada, el renglón plegado muestra QUÉ se declaró", () => {
    mount({
      mode: "media",
      media: [PHOTO],
      declaration: {
        originalityDeclared: true,
        licenseKind: "con_permiso",
        licenseStatement: "",
        licenseUrl: "",
      },
    });
    // Se busca DENTRO del renglón plegado: el mismo texto existe además como
    // <option> del selector, que está en el DOM aunque el bloque esté cerrado.
    const summary = document.querySelector("summary");
    expect(summary?.textContent).toContain("Tengo permiso de quien lo hizo");
    expect(summary?.textContent).not.toContain(C.hint);
  });

  it("el descargo que NO se puede suavizar viaja con el bloque", () => {
    mount({ mode: "media", media: [PHOTO] });
    disclosure()!.open = true;
    expect(screen.getByText(/no lo verificamos/)).toBeTruthy();
    expect(screen.getByText(/no equivale a un certificado de propiedad/)).toBeTruthy();
  });

  it("declarar no es requisito para publicar: el botón sigue encendido", () => {
    mount({ mode: "media", media: [PHOTO], body: "" });
    expect(publishButton().disabled).toBe(false);
  });
});
