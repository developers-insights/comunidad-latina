// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_PHOTO_EDIT, PhotoEditPreview, PhotoEditor } from "./photo-editor";
import { COPY } from "./copy";
import { FULL_CROP } from "@/lib/media/photo-crop";
import { MAX_STICKERS, resolveCaptionColor } from "@/lib/media/photo-overlay";

/**
 * EL EDITOR DE FOTOS — recorte, filtros, texto y emojis (pedido del cliente
 * 2026-08-26: "para publicar una foto falta el editor… un crop… unos filtros…
 * texto por encima… y emojis también… los textos pueden cambiar de colores,
 * tipografía").
 *
 * Lo que se ancla acá es el CONTRATO DE SALIDA: qué `PhotoEdit` sale por
 * `onSave`. Es lo único que después lee `bake-photo.ts` para quemar los píxeles,
 * y como el horneado no se puede deshacer, un campo que se pierde en el camino
 * se descubre recién mirando la publicación.
 *
 * La mayor parte del archivo corre con el stage en 0×0, que es lo que da jsdom
 * sin layout, y por eso no toca gestos. El último bloque —"PhotoEditor en un
 * teléfono"— le presta una medida al componente y sí los prueba: es lo que hizo
 * falta para anclar el arreglo del 2026-09-03. La geometría del recorte sigue
 * probada aparte, con números de mano, en `photo-crop.test.ts`.
 */

vi.mock("@/lib/media/video-poster", () => ({
  NEUTRAL_THUMB: "data:image/gif;base64,neutral",
  capturePosterFrame: vi.fn(async () => null),
}));

/**
 * Desde la 0125 la pestaña de emojis monta el picker compartido, que al abrirse
 * pide el catálogo propio con una server action. Acá se devuelve VACÍO, que es
 * el estado real en producción hasta que lleguen los archivos del cliente: con
 * el catálogo vacío la única pestaña del picker son los "Clásicos", que es
 * exactamente lo que este archivo viene testeando desde siempre.
 *
 * Sin el mock, la action intenta leer `cookies()` fuera de un pedido y el test
 * se llena de rechazos sin manejar.
 */
vi.mock("@/lib/emojis/actions", () => ({
  listCommunityEmojisAction: vi.fn(async () => ({ ok: true, emojis: [] })),
}));

// El subrayado de las pestañas del picker se anima con motion: neutralizado,
// el DOM refleja el estado al instante (mismo patrón que comments-sheet.test).
vi.mock("motion/react", async () => (await import("@/test/motion-mock")).motionMock());

afterEach(cleanup);

const C = COPY.composer.photoEditor;

function mount(over: Partial<React.ComponentProps<typeof PhotoEditor>> = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(
    <PhotoEditor
      preview="blob:foto"
      edit={{ ...DEFAULT_PHOTO_EDIT }}
      onSave={onSave}
      onCancel={onCancel}
      {...over}
    />,
  );
  return { onSave, onCancel };
}

const done = () => screen.getByRole("button", { name: C.done });
const tab = (name: string) => screen.getByRole("tab", { name });

describe("PhotoEditor: las cuatro herramientas", () => {
  it("ofrece recorte, filtros, texto y emojis — las cuatro que pidió el cliente", () => {
    mount();
    for (const name of [C.tabCrop, C.tabFilters, C.tabText, C.tabStickers]) {
      expect(tab(name)).toBeTruthy();
    }
  });

  it("abre en Filtros: es a lo que se entraba antes de que existieran las otras dos", () => {
    mount();
    expect(screen.getByRole("tab", { selected: true }).textContent).toContain(C.tabFilters);
  });

  it("un VIDEO no ofrece recorte, texto ni emojis: nada se quema en un video", () => {
    mount({ kind: "video" });
    expect(screen.queryByRole("tab", { name: C.tabCrop })).toBeNull();
    expect(screen.queryByRole("tab", { name: C.tabText })).toBeNull();
    expect(screen.queryByRole("tab", { name: C.tabStickers })).toBeNull();
  });

  it("y lo que guarda un video no arrastra recorte ni emojis de un borrador previo", () => {
    const { onSave } = mount({
      kind: "video",
      edit: {
        ...DEFAULT_PHOTO_EDIT,
        captionText: "algo",
        crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
        stickers: [{ id: "s", emoji: "🔥", x: 0.5, y: 0.5, size: 0.2 }],
      },
    });
    fireEvent.click(done());
    const [edit] = onSave.mock.calls[0];
    expect(edit.captionText).toBe("");
    expect(edit.crop).toEqual(FULL_CROP);
    expect(edit.stickers).toEqual([]);
  });
});

