// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// Una de las diapositivas mezcla un video: CardVideo llama useRouter() aunque
// esta suite no navegue a ningún lado.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/feed",
}));

import { MediaCarousel } from "./media-carousel";
import type { PostMediaView } from "./helpers";

/**
 * Auditoría accesibilidad 2026-08: la FOTO de un post es la pieza protagonista
 * de la card (no una miniatura de listado con título al lado), así que no
 * puede quedar con el `alt=""` decorativo por default de CardMedia — sería
 * invisible para un lector de pantalla. Acá se fija que MediaCarousel le pasa
 * SIEMPRE un `alt` con sentido: genérico con una sola foto, con la cuenta
 * cuando hay varias (misma frase que ya lee el aria-label de la diapositiva).
 */

function noop() {}

afterEach(cleanup);

describe("MediaCarousel: alt de la foto", () => {
  it("con una sola foto usa un texto genérico cálido, no el default vacío", () => {
    const items: PostMediaView[] = [{ kind: "image", url: "https://cdn.example.com/foto.jpg" }];
    render(
      <MediaCarousel
        items={items}
        index={0}
        onIndexChange={noop}
        postId="post-1"
        authorName="Valeria"
        videoScope="sin-reel"
        onPhotoTap={noop}
        onPhotoDoubleTap={noop}
      />,
    );

    const img = screen.getByRole("img");
    expect(img.getAttribute("alt")).toBe("Foto de la publicación");
  });

  it("con varias fotos, el alt cuenta la posición — no queda vacío en ninguna diapositiva", () => {
    const items: PostMediaView[] = [
      { kind: "image", url: "https://cdn.example.com/1.jpg" },
      { kind: "image", url: "https://cdn.example.com/2.jpg" },
      { kind: "image", url: "https://cdn.example.com/3.jpg" },
    ];
    render(
      <MediaCarousel
        items={items}
        index={0}
        onIndexChange={noop}
        postId="post-1"
        authorName="Valeria"
        videoScope="sin-reel"
        onPhotoTap={noop}
        onPhotoDoubleTap={noop}
      />,
    );

    const alts = screen.getAllByRole("img").map((img) => img.getAttribute("alt"));
    expect(alts).toEqual(["Foto 1 de 3", "Foto 2 de 3", "Foto 3 de 3"]);
  });

  it("un video mezclado con fotos no le pisa el alt a la foto vecina", () => {
    const items: PostMediaView[] = [
      { kind: "video", url: "https://cdn.example.com/v.mp4" },
      { kind: "image", url: "https://cdn.example.com/1.jpg" },
    ];
    render(
      <MediaCarousel
        items={items}
        index={0}
        onIndexChange={noop}
        postId="post-1"
        authorName="Valeria"
        videoScope="sin-reel"
        onPhotoTap={noop}
        onPhotoDoubleTap={noop}
      />,
    );

    // La única <img> real del carrusel es la foto en la posición 2 de 2 —
    // el video se dibuja con <video>, no con CardMedia.
    const img = screen.getByRole("img");
    expect(img.getAttribute("alt")).toBe("Foto 2 de 2");
  });
});
