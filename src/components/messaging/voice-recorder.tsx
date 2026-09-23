"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Lock,
  Microphone,
  PaperPlaneRight,
  Pause,
  Play,
  Stop,
  Trash,
} from "@phosphor-icons/react/dist/ssr";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import {
  MAX_DURACION_AUDIO_MS,
  PICOS_DE_ONDA,
  calcularOnda,
  elegirMimeDeGrabacion,
  formatearDuracion,
  soporteDeGrabacion,
  type MimeDeGrabacion,
} from "@/lib/messaging/audio";
import { COPY_COMPOSER } from "./copy-composer";
import { VoicePlayer } from "./voice-player";

/**
 * NOTAS DE VOZ — los seis pasos de la lámina "Voice Chat".
 *
 *   1. El micrófono espera en la barra.        → `inactivo`
 *   2. Mantené presionado y graba; al soltar SE MANDA (como WhatsApp).
 *   3. Deslizá: ← cancela, ↑ deja manos libres → `grabando` + gesto
 *   4. Manos libres: pausar / borrar / enviar  → `bloqueada` | `pausada`
 *   5. Opcional, desde manos libres: el cuadrado la corta y deja
 *      escucharla antes de mandarla.           → `previa`
 *   6. Se manda y se ve como onda con su duración (eso lo pinta la burbuja).
 *
 * Soltar abría la vista previa en vez de mandar, y en manos libres no había
 * ningún botón de enviar: pedido de Nacho (22/9) «falta poder enviar el
 * audio, no hay botón todavía».
 *
 * ─── EL GESTO SOSTENIDO NO PUEDE SER LA ÚNICA PUERTA ────────────────────────
 * Mantener el dedo apretado mientras se habla deja afuera a cualquiera con
 * temblor, con una mano ocupada, o navegando por teclado. La alternativa NO es
 * un botón escondido en un menú: un TOQUE CORTO (soltar antes de 400 ms sin
 * arrastrar) entra directo a manos libres, y Enter o Espacio sobre el botón
 * hacen lo mismo. Así el modo accesible es el camino natural de quien no puede
 * sostener, y nadie tiene que descubrir nada.
 *
 * ─── LOS PERMISOS SE PIDEN EN EL GESTO ──────────────────────────────────────
 * `getUserMedia` se llama dentro del `pointerdown`, nunca al montar la
 * pantalla. Un chat que pide el micrófono al abrirse es un chat al que se le
 * dice que no para siempre, y después el botón queda muerto sin explicación.
 *
 * ⚠️ `Permissions-Policy` DEL SITIO: sin `microphone=(self)` en los headers de
 * `next.config.ts`, `getUserMedia` rechaza con NotAllowedError y el navegador
 * NI SIQUIERA PREGUNTA. Se ve exactamente igual que si la persona hubiera
 * dicho que no, así que si esto deja de funcionar de golpe, el header es el
 * primer lugar donde mirar.
 */

type Estado =
  | { fase: "inactivo" }
  | { fase: "pidiendo" }
  | { fase: "grabando"; bloqueada: boolean; pausada: boolean }
  | { fase: "previa"; blob: Blob; mime: string; duracionMs: number; onda: number[]; url: string }
  | { fase: "denegado" }
  | { fase: "sinSoporte" }
  | { fase: "error" };

export interface GrabacionLista {
  blob: Blob;
  /** El tipo PELADO, listo para el Content-Type del bucket y para `adjunto.mime`. */
  mime: string;
  duracionMs: number;
  onda: number[];
}

export interface VoiceRecorderProps {
  disabled?: boolean;
  /** Se llama con la nota lista para mandar: al soltar, al tocar el avión o desde la vista previa. */
  onListo: (grabacion: GrabacionLista) => void;
  /** `true` mientras el grabador ocupa la barra: el composer esconde el resto. */
  onActivo?: (activo: boolean) => void;
}

