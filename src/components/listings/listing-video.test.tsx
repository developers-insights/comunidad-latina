// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ListingVideoMedia } from "./listing-video";

const corto = {
  url: "https://x.supabase.co/storage/v1/object/public/post-media/t/u/v.mp4",
  posterUrl: null,
  durationSeconds: 40,
  fullVideoHref: null,
};

const largo = { ...corto, durationSeconds: 200, fullVideoHref: "/videos/largos/aviso/abc" };

function llegarA(segundos: number) {
  const video = document.querySelector("video") as HTMLVideoElement;
  Object.defineProperty(video, "currentTime", { value: segundos, writable: true, configurable: true });
  fireEvent.timeUpdate(video);
  return video;
}

describe("ListingVideoMedia", () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("muestra cuánto dura el video", () => {
    render(<ListingVideoMedia video={largo} title="Depto" />);
    expect(screen.getByText("3:20")).toBeTruthy();
  });

  it("un video largo se frena a los 90 s y ofrece verlo completo", () => {
    render(<ListingVideoMedia video={largo} title="Depto" />);
    expect(screen.queryByRole("link", { name: /video completo/i })).toBeNull();
    llegarA(90);
    const link = screen.getByRole("link", { name: /video completo/i });
    expect(link.getAttribute("href")).toBe("/videos/largos/aviso/abc");
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it("un video sin sección de largos vuelve a empezar a los 90 s", () => {
    render(<ListingVideoMedia video={{ ...largo, fullVideoHref: null }} title="Depto" />);
    const video = llegarA(95);
    expect(video.currentTime).toBe(0);
    expect(screen.queryByRole("link", { name: /video completo/i })).toBeNull();
  });

  it("tocar el video llama a onOpen", () => {
    const onOpen = vi.fn();
    render(<ListingVideoMedia video={corto} title="Depto" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Ver el video de Depto" }));
    expect(onOpen).toHaveBeenCalled();
  });
});
