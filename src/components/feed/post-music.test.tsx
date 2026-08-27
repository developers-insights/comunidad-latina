// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PostMusicProvider, PostMusicSpeaker, usePostMusic } from "./post-music";
import type { PostMusicView } from "./helpers";

/**
 * LA PISTA DE LA PUBLICACIÓN (0090) — contrato del reproductor.
 *
 * Estos tests vivían en `card-video.test.tsx`, porque el `<audio>` vivía dentro
 * de `CardVideo`. Y ése era el bug que reportó el cliente el 2026-08-26
 * ("cuando se publica con música, no se escucha la música"): sobre una
 * publicación de FOTO no había video, así que no había `<audio>`, ni altavoz,
 * ni forma de pedir la canción que la insignia ya estaba anunciando.
 *
 * El reproductor se mudó al nivel donde vive el dato —`post_music`, PK
 * `post_id`— y sus tests con él. El árbitro de QUÉ suena sigue siendo
 * `resolveAudioMix` (probado en audio-mix.test.ts); acá se prueba que este
 * componente APLIQUE ese veredicto al DOM y respete el recorte.
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

afterEach(cleanup);

function renderProvider({
  music = MUSIC as PostMusicView | null,
  hasVideo = false,
}: { music?: PostMusicView | null; hasVideo?: boolean } = {}) {
  return render(
    <PostMusicProvider music={music} hasVideo={hasVideo}>
      <div data-testid="medios" />
      <PostMusicSpeaker />
    </PostMusicProvider>,
  );
}

function audioNode(): HTMLAudioElement | null {
  return document.querySelector("audio");
}

/**
 * jsdom no implementa el reloj de un elemento de medio: `duration` es NaN y
 * `currentTime` no avanza. Se define a mano —igual que haría el navegador al
 * cargar la metadata— para poder probar el recorte, que es lo que importa.
 */
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
    seek: (seconds: number) => {
      time = seconds;
    },
    now: () => time,
  };
}

describe("PostMusicProvider: el elemento de la pista", () => {
  it("sin música no monta ningún <audio>", () => {
    renderProvider({ music: null });
    expect(audioNode()).toBeNull();
  });

  it("con música monta UNO, apuntando a la pista y en silencio", () => {
    renderProvider();
    expect(document.querySelectorAll("audio")).toHaveLength(1);
    expect(audioNode()?.getAttribute("src")).toBe(MUSIC.track.previewUrl);
    expect(audioNode()?.muted).toBe(true);
  });

  it("carga bajo demanda (preload=none): un feed con música no baja 40 mp3", () => {
    renderProvider();
    expect(audioNode()?.getAttribute("preload")).toBe("none");
  });

  it("arranca en el segundo elegido del recorte (post_music.start_seconds)", () => {
    renderProvider();
    const audio = audioNode() as HTMLAudioElement;
    const clock = stubMediaClock(audio, MUSIC.track.durationSeconds);
    fireEvent.loadedMetadata(audio);

    expect(clock.now()).toBe(20);
  });

  it("el recorte hace loop al llegar a su fin (30 s, MUSIC_CLIP_SECONDS)", () => {
    renderProvider();
    const audio = audioNode() as HTMLAudioElement;
    const clock = stubMediaClock(audio, MUSIC.track.durationSeconds);
    fireEvent.loadedMetadata(audio); // arranca en el segundo 20

    clock.seek(20 + 29);
    fireEvent.timeUpdate(audio);
    expect(clock.now()).toBe(49); // todavía dentro del recorte

    clock.seek(20 + 30); // fin exacto del recorte
    fireEvent.timeUpdate(audio);
    expect(clock.now()).toBe(20); // vuelve al arranque del RECORTE, no al 0 del archivo
  });

  it("las puntas del recorte se desvanecen — la vuelta del loop no es un golpe seco", () => {
    renderProvider();
    const audio = audioNode() as HTMLAudioElement;
    const clock = stubMediaClock(audio, MUSIC.track.durationSeconds);
    fireEvent.loadedMetadata(audio);

    // Recién arrancado: todavía subiendo.
    clock.seek(20.1);
    fireEvent.timeUpdate(audio);
    expect(audio.volume).toBeLessThan(1);

    // En el medio del recorte: a volumen pleno.
    clock.seek(35);
    fireEvent.timeUpdate(audio);
    expect(audio.volume).toBe(1);

    // Contra el final: bajando.
    clock.seek(20 + 29.9);
    fireEvent.timeUpdate(audio);
    expect(audio.volume).toBeLessThan(1);
  });
});