/** Deslizamiento, en px, que dispara cada gesto. */
const UMBRAL_CANCELAR = 80;
const UMBRAL_BLOQUEAR = 64;
/** Soltar antes de esto sin arrastrar = toque, no sostenido. */
const MS_DE_TOQUE = 400;

const BARRAS_EN_VIVO = 5;

/**
 * ¿Soltar acá BORRA la nota?
 *
 * Una sola función porque la respuesta la necesitan DOS lugares: el que decide
 * (`alSubir`) y el que avisa (el cartel rojo "soltá para cancelar"). Separadas,
 * la pantalla podía estar prometiendo algo distinto de lo que iba a pasar.
 *
 * Exige que el arrastre sea claramente horizontal, espejo del guard de bloqueo:
 * una diagonal hacia arriba-izquierda es alguien buscando manos libres, no
 * alguien tirando la grabación a la basura.
 */
export function esGestoDeCancelar(dx: number, dy: number): boolean {
  return dx < -UMBRAL_CANCELAR && Math.abs(dx) > Math.abs(dy);
}

export function VoiceRecorder({ disabled = false, onListo, onActivo }: VoiceRecorderProps) {
  const reduceMotion = useReducedMotion();
  const [estado, setEstado] = useState<Estado>({ fase: "inactivo" });
  const [transcurrido, setTranscurrido] = useState(0);
  const [gesto, setGesto] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const [subiendo, setSubiendo] = useState(false);
  /** Entre `detener` y el `onstop` del recorder: los botones no hacen nada. */
  const [cerrando, setCerrando] = useState(false);
  /** Hay un dedo apoyado: mientras dure, el gesto se escucha en `window`. */
  const [gestoActivo, setGestoActivo] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trozosRef = useRef<Blob[]>([]);
  const mimeRef = useRef<MimeDeGrabacion | null>(null);
  const inicioRef = useRef(0);
  const acumuladoRef = useRef(0);
  const cancelarRef = useRef(false);
  const enviarAlCerrarRef = useRef(false);
  /**
   * El toque que TERMINA en el botón persistente también dispara un `click`.
   * Sólo cuenta como "enviar" si el dedo BAJÓ cuando ya estaba en manos libres:
   * si no, el mismo toque corto que entra a manos libres mandaría el audio
   * vacío en el acto.
   */
  const clickEnviaRef = useRef(false);
  const punteroRef = useRef<number | null>(null);
  const bajadaRef = useRef(0);
  const arrastroRef = useRef(false);
  const bloqueadaRef = useRef(false);
  const cronometroRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gestoRef = useRef({ dx: 0, dy: 0 });
  const centroRef = useRef({ x: 0, y: 0 });
  const barrasRef = useRef<(HTMLSpanElement | null)[]>([]);
  const analizadorRef = useRef<AnalyserNode | null>(null);
  const contextoRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const activo = estado.fase === "grabando" || estado.fase === "previa" || estado.fase === "pidiendo";

  useEffect(() => {
    onActivo?.(activo);
  }, [activo, onActivo]);

  /** Corta todo: pistas, cronómetro, medidor y contexto de audio. */
  const soltarRecursos = useCallback(() => {
    if (cronometroRef.current !== null) {
      clearInterval(cronometroRef.current);
      cronometroRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    analizadorRef.current = null;
    // El contexto se cierra explícitamente: dejarlo abierto mantiene viva la
    // ruta de audio del sistema y en algunos Android deja el ícono del
    // micrófono encendido después de terminar.
    void contextoRef.current?.close().catch(() => {});
    contextoRef.current = null;
    streamRef.current?.getTracks().forEach((pista) => pista.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => soltarRecursos, [soltarRecursos]);

  /** Medidor en vivo: escribe la escala directo en el DOM, sin re-renderizar. */
  const medir = useCallback(() => {
    const analizador = analizadorRef.current;
    if (!analizador) return;
    const datos = new Uint8Array(analizador.frequencyBinCount);
    analizador.getByteTimeDomainData(datos);
    let pico = 0;
    for (const valor of datos) {
      const desvio = Math.abs(valor - 128) / 128;
      if (desvio > pico) pico = desvio;
    }
    for (let i = 0; i < barrasRef.current.length; i += 1) {
      const barra = barrasRef.current[i];
      if (!barra) continue;
      // Cada barra reacciona con un peso distinto: si todas escalan igual, el
      // medidor parece un solo bloque que sube y baja.
      const peso = 0.45 + (i % 3) * 0.28;
      barra.style.transform = `scaleY(${Math.max(0.18, Math.min(1, pico * peso * 3.2))})`;
    }
    rafRef.current = requestAnimationFrame(medir);
  }, []);

  async function empezar(desdeTeclado: boolean) {
    if (disabled || estado.fase !== "inactivo") return;

    const soporta = soporteDeGrabacion();
    const elegido = elegirMimeDeGrabacion(soporta);
    if (!elegido || typeof navigator === "undefined" || !navigator.mediaDevices) {
      setEstado({ fase: "sinSoporte" });
      return;
    }
    mimeRef.current = elegido;
    setEstado({ fase: "pidiendo" });

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (error) {
      const nombre = error instanceof Error ? error.name : "";
      setEstado(nombre === "NotFoundError" ? { fase: "error" } : { fase: "denegado" });
      return;
    }

    // Soltó el dedo mientras el navegador preguntaba. No se graba medio segundo
    // de nada: se descarta el stream y se vuelve al principio.
    if (!desdeTeclado && punteroRef.current === null && !bloqueadaRef.current) {
      stream.getTracks().forEach((pista) => pista.stop());
      setEstado({ fase: "inactivo" });
      return;
    }

    streamRef.current = stream;
    trozosRef.current = [];
    cancelarRef.current = false;
    acumuladoRef.current = 0;
    inicioRef.current = Date.now();
    setTranscurrido(0);

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: elegido.grabacion });
    } catch {
      // El navegador dijo que soportaba el tipo y después no lo aceptó: se
      // reintenta dejándolo elegir. Pasa en algunas versiones de WebView.
      try {
        recorder = new MediaRecorder(stream);
      } catch {
        soltarRecursos();
        setEstado({ fase: "error" });
        return;
      }
    }
    recorderRef.current = recorder;
    recorder.ondataavailable = (evento) => {
      if (evento.data.size > 0) trozosRef.current.push(evento.data);
    };
    recorder.onstop = () => void cerrarGrabacion();
    recorder.start(250);

    conectarMedidor(stream);

    cronometroRef.current = setInterval(() => {
      const ms = acumuladoRef.current + (Date.now() - inicioRef.current);
      setTranscurrido(ms);
      if (ms >= MAX_DURACION_AUDIO_MS) detener();
    }, 200);

    bloqueadaRef.current = desdeTeclado;
    setEstado({ fase: "grabando", bloqueada: desdeTeclado, pausada: false });
  }

  function conectarMedidor(stream: MediaStream) {
    try {
      const Constructor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Constructor) return;
      const contexto = new Constructor();
      contextoRef.current = contexto;
      const analizador = contexto.createAnalyser();
      analizador.fftSize = 256;
      contexto.createMediaStreamSource(stream).connect(analizador);
      analizadorRef.current = analizador;
      if (!reduceMotion) rafRef.current = requestAnimationFrame(medir);
    } catch {
      // Sin medidor se graba igual: es decoración, no la feature.
    }
  }

  /** Cierra el blob, calcula la onda y pasa a la vista previa (paso 5). */
  async function cerrarGrabacion() {
    const elegido = mimeRef.current;
    const trozos = trozosRef.current;
    trozosRef.current = [];
    const msPorCronometro = acumuladoRef.current;
    const enviarYa = enviarAlCerrarRef.current;
    enviarAlCerrarRef.current = false;
    soltarRecursos();
    recorderRef.current = null;
    bloqueadaRef.current = false;
    punteroRef.current = null;
    gestoRef.current = { dx: 0, dy: 0 };
    setGesto({ dx: 0, dy: 0 });

    if (cancelarRef.current || trozos.length === 0 || !elegido) {
      setCerrando(false);
      setEstado({ fase: "inactivo" });
      setTranscurrido(0);
      return;
    }

    const blob = new Blob(trozos, { type: elegido.almacenamiento });
    const { onda, duracionMs } = await analizar(blob, msPorCronometro);
    setCerrando(false);
    if (enviarYa) {
      onListo({ blob, mime: elegido.almacenamiento, duracionMs, onda });
      setEstado({ fase: "inactivo" });
      setTranscurrido(0);
      return;
    }
    setEstado({
      fase: "previa",
      blob,
      mime: elegido.almacenamiento,
      duracionMs,
      onda,
      url: URL.createObjectURL(blob),
    });
  }

  /** `enviarAlTerminar`: manda sin pasar por la vista previa. */
  function detener(enviarAlTerminar = false) {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    enviarAlCerrarRef.current = enviarAlTerminar;
    setCerrando(true);
    if (recorder.state === "recording") {
      acumuladoRef.current += Date.now() - inicioRef.current;
    }
    if (cronometroRef.current !== null) {
      clearInterval(cronometroRef.current);
      cronometroRef.current = null;
    }
    recorder.stop();
  }

  function cancelar() {
    cancelarRef.current = true;
    // Perder una nota de voz no puede ser silencioso: el dedo tapa la barra
    // justo cuando desaparece, así que el único aviso posible es el del cuerpo.
    try {
      navigator.vibrate?.([12, 40, 12]);
    } catch {
      // sin soporte: nada que hacer
    }
    detener();
  }

  function alternarPausa() {
    const recorder = recorderRef.current;
    if (!recorder || estado.fase !== "grabando") return;
    if (recorder.state === "recording") {
      acumuladoRef.current += Date.now() - inicioRef.current;
      recorder.pause();
      setEstado({ ...estado, pausada: true });
    } else if (recorder.state === "paused") {
      inicioRef.current = Date.now();
      recorder.resume();
      setEstado({ ...estado, pausada: false });
    }
  }

  function descartarPrevia() {
    if (estado.fase === "previa") URL.revokeObjectURL(estado.url);
    setEstado({ fase: "inactivo" });
    setTranscurrido(0);
  }

  function enviar() {
    if (estado.fase !== "previa" || subiendo) return;
    setSubiendo(true);
    onListo({
      blob: estado.blob,
      mime: estado.mime,
      duracionMs: estado.duracionMs,
      onda: estado.onda,
    });
    URL.revokeObjectURL(estado.url);
    setSubiendo(false);
    setEstado({ fase: "inactivo" });
    setTranscurrido(0);
  }

  /* ----------------------------- Gestos (paso 3) ---------------------------- */

  /**
   * ⚠️ EL GESTO VIVE EN `window`, NO EN EL BOTÓN. No se puede volver atrás.
   *
   * Y el botón que recibió el dedo NO SE DESMONTA mientras se graba: es el
   * mismo <button> en `inactivo`, `pidiendo` y `grabando` (ver el render). En
   * iOS el `pointerup` se entrega al nodo donde empezó el toque; si ese nodo
   * ya no está en el documento, el evento no burbujea hasta `window` y la
   * grabación queda trabada sin nada que tocar.
   *
   * Historia: el micrófono ERA el botón del estado `inactivo`: en cuanto empezaba
   * a grabar, React lo DESMONTABA y en su lugar montaba la barra de grabación. Con
   * `onPointerUp` puesto en ese botón —y con `setPointerCapture` sobre él— el
   * "soltar" del dedo no llegaba nunca a ningún lado: su elemento ya no existía
   * y la captura se perdía con él.
   *
   * Consecuencia exacta, medida en el navegador: mantener apretado y soltar
   * dejaba la barra grabando para siempre, y en ese estado no hay UN SOLO
   * <button> en pantalla (el micrófono de la derecha es un <span>). Ni parar, ni
   * cancelar, ni enviar. El toque corto para entrar a manos libres moría por lo
   * mismo. Es, palabra por palabra, el reclamo del cliente: "el audio no tiene
   * un botón para enviar, o nunca se envía el audio".
   *
   * El efecto se vuelve a armar en cada cambio de `estado`, así que los
   * handlers siempre leen la fase actual en vez de la que había al apoyar el
   * dedo. El `touch-none` del botón sigue siendo necesario: sin él, el navegador
   * se queda con el gesto para hacer scroll y manda `pointercancel`.
   */
  useEffect(() => {
    if (!gestoActivo) return;

    function alMover(event: PointerEvent) {
      if (event.pointerId !== punteroRef.current) return;
      if (estado.fase !== "grabando" || estado.bloqueada) return;
      const centro = centroRef.current;
      const dx = Math.min(0, event.clientX - centro.x);
      const dy = Math.min(0, event.clientY - centro.y);
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) arrastroRef.current = true;
      gestoRef.current = { dx, dy };
      setGesto({ dx, dy });

      if (dy < -UMBRAL_BLOQUEAR && Math.abs(dy) > Math.abs(dx)) {
        bloqueadaRef.current = true;
        punteroRef.current = null;
        gestoRef.current = { dx: 0, dy: 0 };
        setGesto({ dx: 0, dy: 0 });
        setGestoActivo(false);
        setEstado({ fase: "grabando", bloqueada: true, pausada: false });
        try {
          navigator.vibrate?.(12);
        } catch {
          // sin soporte: nada que hacer
        }
      }
    }

    function alSubir(event: PointerEvent) {
      if (event.pointerId !== punteroRef.current) return;
      punteroRef.current = null;
      setGestoActivo(false);
      const duracion = Date.now() - bajadaRef.current;
      // Se lee del ref y no del estado: el último `pointermove` y este
      // `pointerup` pueden caer en el mismo frame, y ahí el estado todavía es
      // el de antes de arrastrar — soltar en la zona de cancelar enviaría el
      // audio.
      const cancelando = esGestoDeCancelar(gestoRef.current.dx, gestoRef.current.dy);
      gestoRef.current = { dx: 0, dy: 0 };
      setGesto({ dx: 0, dy: 0 });

      if (estado.fase === "pidiendo") return; // el permiso decide, no el dedo
      if (estado.fase !== "grabando" || estado.bloqueada) return;

      if (cancelando) {
        cancelar();
        return;
      }
      // Toque corto: manos libres en vez de una grabación de medio segundo.
      if (duracion < MS_DE_TOQUE && !arrastroRef.current) {
        bloqueadaRef.current = true;
        setEstado({ fase: "grabando", bloqueada: true, pausada: false });
        return;
      }
      detener(true);
    }

    window.addEventListener("pointermove", alMover);
    window.addEventListener("pointerup", alSubir);
    window.addEventListener("pointercancel", alSubir);
    return () => {
      window.removeEventListener("pointermove", alMover);
      window.removeEventListener("pointerup", alSubir);
      window.removeEventListener("pointercancel", alSubir);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `estado` es la dependencia real: re-arma los handlers con la fase fresca.
  }, [gestoActivo, estado]);

  function alBajar(event: React.PointerEvent<HTMLButtonElement>) {
    if (disabled || estado.fase !== "inactivo") return;
    if (punteroRef.current !== null) return; // un segundo dedo no reinicia nada
    punteroRef.current = event.pointerId;
    bajadaRef.current = Date.now();
    arrastroRef.current = false;
    gestoRef.current = { dx: 0, dy: 0 };
    setGesto({ dx: 0, dy: 0 });
    // El centro se guarda ACÁ porque el botón desaparece apenas arranca la
    // grabación: después no hay caja que medir para el deslizamiento.
    const caja = event.currentTarget.getBoundingClientRect();
    centroRef.current = { x: caja.left + caja.width / 2, y: caja.top + caja.height / 2 };
    setGestoActivo(true);
    void empezar(false);
  }

  /* -------------------------------- Pantalla -------------------------------- */

  if (estado.fase === "denegado" || estado.fase === "sinSoporte" || estado.fase === "error") {
    const titulo =
      estado.fase === "denegado"
        ? COPY_COMPOSER.voz.sinPermisoTitulo
        : estado.fase === "sinSoporte"
          ? COPY_COMPOSER.voz.sinSoporteTitulo
          : COPY_COMPOSER.voz.errorTitulo;
    const cuerpo =
      estado.fase === "denegado"
        ? COPY_COMPOSER.voz.sinPermisoCuerpo
        : estado.fase === "sinSoporte"
          ? COPY_COMPOSER.voz.sinSoporteCuerpo
          : COPY_COMPOSER.voz.errorCuerpo;
    return (
      <div
        role="status"
        className="flex flex-1 items-center gap-2 rounded-xl bg-warning-bg px-3 py-2"
      >
        <p className="min-w-0 flex-1 text-xs text-warning-ink">
          <span className="font-semibold">{titulo}. </span>
          {cuerpo}
        </p>
        <button
          type="button"
          onClick={() => setEstado({ fase: "inactivo" })}
          className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold text-warning-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {COPY_COMPOSER.adjuntar.cerrar}
        </button>
      </div>
    );
  }

  if (estado.fase === "previa") {
    return (
      // `cl-print-hide`: grabar no significa nada en papel, y el medidor y el
      // micrófono del gesto no son <button> (contrato de print-contract).
      <div className="cl-print-hide flex min-w-0 flex-1 flex-col gap-1">
        {/* El paso que faltaba decir. La barra de abajo se parece a la de
            grabar, así que sin este renglón nadie sabe que el audio TODAVÍA no
            salió y que falta un toque más. */}
        <p className="px-2 text-[11px] font-medium text-foreground-secondary" role="status">
          {COPY_COMPOSER.voz.vistaPrevia}
        </p>
        <div className="flex items-center gap-2 rounded-xl bg-surface-subtle px-2 py-1.5">
          <button
            type="button"
            onClick={descartarPrevia}
            aria-label={COPY_COMPOSER.voz.eliminar}
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-danger transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring) hover:bg-danger-bg active:scale-[0.9] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            <Trash size={19} aria-hidden="true" />
          </button>
          <VoicePlayer
            src={estado.url}
            duracionMs={estado.duracionMs}
            onda={estado.onda}
            className="min-w-0 flex-1"
          />
          <button
            type="button"
            onClick={enviar}
            disabled={subiendo}
            aria-label={COPY_COMPOSER.voz.enviar}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-xs transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring) hover:bg-brand-hover active:scale-[0.94] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            <PaperPlaneRight size={19} weight="fill" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  // inactivo, pidiendo y grabando comparten raíz y botón (ver el comentario del
  // gesto): el <button> del final es SIEMPRE el mismo nodo del DOM, en la misma
  // posición de hijos. Reordenar los hijos de este <div> o partirlo en varios
  // `return` vuelve a desmontarlo al empezar a grabar.
  const grabando = estado.fase === "grabando";
  const bloqueada = grabando && estado.bloqueada;
  const pausada = grabando && estado.pausada;
  const cancelando = grabando && esGestoDeCancelar(gesto.dx, gesto.dy);
  const progresoBloqueo = grabando ? Math.min(1, Math.abs(gesto.dy) / UMBRAL_BLOQUEAR) : 0;
  const sosteniendo = grabando && !bloqueada;

  return (
    <div
      className={cn(
        grabando
          ? "cl-print-hide relative flex flex-1 items-center gap-2 rounded-xl px-2.5 py-1.5 transition-colors duration-(--duration-fast)"
          : "contents",
        grabando && (cancelando ? "bg-danger-bg" : "bg-surface-subtle"),
      )}
    >
      {grabando &&
        (bloqueada ? (
          <button
            type="button"
            onClick={cancelar}
            disabled={cerrando}
            aria-label={COPY_COMPOSER.voz.eliminar}
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-danger transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring) hover:bg-danger-bg active:scale-[0.9] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            <Trash size={19} aria-hidden="true" />
          </button>
        ) : (
          <span
            aria-hidden="true"
            className={cn(
              "flex size-2.5 shrink-0 rounded-full bg-danger",
              !reduceMotion && "animate-pulse",
            )}
          />
        ))}

      {grabando && (
        <span
          className={cn(
            "shrink-0 font-mono text-xs tabular-nums",
            cancelando ? "text-danger-ink" : "text-foreground-secondary",
          )}
          role="timer"
          aria-live="off"
        >
          {formatearDuracion(transcurrido)}
        </span>
      )}

      {/* Medidor en vivo. Escala por `transform` desde un rAF; con
          prefers-reduced-motion queda quieto y el resto sigue funcionando. */}
      {grabando && (
        <span aria-hidden="true" className="flex h-5 shrink-0 items-center gap-[3px]">
          {Array.from({ length: BARRAS_EN_VIVO }, (_, indice) => (
            <span
              key={indice}
              ref={(nodo) => {
                barrasRef.current[indice] = nodo;
              }}
              className={cn(
                "h-full w-[3px] origin-center rounded-full",
                cancelando ? "bg-danger" : "bg-brand",
              )}
              style={{ transform: "scaleY(0.25)" }}
            />
          ))}
        </span>
      )}

      {grabando && (
        <p
          className={cn(
            "line-clamp-2 min-w-0 flex-1 text-xs leading-tight",
            cancelando ? "text-danger-ink" : "text-foreground-muted",
          )}
          role="status"
        >
          {bloqueada
            ? COPY_COMPOSER.voz.bloqueada
            : cancelando
              ? COPY_COMPOSER.voz.soltarCancelar
              : progresoBloqueo > 0.3
                ? COPY_COMPOSER.voz.deslizarBloquear
                : COPY_COMPOSER.voz.soltarEnviar}
        </p>
      )}

      {bloqueada && (
        <button
          type="button"
          onClick={alternarPausa}
          disabled={cerrando}
          aria-label={pausada ? COPY_COMPOSER.voz.seguir : COPY_COMPOSER.voz.pausar}
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-foreground-secondary transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring) hover:bg-surface-hover active:scale-[0.9] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring motion-reduce:transition-none motion-reduce:active:scale-100"
        >
          {pausada ? (
            <Play size={19} weight="fill" aria-hidden="true" />
          ) : (
            <Pause size={19} weight="fill" aria-hidden="true" />
          )}
        </button>
      )}

      {/* ⚠️ CUADRADO, NUNCA UN AVIÓN. Este botón TERMINA la grabación y abre
          la vista previa para escucharla: no manda nada. Cuando era un avión
          sobre `bg-brand` la gente tocaba, veía cambiar la barra y daba el audio
          por enviado. El avión sobre `bg-brand` es, en todo el grabador, UNA
          sola cosa: enviar de verdad. */}
      {bloqueada && (
        <button
          type="button"
          onClick={() => detener()}
          disabled={cerrando}
          aria-label={COPY_COMPOSER.voz.detener}
          title={COPY_COMPOSER.voz.detener}
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-foreground-secondary transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring) hover:bg-surface-hover active:scale-[0.9] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring motion-reduce:transition-none motion-reduce:active:scale-100"
        >
          <Stop size={19} weight="fill" aria-hidden="true" />
        </button>
      )}

      {sosteniendo && progresoBloqueo > 0.15 && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-4 bottom-full mb-2 flex flex-col items-center text-foreground-muted"
          style={{ opacity: progresoBloqueo }}
        >
          <ArrowUp size={14} weight="bold" />
          <Lock size={14} />
        </span>
      )}

      <button
        type="button"
        disabled={disabled || cerrando}
        onPointerDown={(event) => {
          clickEnviaRef.current = bloqueada;
          alBajar(event);
        }}
        onClick={(event) => {
          // `detail === 0`: click de teclado (Enter/Espacio) sobre el botón ya
          // en manos libres, que no pasa por `pointerdown`.
          const valido = clickEnviaRef.current || event.detail === 0;
          clickEnviaRef.current = false;
          if (bloqueada && valido) detener(true);
        }}
        onKeyDown={(event) => {
          if (estado.fase !== "inactivo") return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void empezar(true);
          }
        }}
        aria-label={
          bloqueada
            ? COPY_COMPOSER.voz.enviar
            : sosteniendo
              ? COPY_COMPOSER.voz.soltarEnviar
              : COPY_COMPOSER.voz.grabar
        }
        title={grabando ? undefined : COPY_COMPOSER.voz.mantener}
        className={cn(
          "flex size-11 shrink-0 touch-none select-none items-center justify-center rounded-full",
          "transition-[transform,background-color,color] duration-(--duration-fast) ease-(--ease-spring)",
          "disabled:pointer-events-none disabled:opacity-45",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          "motion-reduce:transition-none",
          !grabando &&
            "text-foreground-muted hover:bg-surface-hover hover:text-foreground active:scale-[0.9] motion-reduce:active:scale-100",
          estado.fase === "pidiendo" && "text-brand",
          grabando && "bg-brand text-brand-foreground shadow-xs",
          bloqueada && "hover:bg-brand-hover active:scale-[0.94] motion-reduce:active:scale-100",
        )}
        style={
          sosteniendo && !reduceMotion
            ? {
                transform: `translate3d(${gesto.dx}px, ${gesto.dy}px, 0) scale(${1 + progresoBloqueo * 0.08})`,
              }
            : undefined
        }
      >
        {bloqueada ? (
          <PaperPlaneRight size={19} weight="fill" aria-hidden="true" />
        ) : sosteniendo && progresoBloqueo > 0.3 ? (
          <Lock size={19} weight="fill" aria-hidden="true" />
        ) : (
          <Microphone
            size={22}
            weight={estado.fase === "inactivo" ? "regular" : "fill"}
            aria-hidden="true"
          />
        )}
      </button>
    </div>
  );
}

/**
 * La onda y la duración EXACTA, desde el audio ya grabado.
 *
 * `decodeAudioData` da la duración real; el cronómetro da la que midió el
 * navegador entre pausas. Se prefiere la primera y la segunda queda de
 * respaldo: hay navegadores donde decodificar el propio formato que acaban de
 * grabar falla (WebView de Android con webm/opus, sobre todo), y ahí una nota
 * de voz sin onda sigue siendo una nota de voz — una que no se puede mandar,
 * no.
 */
async function analizar(
  blob: Blob,
  msPorCronometro: number,
): Promise<{ onda: number[]; duracionMs: number }> {
  const plana = Array.from({ length: PICOS_DE_ONDA }, () => 0);
  try {
    const Constructor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) return { onda: plana, duracionMs: msPorCronometro };
    const contexto = new Constructor();
    try {
      const buffer = await contexto.decodeAudioData(await blob.arrayBuffer());
      return {
        onda: calcularOnda(buffer.getChannelData(0), PICOS_DE_ONDA),
        duracionMs: Math.round(buffer.duration * 1000),
      };
    } finally {
      void contexto.close().catch(() => {});
    }
  } catch {
    return { onda: plana, duracionMs: msPorCronometro };
  }
}
