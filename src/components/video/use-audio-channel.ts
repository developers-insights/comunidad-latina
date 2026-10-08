"use client";

import { useEffect, useEffectEvent, useId, type RefObject } from "react";
import { claimAudio, releaseAudio } from "@/lib/media/audio-channel";

interface AudibleElement {
  readonly paused: boolean;
  muted: boolean;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

const EVENTS = ["play", "playing", "pause", "ended", "emptied", "volumechange"] as const;

function asAudible(node: unknown): AudibleElement | null {
  if (!node || typeof (node as AudibleElement).addEventListener !== "function") return null;
  return node as AudibleElement;
}

/**
 * El volumen no cuenta a propósito: la música entra y sale con desvanecidos
 * hasta 0, y medirlo haría soltar y retomar el canal en cada vuelta del recorte.
 */
function isAudible(node: AudibleElement): boolean {
  return !node.paused && !node.muted;
}

export interface AudioChannelSourceOptions {
  /** Cómo se calla el elemento al perder el canal: el video se mutea, la música se pausa. */
  silenceBy: "mute" | "pause";
  /** El estado de quien monta el medio tiene que reflejar que ya no suena. */
  onPreempt: () => void;
  /**
   * Cambia cuando el elemento detrás de la ref se reemplaza (el reproductor de
   * Mux se monta después del primer render, la hoja del picker monta su audio
   * al abrirse).
   */
  attachKey?: unknown;
}

/**
 * Inscribe un elemento de medio en el canal único. Se lee lo que el elemento
 * HACE (eventos de reproducción y volumen) y no lo que el componente cree que
 * hace: así cubre el autoplay rechazado, el visor, el reel y cualquier camino
 * que pause o desmutee sin pasar por un mismo lugar.
 */
export function useAudioChannelSource(
  mediaRef: RefObject<unknown>,
  { silenceBy, onPreempt, attachKey }: AudioChannelSourceOptions,
): void {
  const key = useId();
  const preempted = useEffectEvent(onPreempt);

  useEffect(() => {
    const node = asAudible(mediaRef.current);
    if (!node) return;

    const silence = () => {
      // El `pause()` es síncrono pero su evento llega después: en el reel, el
      // slide que se fue ya está en pausa cuando el siguiente reclama. Callarlo
      // igual le apagaría el sonido al reel entero.
      if (!isAudible(node)) return;
      if (silenceBy === "mute") node.muted = true;
      else node.pause();
      preempted();
    };

    const sync = () => {
      if (!isAudible(node)) {
        releaseAudio(key);
        return;
      }
      if (!claimAudio(key, silence)) silence();
    };

    for (const type of EVENTS) node.addEventListener(type, sync);
    sync();
    return () => {
      for (const type of EVENTS) node.removeEventListener(type, sync);
      releaseAudio(key);
    };
  }, [mediaRef, key, silenceBy, attachKey]);
}
