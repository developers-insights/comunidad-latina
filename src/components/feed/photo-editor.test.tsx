// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
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
 * Lo que NO se testea acá es el arrastre real: jsdom no hace layout, así que el
 * stage siempre mide 0 y no hay gesto que simular con sentido. La geometría del
 * recorte está probada aparte, con números de mano, en `photo-crop.test.ts`.
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
