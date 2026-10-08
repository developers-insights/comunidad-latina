// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { resetAudioChannelForTests } from "@/lib/media/audio-channel";
import { installFakeMedia } from "@/components/video/fake-media";
import { PostMusicProvider, PostMusicSpeaker } from "./post-music";
import { ViewerVideo } from "./media-viewer";
import type { PostMusicView } from "./helpers";

vi.mock("motion/react", async () =>
  (await import("@/test/motion-mock")).motionMock({ reducedMotion: false }),
);

function music(id: string): PostMusicView {
  return {
    startSeconds: 0,
    track: {
      id,
      title: `Tema ${id}`,
      artist: "Los del Sur",
      durationSeconds: 120,
      previewUrl: `https://cdn.example.com/${id}.mp3`,
      licenseKind: "cc0",
      attributionRequired: false,
      attributionText: null,
      category: "tropical",
    },
  };
}

function Post({ id }: { id: string }) {
  return (
    <section data-testid={id}>
      <PostMusicProvider music={music(id)} hasVideo={false}>
        <PostMusicSpeaker />
      </PostMusicProvider>
    </section>
  );
}

function FullscreenVideo() {
  const [muted, setMuted] = useState(false);
  return (
    <section data-testid="visor">
      <ViewerVideo
        url="https://cdn.example.com/clip.mp4"
        active
        muted={muted}
        onMutedChange={setMuted}
      />
    </section>
  );
}

function speaker(postId: string) {
  return within(screen.getByTestId(postId)).getByRole("button");
}

function audioOf(postId: string) {
  return screen.getByTestId(postId).querySelector("audio") as HTMLAudioElement;
}

let media: ReturnType<typeof installFakeMedia>;

beforeEach(() => {
  media = installFakeMedia();
});

afterEach(() => {
  cleanup();
  media.restore();
  resetAudioChannelForTests();
});

describe("canal de audio del feed: dos fuentes, una sola suena", () => {
  it("activar la música de una publicación pausa la de la otra", () => {
    render(
      <>
        <Post id="uno" />
        <Post id="dos" />
      </>,
    );

    fireEvent.click(speaker("uno"));
    expect(media.isSounding(audioOf("uno"))).toBe(true);
    expect(speaker("uno").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(speaker("dos"));

    expect(media.isSounding(audioOf("dos"))).toBe(true);
    expect(media.isSounding(audioOf("uno"))).toBe(false);
    expect(speaker("uno").getAttribute("aria-pressed")).toBe("false");
    expect(speaker("dos").getAttribute("aria-pressed")).toBe("true");
  });

  it("un video con sonido silencia la música, y volver a pedir la música mutea el video", () => {
    render(
      <>
        <Post id="uno" />
        <FullscreenVideo />
      </>,
    );
    const video = screen.getByTestId("visor").querySelector("video") as HTMLVideoElement;
    expect(media.isSounding(video)).toBe(true);

    fireEvent.click(speaker("uno"));
    expect(media.isSounding(audioOf("uno"))).toBe(true);
    expect(media.isSounding(video)).toBe(false);
    expect(
      within(screen.getByTestId("visor"))
        .getByRole("button", { name: "Activar sonido" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("silenciar a mano libera el canal sin tocar a la otra publicación", () => {
    render(
      <>
        <Post id="uno" />
        <Post id="dos" />
      </>,
    );
    fireEvent.click(speaker("uno"));
    fireEvent.click(speaker("uno"));

    expect(media.isSounding(audioOf("uno"))).toBe(false);
    expect(speaker("dos").getAttribute("aria-pressed")).toBe("false");
  });
});
