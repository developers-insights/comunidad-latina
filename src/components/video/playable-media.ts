/**
 * LO ÚNICO QUE UNA TARJETA LE PIDE A SU ELEMENTO DE MEDIO.
 *
 * `CardVideo` maneja seis cosas alrededor del video —autoplay al 60 % de
 * visibilidad, el tope de 59 s de la vista previa, el toque y el doble toque, el
 * botón de sonido, la música sincronizada del post y el filtro de presentación—
 * y para todas ellas necesita exactamente esto: poder arrancar, pausar, leer y
 * escribir el segundo actual, mutear, y saber cuánto dura.
 *
 * Un `<video>` cumple. `<mux-player>` también cumple, pero NO es un
 * `HTMLVideoElement`: es un custom element que envuelve uno. Sin este tipo, la
 * tarjeta tendría que ramificar entre dos caminos completos —uno para el archivo
 * del bucket y otro para Mux— y esa duplicación es exactamente cómo se llega a
 * que el doble toque funcione en un video y no en el otro.
 *
 * Con este tipo hay UN solo camino: cambia qué elemento se pinta, no qué hace la
 * tarjeta con él.
 */
export interface PlayableMedia {
  play(): Promise<void> | void;
  pause(): void;
  currentTime: number;
  muted: boolean;
  readonly duration: number;
  /**
   * Lo necesita el visor a pantalla completa, donde el toque alterna
   * play/pausa: sin saber en cuál de los dos está, el toque no puede decidir.
   * En la tarjeta del feed no se usa (ahí el toque abre el visor).
   */
  readonly paused: boolean;
  /**
   * Dimensiones reales del cuadro. El visor las usa para una sola decisión: un
   * video HORIZONTAL no se recorta a `cover` en un reel vertical —quedaría
   * mutilado— sino que se muestra entero con bandas. Opcionales porque hasta que
   * no carga la metadata no existen.
   */
  readonly videoWidth?: number;
  readonly videoHeight?: number;
}

/**
 * `play()` puede devolver una promesa rechazada (política de autoplay del
 * navegador) o directamente `undefined` (jsdom, navegadores viejos, y el
 * `<mux-player>` antes de terminar de hidratar): encadenarle `.catch()` a ciegas
 * tira un TypeError.
 *
 * Este helper es el mismo que ya vivía —repetido— en `card-video.tsx` y en
 * `media-viewer.tsx`; vive acá para que las dos superficies y el reproductor de
 * Mux compartan una sola versión.
 */
export function safePlayMedia(media: PlayableMedia | null | undefined): void {
  if (!media) return;
  try {
    const result = media.play() as Promise<void> | undefined;
    result?.catch(() => undefined);
  } catch {
    // El navegador rechazó la reproducción: no hay nada que hacer ni que avisar.
  }
}
