// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CreatorRequirementsCard } from "./requirements-card";
import { computeCreatorRequirements } from "./requirements";

/**
 * La regla que estos tests protegen: NUNCA un "no calificás" mudo.
 *
 * Es una decisión de producto, no de estilo — ese cartel es el que hace que
 * alguien que recién empieza cierre la app. Si un refactor reemplaza las
 * barras por un sí/no, estos tests se caen.
 */

const NOW = new Date("2026-07-30T12:00:00.000Z");

function renderFor(input: Parameters<typeof computeCreatorRequirements>[0]) {
  return render(<CreatorRequirementsCard result={computeCreatorRequirements(input)} />);
}

describe("CreatorRequirementsCard", () => {
  afterEach(cleanup);

  it("muestra cuánto falta en cada requisito, con el número exacto", () => {
    renderFor({
      followers: 820,
      videos: 12,
      views: 31_000,
      accountCreatedAt: new Date(NOW.getTime() - 40 * 86_400_000).toISOString(),
      now: NOW,
    });
    // Contra el texto completo: la frase convive en el mismo <p> con la
    // explicación del requisito, así que un getByText exacto no la ve.
    const texto = document.body.textContent ?? "";
    expect(texto).toContain("Te faltan 180 seguidores");
    expect(texto).toContain("Te faltan 8 videos");
    expect(texto).toContain("Te faltan 19,000 vistas");
    expect(texto).toContain("Te faltan 50 días");
    // Y el valor actual sobre el objetivo, para no depender sólo de la barra.
    expect(texto).toContain("820 de 1,000");
  });

  it("nunca dice 'no calificás' ni equivalentes", () => {
    renderFor({ followers: 10, videos: 1, views: 5, accountCreatedAt: NOW.toISOString(), now: NOW });
    const texto = document.body.textContent?.toLowerCase() ?? "";
    for (const frase of ["no calificás", "no calificas", "no cumplís", "rechazado", "no apto"]) {
      expect(texto).not.toContain(frase);
    }
  });

  it("da una barra de progreso por requisito, con su valor en el nombre accesible", () => {
    renderFor({
      followers: 820,
      videos: 12,
      views: 31_000,
      accountCreatedAt: new Date(NOW.getTime() - 40 * 86_400_000).toISOString(),
      now: NOW,
    });
    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(5);
    // El estado no se comunica sólo con color: el lector de pantalla escucha
    // el mismo número que se ve.
    const followersBar = bars.find((bar) =>
      bar.getAttribute("aria-label")?.startsWith("Seguidores"),
    );
    expect(followersBar?.getAttribute("aria-label")).toContain("820 de 1,000");
    expect(followersBar?.getAttribute("aria-valuenow")).toBe("82");
  });

  it("un dato no medido dice 'todavía no lo medimos', no 0", () => {
    renderFor({ followers: 1_200, videos: 25, views: 61_000, accountCreatedAt: "2026-01-01", now: NOW });
    expect(screen.getByText("Todavía no lo medimos")).toBeTruthy();
    // Y aclara que eso no frena a nadie.
    expect(document.body.textContent).toContain("No te frena");
  });

  it("cuenta sólo los requisitos medibles en el marcador", () => {
    renderFor({ followers: 1_200, videos: 25, views: 61_000, accountCreatedAt: "2026-01-01", now: NOW });
    expect(screen.getByText("4 de 4 cumplidos")).toBeTruthy();
  });

  it("cuando cumple todo, lo dice sin ambigüedad", () => {
    renderFor({ followers: 1_200, videos: 25, views: 61_000, accountCreatedAt: "2026-01-01", now: NOW });
    expect(document.body.textContent).toContain("los negocios ya te pueden proponer trabajos");
  });

  it("explica por qué existen los requisitos, sin ocupar la pantalla", () => {
    renderFor({ followers: 10, videos: 1, views: 5, accountCreatedAt: NOW.toISOString(), now: NOW });
    // En un <details>: está disponible, pero plegado.
    const summary = screen.getByText("¿Por qué hay requisitos?");
    expect(summary.closest("details")?.hasAttribute("open")).toBe(false);
  });
});
