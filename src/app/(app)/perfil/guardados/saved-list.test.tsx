// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SavedList } from "./saved-list";
import type { PostTile } from "../post-tiles";
import type { SavedItem, SavedListingTile } from "./saved-tile";

/**
 * Vista de "Guardados": estado vacío cálido + fila de post + fila de listing +
 * paginación. Datos ya resueltos por props (la query server-only no se testea
 * acá, igual que ProfilePostsGrid). Sin matchers de jest-dom a propósito —
 * mismo estilo (DOM crudo) que post-actions.test.tsx: este proyecto no lo
 * registra globalmente en vitest.config.ts.
 */

afterEach(cleanup);

function postTile(overrides: Partial<PostTile> = {}): PostTile {
  return {
    id: "post-1",
    tileKind: "text",
    mediaUrl: null,
    text: "Che, alguien alquila cuartos por Corona?",
    isQuestion: false,
    ...overrides,
  };
}

function listingTile(overrides: Partial<SavedListingTile> = {}): SavedListingTile {
  const id = overrides.id ?? "listing-1";
  return {
    id,
    kind: "property",
    href: `/propiedades/${id}`,
    kindLabel: "Vivienda",
    title: "Depto 2 ambientes en Queens",
    priceLabel: "$1,500/mes",
    areaLabel: "Queens",
    photoUrl: null,
    ...overrides,
  };
}

describe("SavedList — estado vacío", () => {
  it("explica qué es guardar y cómo hacerlo, sin decir 'no hay elementos'", () => {
    render(<SavedList items={[]} nextHref={null} />);
    expect(screen.getByText("Todavía no guardaste nada")).toBeTruthy();
    expect(screen.getByText(/tocá el marcador/i)).toBeTruthy();
    expect(screen.queryByText(/no hay elementos/i)).toBeNull();
  });

  it("no muestra 'Ver más' cuando no hay ítems", () => {
    render(<SavedList items={[]} nextHref={null} />);
    expect(screen.queryByRole("link", { name: /ver más/i })).toBeNull();
  });
});

describe("SavedList — ítems", () => {
  it("una publicación guardada linkea a /feed/:id con su texto", () => {
    const items: SavedItem[] = [{ key: "s1", subjectKind: "post", post: postTile() }];
    render(<SavedList items={items} nextHref={null} />);
    const link = screen.getByRole("link", {
      name: "Che, alguien alquila cuartos por Corona?",
    });
    expect(link.getAttribute("href")).toBe("/feed/post-1");
  });

  it("una pregunta sin cuerpo cae al rótulo de pregunta, no a un título vacío", () => {
    const items: SavedItem[] = [
      { key: "s1", subjectKind: "post", post: postTile({ text: "", isQuestion: true }) },
    ];
    render(<SavedList items={items} nextHref={null} />);
    expect(screen.getByRole("link", { name: "Pregunta a la comunidad" })).toBeTruthy();
  });

  it("un aviso guardado linkea a su ruta de detalle con precio y zona en la meta", () => {
    const items: SavedItem[] = [{ key: "s2", subjectKind: "listing", listing: listingTile() }];
    render(<SavedList items={items} nextHref={null} />);
    const link = screen.getByRole("link", {
      name: "Depto 2 ambientes en Queens, $1,500/mes, Queens",
    });
    expect(link.getAttribute("href")).toBe("/propiedades/listing-1");
    expect(screen.getByText("Vivienda · $1,500/mes")).toBeTruthy();
  });

  it("un aviso de empleo linkea a /empleos/:id y su meta muestra el rubro", () => {
    const items: SavedItem[] = [
      {
        key: "s3",
        subjectKind: "listing",
        listing: listingTile({
          id: "job-1",
          kind: "job",
          href: "/empleos/job-1",
          kindLabel: "Empleo",
          title: "Ayudante de cocina",
          priceLabel: null,
          areaLabel: "Bronx",
        }),
      },
    ];
    render(<SavedList items={items} nextHref={null} />);
    const link = screen.getByRole("link", { name: "Ayudante de cocina, Bronx" });
    expect(link.getAttribute("href")).toBe("/empleos/job-1");
    expect(screen.getByText("Empleo · Bronx")).toBeTruthy();
  });

  it("mezcla posts y listings en el orden recibido (más nuevo primero, ya ordenado por el caller)", () => {
    const items: SavedItem[] = [
      { key: "s1", subjectKind: "post", post: postTile({ id: "post-a" }) },
      { key: "s2", subjectKind: "listing", listing: listingTile({ id: "listing-a" }) },
    ];
    render(<SavedList items={items} nextHref={null} />);
    const links = screen.getAllByRole("link");
    expect(links[0].getAttribute("href")).toBe("/feed/post-a");
    expect(links[1].getAttribute("href")).toBe("/propiedades/listing-a");
  });

  it("muestra 'Ver más' solo cuando hay siguiente página, con el href del cursor", () => {
    const items: SavedItem[] = [{ key: "s1", subjectKind: "post", post: postTile() }];
    render(<SavedList items={items} nextHref="/perfil/guardados?cursor=abc" />);
    const loadMore = screen.getByRole("link", { name: /ver más/i });
    expect(loadMore.getAttribute("href")).toBe("/perfil/guardados?cursor=abc");
  });
});
