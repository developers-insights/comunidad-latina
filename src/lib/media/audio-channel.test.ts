import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimAudio,
  getAudioOwner,
  holdAudio,
  isAudioHeld,
  releaseAudio,
  resetAudioChannelForTests,
  subscribeAudioChannel,
} from "./audio-channel";

afterEach(resetAudioChannelForTests);

describe("audio-channel: una sola fuente suena", () => {
  it("el primero que reclama queda como dueño", () => {
    const silenceA = vi.fn();
    expect(claimAudio("a", silenceA)).toBe(true);
    expect(getAudioOwner()).toBe("a");
    expect(silenceA).not.toHaveBeenCalled();
  });

  it("el segundo desplaza al primero y lo calla una sola vez", () => {
    const silenceA = vi.fn();
    const silenceB = vi.fn();
    claimAudio("a", silenceA);
    claimAudio("b", silenceB);

    expect(getAudioOwner()).toBe("b");
    expect(silenceA).toHaveBeenCalledTimes(1);
    expect(silenceB).not.toHaveBeenCalled();
  });

  it("el dueño desplazado ya no es dueño cuando se lo calla", () => {
    let ownerWhenSilenced: string | null = "sin llamar";
    claimAudio("a", () => {
      ownerWhenSilenced = getAudioOwner();
    });
    claimAudio("b", vi.fn());
    expect(ownerWhenSilenced).toBe("b");
  });

  it("reclamar de nuevo siendo dueño no calla a nadie ni avisa", () => {
    const silence = vi.fn();
    const listener = vi.fn();
    claimAudio("a", silence);
    subscribeAudioChannel(listener);

    claimAudio("a", silence);
    expect(silence).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it("re-reclamar actualiza con qué se lo calla", () => {
    const first = vi.fn();
    const second = vi.fn();
    claimAudio("a", first);
    claimAudio("a", second);
    claimAudio("b", vi.fn());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("sólo el dueño puede soltar el canal", () => {
    claimAudio("a", vi.fn());
    releaseAudio("b");
    expect(getAudioOwner()).toBe("a");
    releaseAudio("a");
    expect(getAudioOwner()).toBeNull();
  });

  it("avisa a los suscriptores en cada cambio de dueño", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAudioChannel(listener);
    claimAudio("a", vi.fn());
    claimAudio("b", vi.fn());
    releaseAudio("b");
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    claimAudio("c", vi.fn());
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe("audio-channel: retención (llamada en curso)", () => {
  it("retener calla al dueño actual y rechaza nuevos reclamos", () => {
    const silence = vi.fn();
    claimAudio("a", silence);

    const release = holdAudio("llamada");
    expect(silence).toHaveBeenCalledTimes(1);
    expect(getAudioOwner()).toBeNull();
    expect(isAudioHeld()).toBe(true);
    expect(claimAudio("b", vi.fn())).toBe(false);
    expect(getAudioOwner()).toBeNull();

    release();
    expect(isAudioHeld()).toBe(false);
    expect(claimAudio("b", vi.fn())).toBe(true);
  });

  it("dos retenciones: el canal vuelve recién cuando se sueltan las dos", () => {
    const releaseCall = holdAudio("llamada");
    const releaseOther = holdAudio("otra");
    releaseCall();
    expect(claimAudio("a", vi.fn())).toBe(false);
    releaseOther();
    expect(claimAudio("a", vi.fn())).toBe(true);
  });

  it("soltar dos veces la misma retención no suelta otra del mismo motivo", () => {
    const release = holdAudio("llamada");
    holdAudio("llamada");
    release();
    release();
    expect(isAudioHeld()).toBe(true);
  });
});
