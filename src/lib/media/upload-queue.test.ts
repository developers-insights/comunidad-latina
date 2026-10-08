import { afterEach, describe, expect, it, vi } from "vitest";
import { createStallWatchdog, createUploadLimiter } from "./upload-queue";

describe("createUploadLimiter", () => {
  it("deja pasar hasta el cupo y el resto espera turno", async () => {
    const limiter = createUploadLimiter(2);
    const granted: number[] = [];
    const signal = new AbortController().signal;
    for (const id of [1, 2, 3]) {
      void limiter.acquire(signal).then((ok) => ok && granted.push(id));
    }
    await Promise.resolve();
    expect(granted).toEqual([1, 2]);

    limiter.release();
    await Promise.resolve();
    expect(granted).toEqual([1, 2, 3]);
  });

  it("una espera abortada sale de la cola sin ocupar lugar", async () => {
    const limiter = createUploadLimiter(1);
    const first = new AbortController();
    const second = new AbortController();
    const third = new AbortController();
    await limiter.acquire(first.signal);
    const waiting = limiter.acquire(second.signal);
    const behind = limiter.acquire(third.signal);

    second.abort();
    expect(await waiting).toBe(false);

    limiter.release();
    expect(await behind).toBe(true);
  });

  it("con la señal ya abortada ni entra a la cola", async () => {
    const limiter = createUploadLimiter(1);
    const controller = new AbortController();
    controller.abort();
    expect(await limiter.acquire(controller.signal)).toBe(false);
  });
});

describe("createStallWatchdog", () => {
  afterEach(() => vi.useRealTimers());

  it("se dispara sólo si pasa el plazo sin progreso", () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    const watchdog = createStallWatchdog(1_000, onStall);

    watchdog.poke();
    vi.advanceTimersByTime(900);
    watchdog.poke();
    vi.advanceTimersByTime(900);
    expect(onStall).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it("stop lo apaga", () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    const watchdog = createStallWatchdog(1_000, onStall);
    watchdog.poke();
    watchdog.stop();
    vi.advanceTimersByTime(5_000);
    expect(onStall).not.toHaveBeenCalled();
  });
});
