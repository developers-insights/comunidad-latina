// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CardMusic, MUSIC_AUTOPLAY_DELAY_MS } from "./card-music";
import { claimAudio, resetAudioChannel } from "@/lib/media/audio-channel";
import type { PostMusicView } from "./helpers";

/**
 * LA MÚSICA QUE SUENA MIENTRAS SE SCROLLEA (feedback 2026-08-26: "pude poner
 * música pero cuando estoy scrolleando en el feed no suena… tendría que poder
 * sonar y pausarse y darle play, y tendría que sonar sola").
 *
 * Las tres promesas, una por bloque:
 *  1. Suena — y suena en publicaciones DE FOTOS, que es donde antes no había
 *     ningún `<audio>` montado.
 *  2. Se pausa y se le da play desde la propia insignia.
 *  3. Suena UNA SOLA a la vez, y el scroll la pasa de una publicación a la
 *     otra sin volver a pedir permiso.
 */

const MUSIC: PostMusicView = {
  startSeconds: 20,
  track: {
    id: "track-1",
    title: "Cumbia del barrio",
    artist: "Los del Sur",
    durationSeconds: 180,
    previewUrl: "https://cdn.example.com/track.mp3",
    licenseKind: "cc0",
    attributionRequired: false,
    attributionText: null,
    category: "tropical",
  },
};

const POST_ID = "post-1";

/**
 * El observador de visibilidad de jsdom no existe: acá se stubea guardándose el
 * callback, para poder decir "esta publicación entró en pantalla" a mano.
 */
const observers: Array<(entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>) => void> = [];

function scrollIntoView(visible: boolean) {
  act(() => {
    for (const notify of observers) {
      notify([{ isIntersecting: visible, intersectionRatio: visible ? 1 : 0 }]);
    }
    // El observador espera antes de tomar el sonido: un scroll de largo no
    // enciende la canción.
    vi.advanceTimersByTime(MUSIC_AUTOPLAY_DELAY_MS);
  });
}

function renderMusic(postId = POST_ID) {
  const target = createRef<HTMLDivElement>();
  const view = render(
    <div ref={target}>
      <CardMusic postId={postId} music={MUSIC} targetRef={target} />
    </div>,
  );
  return { ...view, target };
}

function audioNode(): HTMLAudioElement {
  const node = document.querySelector("audio");
  if (!node) throw new Error("no se montó el <audio> de la música");
  return node as HTMLAudioElement;
}

/** El `currentTime` de jsdom no avanza ni acepta duración: se stubea. */
function stubMediaClock(node: HTMLMediaElement, duration: number) {
  let time = 0;
  Object.defineProperty(node, "duration", { configurable: true, value: duration });
  Object.defineProperty(node, "currentTime", {
    configurable: true,
    get: () => time,
    set: (next: number) => {
      time = next;
    },
  });
  return {
    now: () => time,
    seek: (seconds: number) => {
      time = seconds;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  observers.length = 0;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: (entries: unknown[]) => void) {
        observers.push(callback as never);
      }
      observe() {}
      disconnect() {}
    },
  );
  // play()/pause() no están implementados en jsdom.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetAudioChannel();
});

describe("CardMusic: la publicación con música suena", () => {
  it("monta el <audio> aunque la publicación sea de FOTOS (antes vivía en el video)", () => {
    renderMusic();
    expect(audioNode().getAttribute("src")).toBe(MUSIC.track.previewUrl);
  });

  it("carga bajo demanda: un feed con música no baja 40 mp3 de arriba", () => {
    renderMusic();
    expect(audioNode().getAttribute("preload")).toBe("none");
  });

  it("arranca en silencio: sin un gesto de la persona no canta nadie", () => {
    renderMusic();
    scrollIntoView(true);
    expect(audioNode().muted).toBe(true);
  });

  it("tocar la insignia hace sonar la música", () => {
    renderMusic();
    fireEvent.click(screen.getByRole("button", { name: "Escuchar Cumbia del barrio" }));

    expect(audioNode().muted).toBe(false);
  });

  it("tocar de nuevo la pausa, y el scroll ya no la vuelve a encender", () => {
    renderMusic();
    fireEvent.click(screen.getByRole("button", { name: "Escuchar Cumbia del barrio" }));
    fireEvent.click(screen.getByRole("button", { name: "Parar Cumbia del barrio" }));

    expect(audioNode().muted).toBe(true);

    // Quien se silencia no quiere que la publicación siguiente le devuelva el
    // audio: el gesto de silencio apaga TAMBIÉN el seguimiento del scroll.
    scrollIntoView(false);
    scrollIntoView(true);
    expect(audioNode().muted).toBe(true);
  });

  it("con el gesto ya hecho, scrollear hasta la publicación la hace sonar sola", () => {
    // Otra publicación tuvo el sonido antes (el gesto ya existe en la sesión).
    act(() => {
      claimAudio("otro-post");
    });
    renderMusic();
    expect(audioNode().muted).toBe(true);

    scrollIntoView(true);

    expect(audioNode().muted).toBe(false);
  });

  it("un scroll de largo no enciende la canción: hay que quedarse un momento", () => {
    act(() => {
      claimAudio("otro-post");
    });
    renderMusic();

    act(() => {
      for (const notify of observers) {
        notify([{ isIntersecting: true, intersectionRatio: 1 }]);
      }
      vi.advanceTimersByTime(MUSIC_AUTOPLAY_DELAY_MS - 50);
      // Se fue de pantalla antes de que venciera la espera.
      for (const notify of observers) {
        notify([{ isIntersecting: false, intersectionRatio: 0 }]);
      }
      vi.advanceTimersByTime(MUSIC_AUTOPLAY_DELAY_MS);
    });

    expect(audioNode().muted).toBe(true);
  });

  it("salir de pantalla la calla", () => {
    renderMusic();
    fireEvent.click(screen.getByRole("button", { name: "Escuchar Cumbia del barrio" }));
    expect(audioNode().muted).toBe(false);

    scrollIntoView(false);

    expect(audioNode().muted).toBe(true);
  });

  it("nunca dos canciones juntas: la que toma el sonido calla a la anterior", () => {
    renderMusic();
    fireEvent.click(screen.getByRole("button", { name: "Escuchar Cumbia del barrio" }));
    expect(audioNode().muted).toBe(false);

    act(() => {
      claimAudio("otro-post");
    });

    expect(audioNode().muted).toBe(true);
  });
});

describe("CardMusic: el recorte publicado", () => {
  it("arranca en el segundo elegido (post_music.start_seconds)", () => {
    renderMusic();
    const audio = audioNode();
    const clock = stubMediaClock(audio, 180);
    fireEvent.loadedMetadata(audio);

    expect(clock.now()).toBe(20);
  });

  it("hace loop al llegar a su fin (30 s desde el arranque, MUSIC_CLIP_SECONDS)", () => {
    renderMusic();
    const audio = audioNode();
    const clock = stubMediaClock(audio, 180);
    fireEvent.loadedMetadata(audio); // arranca en el segundo 20

    clock.seek(20 + 29);
    fireEvent.timeUpdate(audio);
    expect(clock.now()).toBe(49); // todavía dentro del recorte

    clock.seek(20 + 30); // fin exacto del recorte de 30 s
    fireEvent.timeUpdate(audio);
    expect(clock.now()).toBe(20); // vuelve al arranque del recorte, no al 0 del archivo
  });
});
