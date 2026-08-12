// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * =============================================================================
 * EL BLOQUE INTERCALADO APARECE DESPUÉS DEL FEED, NO ANTES
 * =============================================================================
 *
 * El pedido del cliente fue textual: los dos avisos recomendados no pueden ser
 * lo primero que se ve al abrir la app — "eso puede ir después de la quinta
 * publicación más o menos para que cuando abran la app vean el feed al
 * principio y se vea más atractivo".
 *
 * Lo que se prueba acá es la POSICIÓN, que es todo el punto del cambio. Sin
 * este test, cualquier refactor del render de la lista puede devolver el bloque
 * arriba sin que nada se ponga en rojo, y el pedido se pierde en silencio.
 */

// El feed real trae server actions, IntersectionObserver y cards con imágenes;
// nada de eso hace falta para medir dónde cae un bloque en el orden del DOM.
vi.mock("@/app/(app)/feed/load-more", () => ({ fetchFeedPageAction: vi.fn() }));
vi.mock("./post-card", () => ({
  PostCard: ({ post }: { post: { id: string } }) => <article>publicación {post.id}</article>,
}));
vi.mock("@/components/listings", () => ({
  ListingCard: () => <article>aviso</article>,
  decodeCursor: () => null,
}));
vi.mock("./feed-listing-card", () => ({ FeedListingCard: () => <article>aviso</article> }));
vi.mock("./guide-card", () => ({ GuideCard: () => <article>guía</article> }));

import { FeedList, INTERCALADO_DESPUES_DE } from "./feed-list";
import type { FeedItem } from "./helpers";

/** N publicaciones mínimas, con la forma que espera `renderFeedItem`. */
function publicaciones(n: number): FeedItem[] {
  return Array.from({ length: n }, (_, i) => ({
    type: "post" as const,
    id: `p${i + 1}`,
    post: { id: `p${i + 1}` },
  })) as unknown as FeedItem[];
}

function renderFeed(cantidad: number) {
  return render(
    <FeedList
      tab="para-ti"
      tenantId="t1"
      viewerId="u1"
      initialItems={publicaciones(cantidad)}
      initialCursor={null}
      intercalado={<aside data-testid="para-vos">Recomendado para vos</aside>}
    />,
  );
}

/** Posición del nodo en el recorrido del documento. */
function ordenEnDom(nodo: Element): number {
  return [...document.querySelectorAll("article, aside")].indexOf(nodo);
}

afterEach(cleanup);

describe("bloque intercalado en el feed", () => {
  it(`aparece DESPUÉS de la publicación número ${INTERCALADO_DESPUES_DE}, no al principio`, () => {
    renderFeed(8);

    const bloque = screen.getByTestId("para-vos");
    const publicacionesEnDom = screen.getAllByText(/^publicación /);

    // La quinta ya se vio; la sexta todavía no.
    expect(ordenEnDom(bloque)).toBeGreaterThan(
      ordenEnDom(publicacionesEnDom[INTERCALADO_DESPUES_DE - 1]),
    );
    expect(ordenEnDom(bloque)).toBeLessThan(
      ordenEnDom(publicacionesEnDom[INTERCALADO_DESPUES_DE]),
    );
  });

  it("nunca es lo primero de la lista", () => {
    renderFeed(8);
    const primero = document.querySelectorAll("article, aside")[0];
    expect(primero?.getAttribute("data-testid")).not.toBe("para-vos");
  });

  it("si el feed es más corto que el corte, el bloque no se fuerza al final", () => {
    // Empujarlo al final de una lista de tres lo devolvería a ser lo único que
    // se ve, que es justo lo que el cambio vino a evitar.
    renderFeed(3);
    expect(screen.queryByTestId("para-vos")).toBeNull();
  });

  it("sin bloque, el feed se renderiza igual", () => {
    render(
      <FeedList
        tab="para-ti"
        tenantId="t1"
        viewerId="u1"
        initialItems={publicaciones(6)}
        initialCursor={null}
      />,
    );
    expect(screen.getAllByText(/^publicación /)).toHaveLength(6);
    expect(screen.queryByTestId("para-vos")).toBeNull();
  });
});
