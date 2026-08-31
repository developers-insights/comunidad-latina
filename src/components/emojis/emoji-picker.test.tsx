// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CommunityEmoji } from "@/lib/emojis/catalog";
import { EmojiPicker } from "./emoji-picker";

/**
 * EL PICKER COMPARTIDO (0125).
 *
 * Se testean las tres cosas que, si se rompen, no se ven rompiéndose:
 *
 *  1. QUE SÓLO LA CATEGORÍA ACTIVA ESTÉ EN EL DOM. Es la promesa de
 *     rendimiento entera —60 imágenes no se cargan de golpe— y si un día
 *     alguien cambia las pestañas por un acordeón, la app sigue funcionando y
 *     nadie se entera hasta que el picker tarda tres segundos en abrir.
 *  2. QUE CADA EMOJI TENGA NOMBRE ACCESIBLE con el label Y la descripción. Sin
 *     esto el picker es una grilla de botones sin nombre, y eso tampoco se ve.
 *  3. QUE EL ESTADO VACÍO DIGA ALGO. Un catálogo sin cargar es el estado normal
 *     de esta feature hasta que lleguen los archivos del cliente.
 */

function emoji(over: Partial<CommunityEmoji> = {}): CommunityEmoji {
  return {
    id: "e-1",
    slug: "klk",
    label: "KLK",
    alt: "Saludo con la mano en alto",
    url: "https://cdn.test/klk.png",
    category: "saludos",
    scope: "global",
    ...over,
  };
}

const CLASICOS = [{ label: "Caras", emojis: ["😀", "😎"] as const }];

afterEach(cleanup);

describe("EmojiPicker — catálogo cargado", () => {
  const emojis = [
    emoji(),
    emoji({ id: "e-2", slug: "empanada", label: "EMPANADA", alt: "Una empanada dorada", category: "comida" }),
  ];

  function renderReady(props: Partial<React.ComponentProps<typeof EmojiPicker>> = {}) {
    const onPickCommunity = vi.fn();
    const { container } = render(
      <EmojiPicker
        community={{ status: "ready", emojis }}
        onRetry={vi.fn()}
        onPickCommunity={onPickCommunity}
        {...props}
      />,
    );
    // Los dibujos van con `alt=""` + `aria-hidden` a propósito (el nombre lo
    // pone el botón), así que NO tienen rol "img": se cuentan por etiqueta.
    const imagenes = () => Array.from(container.querySelectorAll("img"));
    return { onPickCommunity, imagenes };
  }

  it("una pestaña por categoría con contenido, y ninguna vacía", () => {
    renderReady();
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["Saludos", "Comida"]);
  });

  it("SÓLO la categoría activa está en el DOM: es la promesa de rendimiento", () => {
    const { imagenes } = renderReady();
    expect(screen.getByRole("button", { name: /KLK/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /EMPANADA/ })).toBeNull();
    // Y por lo tanto una sola imagen pedida, no las dos.
    expect(imagenes()).toHaveLength(1);
    expect(imagenes()[0]!.getAttribute("src")).toBe("https://cdn.test/klk.png");
  });

  it("cambiar de pestaña monta la otra y desmonta la primera", async () => {
    renderReady();
    fireEvent.click(screen.getByRole("tab", { name: "Comida" }));
    expect(screen.getByRole("button", { name: /EMPANADA/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /KLK/ })).toBeNull();
  });

  it("el nombre accesible lleva el NOMBRE y la DESCRIPCIÓN del dibujo", () => {
    renderReady();
    expect(
      screen.getByRole("button", { name: "Agregar KLK: Saludo con la mano en alto" }),
    ).toBeTruthy();
  });

  it("la imagen no repite el alt: el botón ya lo dice y se leería dos veces", () => {
    const { imagenes } = renderReady();
    const boton = screen.getByRole("button", { name: /KLK/ });
    expect(boton.contains(imagenes()[0]!)).toBe(true);
    expect(imagenes()[0]!.getAttribute("alt")).toBe("");
    expect(imagenes()[0]!.getAttribute("aria-hidden")).toBe("true");
  });

  it("las imágenes van con carga diferida y medida fija (sin salto de layout)", () => {
    const { imagenes } = renderReady();
    const img = imagenes()[0]!;
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("width")).toBe("512");
    expect(img.getAttribute("height")).toBe("512");
  });

  it("elegir un emoji lo devuelve entero, con su URL y su alt", async () => {
    const { onPickCommunity } = renderReady();
    fireEvent.click(screen.getByRole("button", { name: /KLK/ }));
    expect(onPickCommunity).toHaveBeenCalledWith(emojis[0]);
  });

  it("el buscador filtra sin tildes y sin importar la categoría", async () => {
    renderReady();
    fireEvent.change(screen.getByLabelText("Buscar un emoji"), { target: { value: "empanada" } });
    expect(await screen.findByRole("button", { name: /EMPANADA/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /KLK/ })).toBeNull();
    // Buscar es no saber en qué pestaña está: mientras se busca no hay pestañas.
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("sin resultados lo dice, no deja la grilla en blanco", async () => {
    renderReady();
    fireEvent.change(screen.getByLabelText("Buscar un emoji"), { target: { value: "zzz" } });
    expect(await screen.findByText(/No encontramos ningún emoji/)).toBeTruthy();
  });

  it("los clásicos son UNA pestaña más, al final, y funcionan", async () => {
    const onPickUnicode = vi.fn();
    renderReady({ unicodeGroups: CLASICOS, onPickUnicode });
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["Saludos", "Comida", "Clásicos"]);

    fireEvent.click(screen.getByRole("tab", { name: "Clásicos" }));
    fireEvent.click(screen.getByRole("button", { name: "😎" }));
    expect(onPickUnicode).toHaveBeenCalledWith("😎");
  });
});

