// @vitest-environment jsdom
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import {
  getAudioOwner,
  holdAudio,
  resetAudioChannelForTests,
} from "@/lib/media/audio-channel";
import { installFakeMedia } from "./fake-media";
import { useAudioChannelSource } from "./use-audio-channel";

let media: ReturnType<typeof installFakeMedia>;

beforeEach(() => {
  media = installFakeMedia();
});

afterEach(() => {
  cleanup();
  media.restore();
  resetAudioChannelForTests();
});

function Source({
  id,
  kind,
  onPreempt,
}: {
  id: string;
  kind: "audio" | "video";
  onPreempt: () => void;
}) {
  const ref = useRef<HTMLMediaElement | null>(null);
  useAudioChannelSource(ref, {
    silenceBy: kind === "audio" ? "pause" : "mute",
    onPreempt,
  });
  return kind === "audio" ? (
    <audio data-testid={id} ref={ref as React.RefObject<HTMLAudioElement | null>} />
  ) : (
    <video data-testid={id} ref={ref as React.RefObject<HTMLVideoElement | null>} />
  );
}

function node(id: string) {
  return document.querySelector(`[data-testid="${id}"]`) as HTMLMediaElement;
}

function renderTwo() {
  const preemptMusic = vi.fn();
  const preemptVideo = vi.fn();
  const view = render(
    <>
      <Source id="musica" kind="audio" onPreempt={preemptMusic} />
      <Source id="video" kind="video" onPreempt={preemptVideo} />
    </>,
  );
  return { preemptMusic, preemptVideo, view };
}

describe("useAudioChannelSource", () => {
  it("una fuente en silencio o en pausa no toma el canal", () => {
    renderTwo();
    act(() => {
      node("video").muted = true;
      void node("video").play();
    });
    expect(getAudioOwner()).toBeNull();
  });

  it("la música que suena se pausa cuando un video empieza a sonar", () => {
    const { preemptMusic, preemptVideo } = renderTwo();
    act(() => void node("musica").play());
    expect(media.isSounding(node("musica"))).toBe(true);

    act(() => void node("video").play());

    expect(media.isSounding(node("video"))).toBe(true);
    expect(node("musica").paused).toBe(true);
    expect(preemptMusic).toHaveBeenCalledTimes(1);
    expect(preemptVideo).not.toHaveBeenCalled();
  });

  it("el video que suena se mutea (sin pausarse) cuando arranca la música", () => {
    const { preemptVideo } = renderTwo();
    act(() => void node("video").play());
    act(() => void node("musica").play());

    expect(node("video").muted).toBe(true);
    expect(node("video").paused).toBe(false);
    expect(preemptVideo).toHaveBeenCalledTimes(1);
  });

  it("desmutear un video que ya corre también toma el canal", () => {
    const { preemptMusic } = renderTwo();
    act(() => {
      node("video").muted = true;
      void node("video").play();
      void node("musica").play();
    });
    act(() => {
      node("video").muted = false;
    });
    expect(preemptMusic).toHaveBeenCalledTimes(1);
    expect(node("musica").paused).toBe(true);
  });

  it("no calla a quien ya se pausó aunque su evento todavía no llegó", () => {
    const { preemptMusic } = renderTwo();
    act(() => void node("musica").play());
    media.pauseSilently(node("musica"));

    act(() => void node("video").play());
    expect(preemptMusic).not.toHaveBeenCalled();
  });

  it("al pausarse suelta el canal", () => {
    renderTwo();
    act(() => void node("musica").play());
    expect(getAudioOwner()).not.toBeNull();
    act(() => node("musica").pause());
    expect(getAudioOwner()).toBeNull();
  });

  it("al desmontarse suelta el canal", () => {
    const { view } = renderTwo();
    act(() => void node("musica").play());
    view.unmount();
    expect(getAudioOwner()).toBeNull();
  });

  it("con el canal retenido (llamada en curso) nada arranca con sonido", () => {
    const { preemptVideo } = renderTwo();
    const release = holdAudio("llamada");

    act(() => void node("video").play());
    expect(node("video").muted).toBe(true);
    expect(preemptVideo).toHaveBeenCalledTimes(1);
    expect(getAudioOwner()).toBeNull();
    release();
  });

  it("retener el canal calla lo que estaba sonando", () => {
    const { preemptMusic } = renderTwo();
    act(() => void node("musica").play());
    act(() => {
      holdAudio("llamada");
    });
    expect(node("musica").paused).toBe(true);
    expect(preemptMusic).toHaveBeenCalledTimes(1);
  });
});
