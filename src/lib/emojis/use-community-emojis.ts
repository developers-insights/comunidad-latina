"use client";

import { useCallback, useRef, useState } from "react";
import { listCommunityEmojisAction } from "./actions";
import type { CommunityEmoji } from "./catalog";

/**
 * EL CATÁLOGO EN EL CLIENTE, UNA SOLA VEZ POR PESTAÑA.
 *
 * El picker se abre desde tres lugares distintos (comentario, editor de fotos
 * y —cuando se enchufe— reacciones), y en una sesión normal se abre y se cierra
 * muchas veces. Sin esto, cada apertura sería una server action más: un ida y
 * vuelta al servidor para traer una lista que no cambió, en una app con un
 * reclamo abierto por lentitud.
 *
 * LA CACHÉ ES DE MÓDULO Y ESO ACÁ ES SEGURO, al revés que en el servidor: este
 * archivo corre en el navegador de UNA persona, en UNA comunidad. En el
 * servidor la misma técnica le daría el catálogo de un tenant al siguiente
 * pedido, y por eso `queries.ts` usa `cache()` de React, que vive un pedido.
 *
 * Se guarda la PROMESA y no el resultado a propósito: si dos pickers se abren
 * casi juntos (el del comentario y el del editor), el segundo se engancha a la
 * consulta que ya está en vuelo en vez de disparar otra.
 *
 * Un error NO se cachea: se borra la promesa para que "Reintentar" reintente
 * de verdad y no devuelva el mismo fallo para siempre.
 */
let enVuelo: Promise<CommunityEmojiState> | null = null;

export type CommunityEmojiState =
  | { status: "ready"; emojis: CommunityEmoji[] }
  | { status: "error"; code: "unauthenticated" | "tenant-mismatch" | "error"; message?: string };

async function fetchCatalog(): Promise<CommunityEmojiState> {
  const result = await listCommunityEmojisAction();
  if (result.ok) return { status: "ready", emojis: result.emojis };
  return {
    status: "error",
    code: result.code,
    message: result.code === "tenant-mismatch" ? result.message : undefined,
  };
}

function loadCatalog(): Promise<CommunityEmojiState> {
  if (!enVuelo) {
    enVuelo = fetchCatalog().then((state) => {
      if (state.status === "error") enVuelo = null;
      return state;
    });
  }
  return enVuelo;
}

/** Sólo para los tests: deja la caché como recién montada. */
export function resetCommunityEmojiCache(): void {
  enVuelo = null;
}

export type CommunityEmojiLoadState = { status: "idle" } | { status: "loading" } | CommunityEmojiState;

/**
 * `load()` se llama desde el GESTO que abre el picker, no desde un efecto que
 * reacciona a que se abrió. Es la misma decisión que tomó `MusicPicker` y por
 * el mismo motivo: arranca la consulta un render antes y no encadena renders.
 */
export function useCommunityEmojis(): {
  state: CommunityEmojiLoadState;
  load: () => void;
  retry: () => void;
} {
  const [state, setState] = useState<CommunityEmojiLoadState>({ status: "idle" });
  /**
   * "Ya lo pedí" vive en un ref y no en el estado: pedirlo desde el updater de
   * `setState` sería un efecto dentro de una función que React puede ejecutar
   * dos veces (StrictMode), y saldrían dos consultas. El ref se lee y se
   * escribe una sola vez por gesto.
   */
  const pedido = useRef(false);

  const run = useCallback(() => {
    pedido.current = true;
    setState({ status: "loading" });
    void loadCatalog().then(setState);
  }, []);

  const load = useCallback(() => {
    if (pedido.current) return;
    run();
  }, [run]);

  const retry = useCallback(() => {
    enVuelo = null;
    run();
  }, [run]);

  return { state, load, retry };
}