describe("EmojiPicker — el catálogo llega DESPUÉS de abrir", () => {
  /**
   * Regresión: con `defaultValue` en las pestañas, abrir el picker antes de que
   * el catálogo aterrizara dejaba "Clásicos" fijado. La pestaña de la comunidad
   * aparecía después, sin seleccionar — o sea, los emojis que el cliente pidió
   * quedaban escondidos detrás de los de siempre, y la pantalla se veía bien.
   */
  it("cuando aterriza, la pestaña de la comunidad pasa a ser la activa", () => {
    const emojis = [emoji()];
    const { rerender } = render(
      <EmojiPicker
        community={{ status: "loading" }}
        onRetry={vi.fn()}
        onPickCommunity={vi.fn()}
        unicodeGroups={CLASICOS}
        onPickUnicode={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Clásicos"]);

    rerender(
      <EmojiPicker
        community={{ status: "ready", emojis }}
        onRetry={vi.fn()}
        onPickCommunity={vi.fn()}
        unicodeGroups={CLASICOS}
        onPickUnicode={vi.fn()}
      />,
    );
    expect(screen.getByRole("tab", { name: "Saludos" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: /Agregar KLK/ })).toBeTruthy();
  });

  it("pero si la persona ya eligió una pestaña, no se la cambiamos por debajo", () => {
    const { rerender } = render(
      <EmojiPicker
        community={{ status: "loading" }}
        onRetry={vi.fn()}
        onPickCommunity={vi.fn()}
        unicodeGroups={CLASICOS}
        onPickUnicode={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Clásicos" }));

    rerender(
      <EmojiPicker
        community={{ status: "ready", emojis: [emoji()] }}
        onRetry={vi.fn()}
        onPickCommunity={vi.fn()}
        unicodeGroups={CLASICOS}
        onPickUnicode={vi.fn()}
      />,
    );
    expect(screen.getByRole("tab", { name: "Clásicos" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("EmojiPicker — cuando todavía no hay catálogo", () => {
  it("el vacío se dice con todas las letras y ofrece los clásicos", () => {
    render(
      <EmojiPicker
        community={{ status: "ready", emojis: [] }}
        onRetry={vi.fn()}
        onPickCommunity={vi.fn()}
        unicodeGroups={CLASICOS}
        onPickUnicode={vi.fn()}
      />,
    );
    expect(screen.getByText("Todavía no tenemos los emojis nuestros")).toBeTruthy();
    expect(screen.getByText(/podés usar los clásicos/)).toBeTruthy();
    // Y los clásicos se pueden usar igual: la pestaña está y es la única.
    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });

  it("sin clásicos tampoco promete lo que no puede dar", () => {
    render(
      <EmojiPicker community={{ status: "ready", emojis: [] }} onRetry={vi.fn()} onPickCommunity={vi.fn()} />,
    );
    expect(screen.getByText(/apenas estén listos/)).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("una sesión vencida no ofrece reintentar: reintentar no la arregla", () => {
    render(
      <EmojiPicker
        community={{ status: "error", code: "unauthenticated" }}
        onRetry={vi.fn()}
        onPickCommunity={vi.fn()}
      />,
    );
    expect(screen.getByText(/Entrá a tu cuenta/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  it("un fallo de red sí ofrece reintentar", async () => {
    const onRetry = vi.fn();
    render(
      <EmojiPicker community={{ status: "error", code: "error" }} onRetry={onRetry} onPickCommunity={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("mientras carga avisa a quien no ve la pantalla", () => {
    const { container } = render(
      <EmojiPicker community={{ status: "loading" }} onRetry={vi.fn()} onPickCommunity={vi.fn()} />,
    );
    const region = container.querySelector('[aria-live="polite"]');
    expect(region?.textContent).toBe("Buscando los emojis…");
    // Y NO como `role="status"`: la pantalla que monta el picker puede tener la
    // suya (el editor de fotos avisa ahí el cupo lleno de emojis).
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(region?.getAttribute("aria-atomic")).toBe("true");
  });
});
