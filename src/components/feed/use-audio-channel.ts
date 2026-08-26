"use client";

import { useSyncExternalStore } from "react";
import {
  getAudioChannel,
  subscribeAudioChannel,
  type AudioChannelState,
} from "@/lib/media/audio-channel";

/**
 * En el servidor no suena nada y no hay canal: una constante, no un objeto
 * nuevo por render — `useSyncExternalStore` compara por referencia y devolver
 * `{...}` acá tiraría el clásico "getServerSnapshot should be cached".
 */
const SERVER_SNAPSHOT: AudioChannelState = { owner: null, enabled: false, suspended: false };

export interface PostAudio {
  /** ¿Este medio tiene que estar sonando AHORA mismo? */
  playing: boolean;
  /** ¿La persona ya pidió sonido alguna vez? (ver `enabled` en audio-channel) */
  enabled: boolean;
}

/**
 * Lo que una card necesita saber del canal único de sonido, mirado desde SU
 * clave. La card no pregunta "quién suena": pregunta "¿me toca a mí?".
 */
export function useAudioChannel(key: string): PostAudio {
  const state = useSyncExternalStore(
    subscribeAudioChannel,
    getAudioChannel,
    () => SERVER_SNAPSHOT,
  );
  return {
    playing: state.owner === key && !state.suspended,
    enabled: state.enabled,
  };
}
