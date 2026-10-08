import { vi } from "vitest";

/**
 * jsdom no reproduce: `play()` no cambia `paused` ni dispara eventos, y `muted`
 * no avisa con `volumechange`. El canal de audio se guía por esos eventos, así
 * que los tests necesitan un elemento que se comporte como el del navegador.
 * Sólo para tests.
 */
export function installFakeMedia() {
  const proto = HTMLMediaElement.prototype;
  const paused = new WeakMap<HTMLMediaElement, boolean>();
  const muted = new WeakMap<HTMLMediaElement, boolean>();

  const spies = [
    vi.spyOn(proto, "paused", "get").mockImplementation(function (this: HTMLMediaElement) {
      return paused.get(this) ?? true;
    }),
    vi.spyOn(proto, "muted", "get").mockImplementation(function (this: HTMLMediaElement) {
      return muted.get(this) ?? false;
    }),
    vi.spyOn(proto, "muted", "set").mockImplementation(function (
      this: HTMLMediaElement,
      value: boolean,
    ) {
      if ((muted.get(this) ?? false) === value) return;
      muted.set(this, value);
      this.dispatchEvent(new Event("volumechange"));
    }),
    vi.spyOn(proto, "play").mockImplementation(function (this: HTMLMediaElement) {
      if (paused.get(this) === false) return Promise.resolve();
      paused.set(this, false);
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    }),
    vi.spyOn(proto, "pause").mockImplementation(function (this: HTMLMediaElement) {
      if (paused.get(this) ?? true) return;
      paused.set(this, true);
      this.dispatchEvent(new Event("pause"));
    }),
  ];

  return {
    /** `pause()` síncrono sin su evento todavía, como pasa en el navegador. */
    pauseSilently(node: HTMLMediaElement) {
      paused.set(node, true);
    },
    isSounding(node: HTMLMediaElement) {
      return paused.get(node) === false && !(muted.get(node) ?? false);
    },
    restore() {
      for (const spy of spies) spy.mockRestore();
    },
  };
}
