"use client";

import { useEffect, useState } from "react";
import { fetchMuxStatusesAction, type MuxStatusRow } from "@/app/(app)/feed/mux-status-actions";
import { muxStatusIsPending, parseMuxStatus, type MuxStatus } from "@/lib/media/mux-video";

/**
 * =============================================================================
 * CÓMO SE ENTERA EL FEED DE QUE UN VIDEO TERMINÓ DE PROCESARSE
 * =============================================================================
 *
 * Mux tarda. La publicación sale igual —eso no se negocia— y la tarjeta queda
 * mostrando "preparando el video". Este módulo es lo que hace que esa tarjeta se
 * convierta sola en un video, sin que nadie recargue nada.
 *
 * ── DE DÓNDE SALE LA IDEA, Y POR QUÉ NO SE COPIÓ TAL CUAL ───────────────────
 * El panel de admin de Poncho (`components/admin/mux-uploader.tsx`) resuelve
 * esto con un `setInterval` de 4 s por componente, y para ese caso está bien: es
 * UNA lección, en una pantalla de escritorio, editada por una persona que está
 * mirando fijo esa fila.
 *
 * Un feed es el caso opuesto. Puede haber varias tarjetas procesando a la vez,
 * en un teléfono de gama media, con 4G. Un intervalo fijo por tarjeta serían N
 * consultas cada 4 s durante los minutos que dure la transcodificación — y la
 * mayoría de esas consultas contestan exactamente lo mismo que la anterior.
 *
 * ── LAS CUATRO COSAS QUE LO HACEN BARATO ────────────────────────────────────
 *
 *  1. UNA SOLA CONSULTA POR TANDA. Hay un único temporizador para toda la app,
 *     no uno por tarjeta. Las tarjetas se suscriben a este registro y la tanda
 *     pregunta por TODOS los ids juntos (`fetchMuxStatusesAction` recibe lista).
 *     Ocho tarjetas procesando = una consulta, no ocho.
 *
 *  2. ESPERA CRECIENTE. Arranca en 4 s y se va estirando ×1,5 hasta un techo de
 *     30 s. Los primeros segundos son los que importan (un clip corto puede
 *     estar listo enseguida); a los tres minutos, preguntar cada 4 s no aporta
 *     nada que preguntar cada 30 no aporte igual. En una espera de 5 minutos
 *     esto son ~15 consultas en vez de ~75.
 *
 *  3. CON LA APP EN SEGUNDO PLANO NO PREGUNTA NADA. Si la pestaña no está
 *     visible el temporizador se apaga entero: nadie está mirando esa tarjeta.
 *     Al volver se reinicia la espera a 4 s y pregunta enseguida — que es
 *     justamente cuando la persona quiere ver el resultado.
 *
 *  4. SE RINDE. A los 15 minutos deja de preguntar y la tarjeta pasa a decir que
 *     está tardando más de lo normal. Un sondeo eterno contra un video que
 *     nunca va a terminar es una pila abriendo consultas para siempre.
 *
 * ── LO QUE ESTE MÓDULO NO HACE ──────────────────────────────────────────────
 * No pregunta por videos que ya están listos ni por los que fallaron: sólo los
 * estados que todavía pueden cambiar solos entran al registro
 * (`muxStatusIsPending`). Y no sabe nada de los 36 videos viejos del bucket —
 * esos no tienen `mux_status`, así que nunca se suscriben.
 */

/** Primera espera. Corta: un clip de 20 s puede estar listo casi enseguida. */
const ESPERA_INICIAL_MS = 4_000;
/** Cuánto se estira cada vez que una tanda no trajo novedades. */
const FACTOR_DE_ESPERA = 1.5;
/** Techo de la espera. Más que esto se siente abandonado. */
const ESPERA_MAXIMA_MS = 30_000;
/** Cuándo se deja de preguntar y la tarjeta lo dice. */
const PACIENCIA_MS = 15 * 60 * 1_000;

export interface MuxLiveStatus {
  status: MuxStatus | null;
  playbackId: string | null;
  durationSeconds: number | null;
  /** Se agotó la paciencia: seguimos sin respuesta y ya no preguntamos más. */
  demorado: boolean;
}

type Oyente = (fila: MuxStatusRow) => void;

const oyentes = new Map<string, Set<Oyente>>();
let temporizador: ReturnType<typeof setTimeout> | null = null;
let esperaActual = ESPERA_INICIAL_MS;
let tandaEnVuelo = false;
/** Ya se enganchó el listener de visibilidad (una sola vez por documento). */
let visibilidadEnganchada = false;

function hayQuePreguntar(): boolean {
  if (oyentes.size === 0) return false;
  if (typeof document === "undefined") return false;
  return document.visibilityState === "visible";
}

function detener() {
  if (temporizador !== null) {
    clearTimeout(temporizador);
    temporizador = null;
  }
}

/**
 * Agenda la próxima tanda. Se llama después de CADA tanda (no es un
 * `setInterval`) para que una consulta lenta nunca se solape con la siguiente:
 * con 4G eso es lo que convierte un sondeo en una cola de peticiones apiladas.
 */
