import { describe, expect, it } from "vitest";

import { MUSIC_CLIP_SECONDS } from "./audio-track";
import { MUSIC_FADE_SECONDS, clipGain, musicTimeFor, resolveAudioMix } from "./audio-mix";

/**
 * Lo que estos tests protegen:
 *  - NADA suena sin un gesto de la persona. Es la garantía más importante del
 *    módulo y se verifica en las cuatro combinaciones posibles.
 *  - Con música elegida, el video se calla: nunca hay dos audios encimados.
 *  - El loop vuelve al ARRANQUE DEL RECORTE, no al segundo 0 del archivo.
 */

describe("resolveAudioMix — sin gesto no suena nada", () => {
  const combos = [
    { hasMusic: true, videoHasSound: true },
    { hasMusic: true, videoHasSound: false },
    { hasMusic: false, videoHasSound: true },
    { hasMusic: false, videoHasSound: false },
  ];

  for (const combo of combos) {
    it(`silencio con música=${combo.hasMusic} videoConSonido=${combo.videoHasSound}`, () => {
      const state = resolveAudioMix({ ...combo, soundOn: false });
      expect(state.source).toBe("silent");
      expect(state.videoMuted).toBe(true);
      expect(state.musicMuted).toBe(true);
    });
  }
});

describe("resolveAudioMix — quién gana", () => {
  it("con música elegida, la música reemplaza el audio del video", () => {
    const state = resolveAudioMix({ hasMusic: true, videoHasSound: true, soundOn: true });
    expect(state.source).toBe("music");
    expect(state.videoMuted).toBe(true);
    expect(state.musicMuted).toBe(false);
  });

  it("nunca suenan los dos a la vez", () => {
    const state = resolveAudioMix({ hasMusic: true, videoHasSound: true, soundOn: true });
    expect(state.videoMuted && state.musicMuted).toBe(false);
    expect(!state.videoMuted && !state.musicMuted).toBe(false);
  });

  it("sin música, manda el audio del video (comportamiento previo a la 0090)", () => {
    const state = resolveAudioMix({ hasMusic: false, videoHasSound: true, soundOn: true });
    expect(state.source).toBe("video");
    expect(state.videoMuted).toBe(false);
  });

  it("música sobre un carrusel de fotos suena igual (no hay video que ceder)", () => {
    const state = resolveAudioMix({ hasMusic: true, videoHasSound: false, soundOn: true });
    expect(state.source).toBe("music");
    expect(state.musicMuted).toBe(false);
  });
});

describe("resolveAudioMix — el botón de sonido", () => {
  it("no se ofrece cuando no hay nada que escuchar", () => {
    expect(
      resolveAudioMix({ hasMusic: false, videoHasSound: false, soundOn: false }).canToggleSound,
    ).toBe(false);
  });

  it("se ofrece con música, aunque el video sea mudo", () => {
    expect(
      resolveAudioMix({ hasMusic: true, videoHasSound: false, soundOn: false }).canToggleSound,
    ).toBe(true);
  });

  it("pedir sonido donde no hay nada no rompe: sigue en silencio", () => {
    const state = resolveAudioMix({ hasMusic: false, videoHasSound: false, soundOn: true });
    expect(state.source).toBe("silent");
  });
});

describe("musicTimeFor", () => {
  it("arranca en el offset elegido", () => {
    expect(musicTimeFor(45, 0, 180)).toBe(45);
  });

  it("avanza junto con la reproducción", () => {
    expect(musicTimeFor(45, 10, 180)).toBe(55);
  });

  it("al completar el recorte vuelve al ARRANQUE, no al segundo 0", () => {
    expect(musicTimeFor(45, MUSIC_CLIP_SECONDS, 180)).toBe(45);
    expect(musicTimeFor(45, MUSIC_CLIP_SECONDS + 3, 180)).toBe(48);
  });

  it("en una pista corta el loop es la canción entera", () => {
    // Dura 10 s: el recorte no puede ser de 30, así que da la vuelta en 10.
    expect(musicTimeFor(0, 10, 10)).toBe(0);
    expect(musicTimeFor(0, 13, 10)).toBe(3);
  });

  it("nunca pide un tiempo fuera del archivo", () => {
    for (const elapsed of [0, 5, 29, 30, 120]) {
      const time = musicTimeFor(170, elapsed, 180);
      expect(time).toBeGreaterThanOrEqual(0);
      expect(time).toBeLessThanOrEqual(180);
    }
  });

  it("datos basura no producen NaN", () => {
    expect(musicTimeFor(Number.NaN, Number.NaN, 180)).toBe(0);
  });
});

describe("clipGain", () => {
  it("entra y sale en silencio", () => {
    expect(clipGain(0, MUSIC_CLIP_SECONDS)).toBe(0);
    expect(clipGain(MUSIC_CLIP_SECONDS, MUSIC_CLIP_SECONDS)).toBe(0);
  });

  it("en el medio suena a volumen completo", () => {
    expect(clipGain(MUSIC_CLIP_SECONDS / 2, MUSIC_CLIP_SECONDS)).toBe(1);
  });

  it("llega a volumen completo apenas termina el desvanecido", () => {
    expect(clipGain(MUSIC_FADE_SECONDS, MUSIC_CLIP_SECONDS)).toBe(1);
  });

  it("siempre queda entre 0 y 1", () => {
    for (const t of [-5, 0, 0.1, 15, 29.9, 30, 99]) {
      const gain = clipGain(t, MUSIC_CLIP_SECONDS);
      expect(gain).toBeGreaterThanOrEqual(0);
      expect(gain).toBeLessThanOrEqual(1);
    }
  });

  it("un recorte de largo cero no suena en vez de dividir por cero", () => {
    expect(clipGain(0, 0)).toBe(0);
  });
});