describe("PostMusicSpeaker: el gesto de sonido de la publicación", () => {
  it("sobre una publicación con música aparece, aunque no haya ningún video", () => {
    renderProvider({ hasVideo: false });
    expect(screen.getByRole("button", { name: "Activar el sonido" })).toBeTruthy();
  });

  it("sin música y sin video no se pinta: un altavoz que no hace nada es peor que ninguno", () => {
    renderProvider({ music: null, hasVideo: false });
    expect(screen.queryByRole("button", { name: /sonido|silenciar/i })).toBeNull();
  });

  it("sin música pero con video sigue existiendo (regla 3 de audio-mix, sin cambios)", () => {
    renderProvider({ music: null, hasVideo: true });
    expect(screen.getByRole("button", { name: "Activar el sonido" })).toBeTruthy();
  });

  it("tocarlo desmutea la pista; tocarlo de nuevo vuelve al silencio", () => {
    renderProvider();
    const audio = audioNode() as HTMLAudioElement;

    fireEvent.click(screen.getByRole("button", { name: "Activar el sonido" }));
    expect(audio.muted).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Silenciar la música" }));
    expect(audio.muted).toBe(true);
  });

  it("con música, el rótulo habla de la MÚSICA — sobre fotos no hay video que silenciar", () => {
    renderProvider({ hasVideo: false });
    fireEvent.click(screen.getByRole("button", { name: "Activar el sonido" }));
    expect(screen.getByRole("button", { name: "Silenciar la música" })).toBeTruthy();
  });

  it("sin música, el rótulo sigue hablando del VIDEO", () => {
    renderProvider({ music: null, hasVideo: true });
    fireEvent.click(screen.getByRole("button", { name: "Activar el sonido" }));
    expect(screen.getByRole("button", { name: "Silenciar el video" })).toBeTruthy();
  });

  it("el toque muere en el altavoz: no burbujea hacia la capa que abre el visor", () => {
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <PostMusicProvider music={MUSIC} hasVideo={false}>
          <PostMusicSpeaker />
        </PostMusicProvider>
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Activar el sonido" }));
    expect(onParentClick).not.toHaveBeenCalled();
  });
});

describe("usePostMusic: lo que leen las islas de la card", () => {
  function Sonda() {
    const music = usePostMusic();
    return (
      <span data-testid="sonda">
        {music ? `${music.mix.source}/${music.mix.videoMuted}` : "sin-provider"}
      </span>
    );
  }

  it("fuera del provider devuelve null — la isla suelta no explota", () => {
    render(<Sonda />);
    expect(screen.getByTestId("sonda").textContent).toBe("sin-provider");
  });

  it("con música y sonido activo, el VIDEO queda mudo (gana la música)", () => {
    render(
      <PostMusicProvider music={MUSIC} hasVideo>
        <Sonda />
        <PostMusicSpeaker />
      </PostMusicProvider>,
    );

    expect(screen.getByTestId("sonda").textContent).toBe("silent/true");
    fireEvent.click(screen.getByRole("button", { name: "Activar el sonido" }));
    expect(screen.getByTestId("sonda").textContent).toBe("music/true");
  });

  it("sin música y con sonido activo, manda el video", () => {
    render(
      <PostMusicProvider music={null} hasVideo>
        <Sonda />
        <PostMusicSpeaker />
      </PostMusicProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Activar el sonido" }));
    expect(screen.getByTestId("sonda").textContent).toBe("video/false");
  });
});
