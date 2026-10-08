/**
 * Cola de subidas con cupo: con 10 videos elegidos de una, 10 XHR en paralelo
 * se reparten el mismo ancho de banda (ninguno termina antes) y en un teléfono
 * compiten con todo lo demás. Las que esperan turno no ocupan red.
 */
export interface UploadLimiter {
  /** Espera turno. `false` si `signal` se abortó antes de conseguirlo. */
  acquire(signal: AbortSignal): Promise<boolean>;
  release(): void;
}

export function createUploadLimiter(max: number): UploadLimiter {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    while (active < max && queue.length > 0) {
      active += 1;
      queue.shift()!();
    }
  };

  return {
    acquire(signal) {
      return new Promise<boolean>((resolve) => {
        if (signal.aborted) {
          resolve(false);
          return;
        }
        const grant = () => resolve(true);
        queue.push(grant);
        signal.addEventListener(
          "abort",
          () => {
            const index = queue.indexOf(grant);
            if (index >= 0) {
              queue.splice(index, 1);
              resolve(false);
            }
          },
          { once: true },
        );
        next();
      });
    },
    release() {
      active = Math.max(0, active - 1);
      next();
    },
  };
}

/**
 * Corta una subida que dejó de avanzar. No es un tope de duración total —un
 * video de 200 MB en 3G puede tardar minutos de verdad—: se dispara sólo si
 * pasan `ms` sin un solo evento de progreso, que es lo que deja Publicar
 * esperando para siempre cuando la red queda trabada.
 */
export function createStallWatchdog(ms: number, onStall: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const poke = () => {
    stop();
    timer = setTimeout(() => {
      timer = null;
      onStall();
    }, ms);
  };
  return { poke, stop };
}
