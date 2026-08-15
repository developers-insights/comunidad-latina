// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

/**
 * El subrayado de la pestaña activa usa `layoutId` (FLIP entre tabs): motion
 * lo desliza de una posición a la otra. Con prefers-reduced-motion el estado
 * final tiene que ser EL MISMO —el subrayado bajo la pestaña activa—, pero
 * sin la transición de por medio (duration: 0, la receta oficial de motion
 * para respetar reduced motion en layout animations).
 */

function stubMatchMedia(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function mount() {
  return render(
    <Tabs defaultValue="uno">
      <TabsList aria-label="Secciones">
        <TabsTrigger value="uno">Uno</TabsTrigger>
        <TabsTrigger value="dos">Dos</TabsTrigger>
      </TabsList>
      <TabsContent value="uno">Contenido uno</TabsContent>
      <TabsContent value="dos">Contenido dos</TabsContent>
    </Tabs>,
  );
}

afterEach(cleanup);

describe("Tabs: subrayado y prefers-reduced-motion", () => {
  it("sin reduced motion: la pestaña activa sigue marcando aria-selected al cambiar", () => {
    stubMatchMedia(false);
    mount();

    fireEvent.click(screen.getByRole("tab", { name: "Dos" }));

    expect(screen.getByRole("tab", { name: "Uno" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tab", { name: "Dos" }).getAttribute("aria-selected")).toBe("true");
  });

  it("con reduced motion: el cambio de pestaña llega al mismo estado final, sin animación de por medio", () => {
    stubMatchMedia(true);
    mount();

    fireEvent.click(screen.getByRole("tab", { name: "Dos" }));

    // La funcionalidad (qué pestaña quedó activa, qué panel se ve) no cambia
    // con reduced motion — lo único que se va es el desplazamiento del
    // subrayado, no a dónde termina.
    expect(screen.getByRole("tab", { name: "Dos" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Contenido dos")).not.toBeNull();
  });
});