function agendar(espera: number) {
  detener();
  if (!hayQuePreguntar()) return;
  temporizador = setTimeout(() => {
    void correrTanda();
  }, espera);
}

async function correrTanda() {
  if (tandaEnVuelo) return;
  if (!hayQuePreguntar()) return;
  const ids = [...oyentes.keys()];
  if (ids.length === 0) return;

  tandaEnVuelo = true;
  let novedades = false;
  try {
    const filas = await fetchMuxStatusesAction(ids);
    for (const [postId, fila] of Object.entries(filas)) {
      const suscriptos = oyentes.get(postId);
      if (!suscriptos) continue;
      // Sólo se avisa cuando el estado dejó de estar en vuelo: mientras siga
      // `processing`, repintar la tarjeta con el mismo dato no cambia nada de
      // lo que ve la persona y sí la hace parpadear.
      if (muxStatusIsPending(fila.status)) continue;
      novedades = true;
      for (const avisar of [...suscriptos]) avisar(fila);
    }
  } catch {
    // Una tanda fallida no rompe nada: la próxima reintenta, un poco más tarde.
  } finally {
    tandaEnVuelo = false;
  }

  // Con novedades se vuelve a la espera corta (suele haber varios videos de la
  // misma tanda terminando cerca uno del otro). Sin novedades, se estira.
  esperaActual = novedades
    ? ESPERA_INICIAL_MS
    : Math.min(ESPERA_MAXIMA_MS, Math.round(esperaActual * FACTOR_DE_ESPERA));
  agendar(esperaActual);
}

function engancharVisibilidad() {
  if (visibilidadEnganchada || typeof document === "undefined") return;
  visibilidadEnganchada = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      // Volver a la app es exactamente cuando la persona quiere ver si ya está:
      // se reinicia la espera y se pregunta enseguida, no dentro de 30 s.
      esperaActual = ESPERA_INICIAL_MS;
      if (oyentes.size > 0) void correrTanda();
    } else {
      detener();
    }
  });
}

function suscribir(postId: string, oyente: Oyente): () => void {
  engancharVisibilidad();
  const suscriptos = oyentes.get(postId) ?? new Set<Oyente>();
  suscriptos.add(oyente);
  oyentes.set(postId, suscriptos);
  // Una tarjeta nueva esperando es motivo para volver a la espera corta.
  esperaActual = ESPERA_INICIAL_MS;
  if (temporizador === null) agendar(esperaActual);

  return () => {
    const actuales = oyentes.get(postId);
    if (!actuales) return;
    actuales.delete(oyente);
    if (actuales.size === 0) oyentes.delete(postId);
    if (oyentes.size === 0) detener();
  };
}

/**
 * EL ESTADO VIVO DE UN VIDEO DE MUX. Arranca con lo que trajo el servidor y, si
 * ese estado todavía puede cambiar, se suscribe al sondeo compartido hasta que
 * cambie (o hasta que se agote la paciencia).
 *
 * Para un video que YA llegó listo —la enorme mayoría del feed— esto no hace
 * absolutamente nada: ni suscripción, ni temporizador, ni una consulta.
 */
export function useMuxLiveStatus(input: {
  postId: string;
  status?: unknown;
  playbackId?: string | null;
  durationSeconds?: number | null;
}): MuxLiveStatus {
  const inicial = parseMuxStatus(input.status);
  const [vivo, setVivo] = useState<MuxStatusRow>({
    status: inicial,
    playbackId: input.playbackId ?? null,
    durationSeconds: input.durationSeconds ?? null,
  });
  const [demorado, setDemorado] = useState(false);

  // El servidor puede traer un estado más nuevo que el que este hook guardó (un
  // `router.refresh()`, una tanda del scroll infinito): gana el del servidor
  // cuando ya resolvió, porque es la verdad de la base.
  const estadoDelServidor = parseMuxStatus(input.status);
  const estadoEfectivo = muxStatusIsPending(vivo.status) && estadoDelServidor !== null && !muxStatusIsPending(estadoDelServidor)
    ? estadoDelServidor
    : vivo.status;

  const hayQueSondear = muxStatusIsPending(estadoEfectivo);
  const { postId } = input;

  useEffect(() => {
    if (!hayQueSondear) return;
    const desuscribir = suscribir(postId, (fila) => {
      setVivo(fila);
      setDemorado(false);
    });
    const rendicion = setTimeout(() => setDemorado(true), PACIENCIA_MS);
    return () => {
      desuscribir();
      clearTimeout(rendicion);
    };
  }, [postId, hayQueSondear]);

  return {
    status: estadoEfectivo,
    playbackId: vivo.playbackId ?? input.playbackId ?? null,
    durationSeconds: vivo.durationSeconds ?? input.durationSeconds ?? null,
    demorado,
  };
}

/**
 * Sólo para los tests: deja el registro compartido como recién arrancado. Sin
 * esto, un test que monta una tarjeta procesando le deja el temporizador puesto
 * al siguiente y los archivos se contaminan entre sí.
 */
export function __resetMuxPollForTests() {
  detener();
  oyentes.clear();
  esperaActual = ESPERA_INICIAL_MS;
  tandaEnVuelo = false;
}