describe("PhotoEditor: recorte", () => {
  it("ofrece las cuatro formas, con 'Vertical' (4:5) que es la de la tarjeta del feed", () => {
    mount();
    fireEvent.click(tab(C.tabCrop));
    for (const label of [C.cropOriginal, C.cropPortrait, C.cropSquare, C.cropWide]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("elegir una forma la deja marcada", () => {
    mount();
    fireEvent.click(tab(C.tabCrop));
    const cuadrada = screen.getByRole("button", { name: C.cropSquare });
    fireEvent.click(cuadrada);
    expect(cuadrada.getAttribute("aria-pressed")).toBe("true");
  });

  it("el zoom tiene un deslizador, no sólo el pellizco: un gesto no es un camino para todos", () => {
    mount();
    fireEvent.click(tab(C.tabCrop));
    expect(screen.getByLabelText(new RegExp(C.cropZoomLabel))).toBeTruthy();
  });

  it("nombra los dos gestos del stage en vez de dejarlos adivinar", () => {
    mount();
    fireEvent.click(tab(C.tabCrop));
    expect(screen.getByText(C.cropHint)).toBeTruthy();
  });

  it("sin tocar nada, lo que se guarda NO marca la foto como recortada", () => {
    // jsdom no hace layout: el stage mide 0 y no hay encuadre que calcular. El
    // recorte de entrada tiene que sobrevivir intacto — abrir y cerrar el
    // editor no puede recortar una foto sola.
    const { onSave } = mount();
    fireEvent.click(done());
    const [edit] = onSave.mock.calls[0];
    expect(edit.crop).toEqual(FULL_CROP);
    expect(edit.cropRatio).toBe(0);
  });
});

describe("PhotoEditor: texto con color y tipografía", () => {
  function escribir(texto: string) {
    fireEvent.click(tab(C.tabText));
    fireEvent.change(screen.getByLabelText(C.textareaLabel), { target: { value: texto } });
  }

  it("los controles de estilo aparecen recién cuando hay algo escrito", () => {
    mount();
    fireEvent.click(tab(C.tabText));
    expect(screen.queryByText(C.colorLabel)).toBeNull();
    escribir("Se vende");
    expect(screen.getByText(C.colorLabel)).toBeTruthy();
    expect(screen.getByText(C.fontLabel)).toBeTruthy();
  });

  it("cada color se elige por NOMBRE, no sólo por su muestra de color", () => {
    // Regla `color-not-only`: quien no distingue los tonos tiene que poder
    // elegir igual, y un lector de pantalla tiene que poder decir cuál es.
    const { onSave } = mount();
    escribir("Se vende");
    fireEvent.click(screen.getByRole("button", { name: resolveCaptionColor("amarillo").label }));
    fireEvent.click(done());
    expect(onSave.mock.calls[0][0].captionColor).toBe("amarillo");
  });

  it("cada tipografía se muestra ESCRITA con su propia letra", () => {
    mount();
    escribir("Se vende");
    const clasica = screen.getByRole("button", { name: "Clásica" });
    expect(clasica.style.fontFamily).toContain("Georgia");
  });

  it("guarda la tipografía elegida", () => {
    const { onSave } = mount();
    escribir("Se vende");
    fireEvent.click(screen.getByRole("button", { name: "Clásica" }));
    fireEvent.click(done());
    expect(onSave.mock.calls[0][0].captionFont).toBe("clasica");
  });

  it("el texto se guarda recortado (trim), como siempre", () => {
    const { onSave } = mount();
    escribir("   Casa en venta   ");
    fireEvent.click(done());
    expect(onSave.mock.calls[0][0].captionText).toBe("Casa en venta");
  });
});

describe("PhotoEditor: emojis", () => {
  const primerEmoji = () => screen.getAllByRole("button", { name: /^Poner .+ sobre la foto$/ })[0];

  it("explica el gesto: tocar para poner, arrastrar para acomodar", () => {
    mount();
    fireEvent.click(tab(C.tabStickers));
    expect(screen.getByText(C.stickersHint)).toBeTruthy();
  });

  it("tocar un emoji lo pone en la foto y lo guarda", () => {
    const { onSave } = mount();
    fireEvent.click(tab(C.tabStickers));
    fireEvent.click(primerEmoji());
    fireEvent.click(done());

    const [edit] = onSave.mock.calls[0];
    expect(edit.stickers).toHaveLength(1);
    // Al centro: es el único lugar que se ve con cualquier recorte.
    expect(edit.stickers[0].x).toBe(0.5);
    expect(edit.stickers[0].y).toBe(0.5);
  });

  it("no deja pasar el cupo, y lo dice donde se tocó (no en un toast lejos)", () => {
    mount();
    fireEvent.click(tab(C.tabStickers));
    const emojis = screen.getAllByRole("button", { name: /^Poner .+ sobre la foto$/ });
    for (let i = 0; i <= MAX_STICKERS; i += 1) fireEvent.click(emojis[i % emojis.length]);
    expect(screen.getByRole("status").textContent).toBe(C.stickerFull);
  });

  it("'Quitar todos' vacía la foto de una", () => {
    const { onSave } = mount();
    fireEvent.click(tab(C.tabStickers));
    fireEvent.click(primerEmoji());
    fireEvent.click(screen.getByRole("button", { name: C.removeAllStickers }));
    fireEvent.click(done());
    expect(onSave.mock.calls[0][0].stickers).toEqual([]);
  });

  it("el emoji recién puesto queda seleccionado, con su tamaño a mano", () => {
    // Quien acaba de poner uno está mirando la foto: el control tiene que estar
    // arriba del catálogo, no escondido al final.
    mount();
    fireEvent.click(tab(C.tabStickers));
    fireEvent.click(primerEmoji());
    expect(screen.getByLabelText(C.stickerSizeLabel)).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(C.removeSticker) })).toBeTruthy();
  });
});

