// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CardPostMedia } from "./card-post-media";
import type { PostMediaView } from "./helpers";

/**
 * El contador "×N" sobre la foto promete cuántos medios hay detrás del toque.
 * Como el visor pasa fotos Y videos, tiene que contarlos a TODOS: antes sólo
 * contaba fotos y un post con 2 fotos + 1 video decía "2".
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/feed",
}));

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

const PHOTO = (n: number): PostMediaView => ({
  kind: "image",
  url: `https://cdn.example.com/foto-${n}.webp`,
});
const VIDEO = (n: number): PostMediaView => ({
  kind: "video",
  url: `https://cdn.example.com/clip-${n}.mp4`,
});

function renderMedia(media: PostMediaView[]) {
  return render(
    <CardPostMedia
      postId="11111111-1111-4111-8111-111111111111"
      authorName="María Peralta"
      media={media}
      photoUrl={null}
      isPromoted={false}
      entity={null}
      videoScope="para-ti"
    />,
  );
}

/** El badge es el único texto puramente numérico sobre la foto. */
function badgeText(container: HTMLElement): string | null {
  const badge = container.querySelector("span[aria-hidden='true']");
  return badge?.textContent?.trim() ?? null;
}

afterEach(() => cleanup());

describe("CardPostMedia: contador de medios", () => {
  it("cuenta fotos Y videos, no sólo fotos", () => {
    const { container } = renderMedia([PHOTO(1), PHOTO(2), VIDEO(1)]);
    expect(badgeText(container)).toBe("3");
  });

  it("con una sola foto no hay contador (nada que prometer)", () => {
    const { container } = renderMedia([PHOTO(1)]);
    expect(badgeText(container)).toBeNull();
  });

  it("una foto + un video ya cuentan como 2", () => {
    const { container } = renderMedia([PHOTO(1), VIDEO(1)]);
    expect(badgeText(container)).toBe("2");
  });
});

describe("CardPostMedia: manda la primera pieza", () => {
  it("foto primera → galería (el toque abre el visor, no el reel)", () => {
    renderMedia([PHOTO(1), VIDEO(1)]);
    expect(screen.queryByRole("button", { name: /ver el video/i })).toBeNull();
    expect(screen.getByRole("button", { name: /ver la foto en grande/i })).toBeTruthy();
  });

  it("video primero → card de video (el toque va al reel)", () => {
    renderMedia([VIDEO(1), PHOTO(1)]);
    expect(screen.getByRole("button", { name: /ver el video/i })).toBeTruthy();
  });

  it("sin medios no renderiza nada", () => {
    const { container } = renderMedia([]);
    expect(container.firstChild).toBeNull();
  });
});