describe("PhotoEditor: Cancelar no guarda nada", () => {
  it("un borrador entero se descarta sin tocar la foto", () => {
    const { onSave, onCancel } = mount();
    fireEvent.click(tab(C.tabStickers));
    fireEvent.click(screen.getAllByRole("button", { name: /^Poner .+ sobre la foto$/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: C.cancel }));

    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

/**
 * =============================================================================
 * EL EDITOR EN UN TELÉFONO — con el stage MEDIDO
 * =============================================================================
 *
 * El resto del archivo prueba el contrato de salida con un stage de 0×0, que es
 * lo que da jsdom sin layout. Acá se le presta uno: un `ResizeObserver` de
 * juguete y un `getBoundingClientRect` fijo alcanzan, porque el componente mide
 * UNA vez con `getBoundingClientRect` antes de observar nada.
 *
 * Con eso se puede probar lo que el cliente reportó el 2026-09-03 y hasta hoy
 * no se testeaba: que el dedo mueva un emoji, que el dedo panee el recorte
 * ("ni con los dedos"), que lo que se toca tenga tamaño de dedo y que el texto
 * se vea del tamaño en que va a salir publicado.
 *
 * Lo que NO se prueba acá es la hoja: que el mismo gesto no arrastre además el
 * `BottomSheet` que envuelve a este panel es un contrato de la hoja, y vive en
 * `src/components/ui/bottom-sheet.test.tsx`.
 */
describe("PhotoEditor en un teléfono: los gestos y el tamaño de lo que se toca", () => {
  /** Lo que va a medir el hueco disponible. Un test lo cambia antes de montar. */
  const hueco = { width: 320, height: 400 };
  const NATURAL = { width: 1600, height: 2000 };

  let rectOriginal: () => DOMRect;

  beforeEach(() => {
    rectOriginal = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function medida() {
      return {
        width: hueco.width,
        height: hueco.height,
        top: 0,
        left: 0,
        right: hueco.width,
        bottom: hueco.height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    };
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    // jsdom no implementa la captura de puntero, y sin ella el `pointerdown`
    // del stage lanza antes de llegar a mover nada.
    Element.prototype.setPointerCapture = function captura() {};
    Element.prototype.releasePointerCapture = function suelta() {};
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = rectOriginal;
    Reflect.deleteProperty(globalThis, "ResizeObserver");
    hueco.width = 320;
    hueco.height = 400;
  });

  /**
   * La foto "carga". En jsdom una `<img>` nunca dispara `load` ni conoce su
   * tamaño natural, y sin tamaño natural el editor no tiene encuadre: ni el
   * arrastre del recorte ni el texto a escala existen.
   *
   * Es la PRIMERA `<img>` del árbol: la vista previa grande se pinta antes que
   * las miniaturas del carrusel de filtros.
   */
  function cargarFoto() {
    const img = document.querySelector("img") as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", { value: NATURAL.width, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: NATURAL.height, configurable: true });
    fireEvent.load(img);
    return img;
  }

  /** El recuadro de la foto: el stage es su hijo absoluto, la `<img>` el nieto. */
  const recuadro = () =>
    (document.querySelector("img") as HTMLImageElement).parentElement
      ?.parentElement as HTMLElement;

  const emojiPuesto = () => screen.getByRole("button", { name: /^Emoji / });

  it("la foto toma el hueco disponible, y lo toma sin deformarse", () => {
    // "El espacio es muy chico para agregar cosas" (Nacho, 2026-09-03). El
    // recuadro se calcula contra el hueco REAL —no contra una fórmula de `vh`
    // que no sabe cuánto gastaron el título, las pestañas y el pie— y el lado
    // que sobra se recorta del ancho, nunca del alto: una caja con la relación
    // rota publica un encuadre que no es el que se vio.
    mount();
    cargarFoto();
    const box = recuadro();
    const ancho = parseFloat(box.style.width);
    const alto = parseFloat(box.style.height);
    expect(ancho).toBeGreaterThan(0);
    expect(alto).toBeGreaterThan(0);
    // 1600×2000 → relación 0.8, y el hueco de 320×400 la deja entrar entera.
    expect(ancho / alto).toBeCloseTo(0.8, 3);
    expect(alto).toBe(400);
  });

  it("el emoji recién puesto se puede agarrar con el dedo (≥44 px) aun en un recuadro bajo", () => {
    // Un 16:9 en un teléfono: 335×188. Con la fracción sola, el emoji nacía de
    // 34 px — abajo del target táctil de toda la interfaz, o sea imposible de
    // agarrar. Es el "aparece un emoji chico" del video del cliente.
    hueco.width = 335;
    hueco.height = 188;
    mount();
    cargarFoto();
    fireEvent.click(tab(C.tabStickers));
    fireEvent.click(screen.getAllByRole("button", { name: /^Poner .+ sobre la foto$/ })[0]);
    expect(parseFloat(emojiPuesto().style.fontSize)).toBeGreaterThanOrEqual(44);
  });

  it("arrastrar el emoji con el dedo lo mueve, y lo movido es lo que se guarda", () => {
    const { onSave } = mount();
    cargarFoto();
    fireEvent.click(tab(C.tabStickers));
    fireEvent.click(screen.getAllByRole("button", { name: /^Poner .+ sobre la foto$/ })[0]);

    const puesto = emojiPuesto();
    fireEvent.pointerDown(puesto, { pointerId: 1, clientX: 160, clientY: 200 });
    fireEvent.pointerMove(puesto, { pointerId: 1, clientX: 224, clientY: 260 });
    fireEvent.pointerUp(puesto, { pointerId: 1 });
    fireEvent.click(done());

    const [edit] = onSave.mock.calls[0];
    // Píxeles arrastrados sobre el recuadro de 320×400: 64/320 y 60/400.
    expect(edit.stickers[0].x).toBeCloseTo(0.7, 5);
    expect(edit.stickers[0].y).toBeCloseTo(0.65, 5);
  });

  it("el recorte se panea con el dedo ('ni con los dedos', dijo el cliente)", () => {
    mount();
    cargarFoto();
    fireEvent.click(tab(C.tabCrop));
    const stage = screen.getByRole("group", { name: C.cropStageLabel });
    // "Centrar de nuevo" sólo existe cuando el encuadre lo movió una persona:
    // es la señal observable de que el gesto llegó.
    expect(screen.queryByRole("button", { name: C.cropReset })).toBeNull();

    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 140, clientY: 100 });
    fireEvent.pointerUp(stage, { pointerId: 1 });

    expect(screen.getByRole("button", { name: C.cropReset })).toBeTruthy();
  });

  it("el texto se ve del tamaño EXACTO en que va a salir publicado", () => {
    // "No se ve bien, no sé ni lo que escribes". Un cuerpo fijo en la vista
    // previa es una mentira en las dos direcciones —grande sobre una foto
    // chica, chico sobre una grande— y lo que se quema no se puede deshacer.
    //
    // De mano: 1600×2000 sin recortar → canvas de 1280×1600 (lado largo topado
    // en 1600), `captionFontSizeFor(1280)` = 64 px sobre 1280 de ancho. En un
    // recuadro de 320 eso son 64 × 320/1280 = 16 px.
    mount();
    cargarFoto();
    fireEvent.click(tab(C.tabText));
    fireEvent.change(screen.getByLabelText(C.textareaLabel), {
      target: { value: "Se vende" },
    });
    expect(screen.getByText("Se vende").style.fontSize).toBe("16px");
  });
});

describe("PhotoEditPreview: la miniatura muestra lo que se va a publicar", () => {
  it("sin recorte pinta la foto como siempre (object-cover, sin caja intermedia)", () => {
    const { container } = render(
      <PhotoEditPreview preview="blob:foto" edit={{ ...DEFAULT_PHOTO_EDIT }} />,
    );
    const img = container.querySelector("img");
    expect(img?.className).toContain("object-cover");
  });

  it("con recorte toma la FORMA del recuadro publicado, no la de la foto", () => {
    // Sin esto la tira del composer mostraría un encuadre que no es el que se
    // va a publicar — y como el recorte se quema, la diferencia se descubre
    // recién viendo la publicación.
    const { container } = render(
      <PhotoEditPreview
        preview="blob:foto"
        edit={{
          ...DEFAULT_PHOTO_EDIT,
          crop: { x: 0, y: 0.25, width: 1, height: 0.5 },
          cropRatio: 16 / 9,
        }}
      />,
    );
    const box = container.firstElementChild as HTMLElement;
    // jsdom normaliza `aspect-ratio: 1.777` a "1.777 / 1".
    expect(box.style.aspectRatio.startsWith(String(16 / 9))).toBe(true);
    const img = container.querySelector("img") as HTMLImageElement;
    // La foto entera se estira a un rectángulo virtual del que la porción
    // elegida cubre exactamente la caja: el mismo mapeo que hace el canvas.
    expect(img.style.height).toBe("200%");
    expect(img.style.top).toBe("-50%");
  });

  it("pinta el texto con su color y su tipografía", () => {
    render(
      <PhotoEditPreview
        preview="blob:foto"
        edit={{
          ...DEFAULT_PHOTO_EDIT,
          captionText: "Se vende",
          captionColor: "amarillo",
          captionFont: "clasica",
        }}
      />,
    );
    const texto = screen.getByText("Se vende");
    expect(texto.style.fontFamily).toContain("Georgia");
    // jsdom normaliza el hex a rgb().
    expect(texto.style.color).toBe("rgb(255, 210, 63)");
  });
});
