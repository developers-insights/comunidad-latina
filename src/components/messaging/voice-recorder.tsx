"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CaretLeft,
  Microphone,
  PaperPlaneRight,
  Trash,
} from "@phosphor-icons/react/dist/ssr";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import {
  MAX_DURACION_AUDIO_MS,
  MIN_DURACION_AUDIO_MS,
  elegirMimeDeGrabacion,
  formatearDuracion,
  soporteDeGrabacion,
  type MimeDeGrabacion,
  calcularOnda,
  PICOS_DE_ONDA,
} from "@/lib/messaging/audio";
import { COPY_COMPOSER } from "./copy-composer";

/**
 * Notas de voz como WhatsApp: se mantiene apretado el micrófono y graba,
 * soltar manda, deslizar a la izquierda cancela. Sin manos libres ni vista
 * previa: el dueño pidió sacarlos (30/9).
 *
 * El gesto sostenido no es la única puerta: Enter/Espacio (o el click de un
 * lector de pantalla, que llega con `detail === 0` y sin `pointerdown`) graban
 * en modo "alternar" — el mismo botón manda, y hay un tachito y Escape para
 * cancelar.
 *
 * `getUserMedia` se pide dentro del gesto, nunca al montar. Si deja de andar de
 * golpe, mirar primero `Permissions-Policy: microphone=(self)` en
 * `next.config.ts`: sin ese header el navegador rechaza sin preguntar y se ve
 * igual que un "no" del usuario.
 */

type Estado =
  | { fase: "inactivo" }
  | { fase: "pidiendo" }
  | { fase: "grabando"; teclado: boolean }
  | { fase: "descartando" }
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
  onListo: (grabacion: GrabacionLista) => void;
  /** `true` mientras el grabador ocupa la barra: el composer esconde el resto. */
  onActivo?: (activo: boolean) => void;
}

const UMBRAL_CANCELAR = 110;
const FRACCION_DEL_ANCHO = 0.4;
const MS_AVISO = 1800;
const MS_TACHITO = 650;
const ESCALA_SOSTENIDO = 1.4;
const EASE_SALIDA = "cubic-bezier(0.23, 1, 0.32, 1)";

/**
 * Exige que el arrastre sea claramente horizontal: un dedo que se corre en
 * diagonal hacia arriba mientras habla no está tirando la nota.
 */
export function esGestoDeCancelar(dx: number, dy: number, umbral = UMBRAL_CANCELAR): boolean {
  return dx < -umbral && Math.abs(dx) > Math.abs(dy);
}

function vibrar(patron: number | number[]) {
  try {
    navigator.vibrate?.(patron);
  } catch {
    // sin soporte
  }
}

export function VoiceRecorder({ disabled = false, onListo, onActivo }: VoiceRecorderProps) {
  const reduceMotion = useReducedMotion();
  const [estado, setEstado] = useState<Estado>({ fase: "inactivo" });
  const [transcurrido, setTranscurrido] = useState(0);
  const [dx, setDx] = useState(0);
  const [cerrando, setCerrando] = useState(false);
  const [gestoActivo, setGestoActivo] = useState(false);
  const [aviso, setAviso] = useState(false);

  const raizRef = useRef<HTMLDivElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trozosRef = useRef<Blob[]>([]);
  const mimeRef = useRef<MimeDeGrabacion | null>(null);
  const inicioRef = useRef(0);
  const acumuladoRef = useRef(0);
  const cancelarRef = useRef(false);
  const tachitoRef = useRef(false);
  const enviarAlCerrarRef = useRef(false);
  /**
   * El click que cierra un toque sobre el botón en modo teclado sólo manda si
   * el dedo BAJÓ cuando ya se estaba grabando; si no, el mismo Enter que
   * arrancó la grabación la mandaría vacía.
   */
  const clickEnviaRef = useRef(false);
  const punteroRef = useRef<number | null>(null);
  const bajadaRef = useRef(0);
  const soltoCortoMientrasPediaRef = useRef(false);
  const cronometroRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gestoRef = useRef({ dx: 0, dy: 0 });
  const centroRef = useRef({ x: 0, y: 0 });
  const umbralRef = useRef(UMBRAL_CANCELAR);
  const avisoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tachitoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activo =
    estado.fase === "grabando" || estado.fase === "pidiendo" || estado.fase === "descartando";

  useEffect(() => {
    onActivo?.(activo);
  }, [activo, onActivo]);

  const soltarRecursos = useCallback(() => {
    if (cronometroRef.current !== null) {
      clearInterval(cronometroRef.current);
      cronometroRef.current = null;
    }
    streamRef.current?.getTracks().forEach((pista) => pista.stop());
    streamRef.current = null;
  }, []);

  useEffect(
    () => () => {
      soltarRecursos();
      if (avisoTimerRef.current) clearTimeout(avisoTimerRef.current);
      if (tachitoTimerRef.current) clearTimeout(tachitoTimerRef.current);
    },
    [soltarRecursos],
  );

  function mostrarAviso() {
    if (avisoTimerRef.current) clearTimeout(avisoTimerRef.current);
    setAviso(true);
    avisoTimerRef.current = setTimeout(() => setAviso(false), MS_AVISO);
  }

  function reiniciarGesto() {
    gestoRef.current = { dx: 0, dy: 0 };
    setDx(0);
  }

  async function empezar(desdeTeclado: boolean) {
    if (disabled || estado.fase !== "inactivo") return;
    setAviso(false);

    const elegido = elegirMimeDeGrabacion(soporteDeGrabacion());
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

    // En el teléfono el micrófono (y la primera vez, el cartel de permiso)
    // tarda más que un toque: si el dedo ya se levantó, no hay nada que grabar.
    if (!desdeTeclado && punteroRef.current === null) {
      stream.getTracks().forEach((pista) => pista.stop());
      setEstado({ fase: "inactivo" });
      if (soltoCortoMientrasPediaRef.current) mostrarAviso();
      soltoCortoMientrasPediaRef.current = false;
      return;
    }

    streamRef.current = stream;
    trozosRef.current = [];
    cancelarRef.current = false;
    tachitoRef.current = false;
    acumuladoRef.current = 0;
    inicioRef.current = Date.now();
    setTranscurrido(0);

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: elegido.grabacion });
    } catch {
      // Algunas WebView dicen soportar el tipo y después lo rechazan.
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

    cronometroRef.current = setInterval(() => {
      const ms = acumuladoRef.current + (Date.now() - inicioRef.current);
      setTranscurrido(ms);
      if (ms >= MAX_DURACION_AUDIO_MS) detener(true);
    }, 200);

    if (!desdeTeclado) vibrar(10);
    setEstado({ fase: "grabando", teclado: desdeTeclado });
  }

  async function cerrarGrabacion() {
    const elegido = mimeRef.current;
    const trozos = trozosRef.current;
    trozosRef.current = [];
    const msPorCronometro = acumuladoRef.current;
    const enviarYa = enviarAlCerrarRef.current;
    enviarAlCerrarRef.current = false;
    soltarRecursos();
    recorderRef.current = null;
    punteroRef.current = null;
    reiniciarGesto();

    if (cancelarRef.current || !enviarYa || trozos.length === 0 || !elegido) {
      setCerrando(false);
      if (!tachitoRef.current) setEstado({ fase: "inactivo" });
      setTranscurrido(0);
      return;
    }

    const blob = new Blob(trozos, { type: elegido.almacenamiento });
    const { onda, duracionMs } = await analizar(blob, msPorCronometro);
    setCerrando(false);
    setEstado({ fase: "inactivo" });
    setTranscurrido(0);
    onListo({ blob, mime: elegido.almacenamiento, duracionMs, onda });
  }

  function detener(enviar: boolean) {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    enviarAlCerrarRef.current = enviar;
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
    if (estado.fase !== "grabando") return;
    cancelarRef.current = true;
    tachitoRef.current = true;
    punteroRef.current = null;
    setGestoActivo(false);
    // El dedo tapa la barra justo cuando la nota desaparece: el único aviso
    // que seguro llega es el del cuerpo.
    vibrar([12, 40, 12]);
    detener(false);
    setEstado({ fase: "descartando" });
    if (tachitoTimerRef.current) clearTimeout(tachitoTimerRef.current);
    tachitoTimerRef.current = setTimeout(
      () => {
        tachitoRef.current = false;
        setEstado({ fase: "inactivo" });
      },
      reduceMotion ? 350 : MS_TACHITO,
    );
  }

  function descartarCorta() {
    cancelarRef.current = true;
    detener(false);
    mostrarAviso();
  }

  /**
   * El gesto se escucha en `window` (además de la captura del puntero) y el
   * <button> que recibió el dedo NO SE DESMONTA mientras graba: en iOS el
   * `pointerup` se entrega al nodo donde empezó el toque, y si ese nodo ya no
   * está en el documento la grabación queda trabada sin nada que tocar. Pasó.
   *
   * El efecto se re-arma con cada `estado` para que los handlers lean la fase
   * actual y no la del momento en que se apoyó el dedo.
   */
  useEffect(() => {
    if (!gestoActivo) return;

    function alMover(event: PointerEvent) {
      if (event.pointerId !== punteroRef.current) return;
      if (estado.fase !== "grabando" || estado.teclado) return;
      const nuevoDx = Math.min(0, event.clientX - centroRef.current.x);
      const dy = event.clientY - centroRef.current.y;
      gestoRef.current = { dx: nuevoDx, dy };
      setDx(nuevoDx);
      if (esGestoDeCancelar(nuevoDx, dy, umbralRef.current)) cancelar();
    }

    function alSubir(event: PointerEvent) {
      if (event.pointerId !== punteroRef.current) return;
      punteroRef.current = null;
      setGestoActivo(false);
      const { dx: dxFinal, dy } = gestoRef.current;
      reiniciarGesto();

      if (estado.fase === "pidiendo") {
        soltoCortoMientrasPediaRef.current =
          Date.now() - bajadaRef.current < MIN_DURACION_AUDIO_MS;
        return;
      }
      if (estado.fase !== "grabando" || estado.teclado) return;

      // `pointercancel` es el sistema robándose el gesto (una llamada, un
      // scroll): mandar un audio que nadie decidió mandar es peor que perderlo.
      if (event.type === "pointercancel" || esGestoDeCancelar(dxFinal, dy, umbralRef.current)) {
        cancelar();
        return;
      }
      const grabado = acumuladoRef.current + (Date.now() - inicioRef.current);
      if (grabado < MIN_DURACION_AUDIO_MS) {
        descartarCorta();
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
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if (punteroRef.current !== null) return;
    punteroRef.current = event.pointerId;
    bajadaRef.current = Date.now();
    soltoCortoMientrasPediaRef.current = false;
    reiniciarGesto();
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // jsdom y algunos WebView viejos
    }
    const caja = event.currentTarget.getBoundingClientRect();
    centroRef.current = { x: caja.left + caja.width / 2, y: caja.top + caja.height / 2 };
    // El ancho real de la barra se conoce recién cuando se expande; hasta
    // entonces se toma el del formulario que la contiene.
    const ancho =
      raizRef.current?.parentElement?.getBoundingClientRect().width ?? 0;
    umbralRef.current =
      ancho > 0 ? Math.min(UMBRAL_CANCELAR, ancho * FRACCION_DEL_ANCHO) : UMBRAL_CANCELAR;
    setGestoActivo(true);
    void empezar(false);
  }

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
        role="alert"
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

  // ⚠️ Los hijos de este <div> van SIEMPRE en los mismos lugares (condicionales
  // `&&`, nunca `return` distintos): el <button> del final tiene que ser el
  // mismo nodo del DOM antes y durante la grabación (ver el efecto del gesto).
  const grabando = estado.fase === "grabando";
  const teclado = grabando && estado.teclado;
  const sosteniendo = (grabando && !estado.teclado) || estado.fase === "pidiendo";
  const descartando = estado.fase === "descartando";
  const enBarra = activo;
  const progreso = Math.min(1, Math.abs(dx) / umbralRef.current);
  const siguiendoAlDedo = gestoActivo && dx !== 0;

  return (
    <div
      ref={raizRef}
      className={cn(
        enBarra
          ? "cl-print-hide relative flex min-w-0 flex-1 items-center gap-3 rounded-xl bg-surface-subtle py-1 pl-3"
          : "relative flex shrink-0",
      )}
    >
      {teclado && (
        <button
          type="button"
          onClick={cancelar}
          disabled={cerrando}
          aria-label={COPY_COMPOSER.voz.eliminar}
          className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full text-danger transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring) hover:bg-danger-bg active:scale-[0.94] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring motion-reduce:transition-none motion-reduce:active:scale-100"
        >
          <Trash size={19} aria-hidden="true" />
        </button>
      )}

      {sosteniendo && (
        <span
          aria-hidden="true"
          className={cn(
            "size-2.5 shrink-0 rounded-full",
            grabando ? "bg-danger" : "bg-foreground-muted",
            grabando && !reduceMotion && "animate-pulse",
          )}
        />
      )}

      {descartando && (
        <m.span
          aria-hidden="true"
          className="flex shrink-0 text-danger"
          initial={
            reduceMotion
              ? { opacity: 0 }
              : { opacity: 0, transform: "translateY(6px) scale(0.9) rotate(0deg)" }
          }
          animate={
            reduceMotion
              ? { opacity: 1 }
              : {
                  opacity: [0, 1, 1, 0],
                  transform: [
                    "translateY(6px) scale(0.9) rotate(0deg)",
                    "translateY(0px) scale(1.1) rotate(0deg)",
                    "translateY(0px) scale(1) rotate(-14deg)",
                    "translateY(2px) scale(0.9) rotate(0deg)",
                  ],
                }
          }
          transition={{ duration: MS_TACHITO / 1000, times: [0, 0.3, 0.6, 1], ease: "easeOut" }}
        >
          <Trash size={18} weight="fill" />
        </m.span>
      )}

      {(grabando || estado.fase === "pidiendo") && (
        <span
          className="shrink-0 font-mono text-sm tabular-nums text-foreground-secondary"
          role="timer"
          aria-live="off"
        >
          {formatearDuracion(transcurrido)}
        </span>
      )}

      {enBarra && (
        <div className="flex min-w-0 flex-1 items-center justify-center overflow-hidden">
          {descartando ? (
            <p className="truncate text-xs font-medium text-danger-ink" role="status">
              {COPY_COMPOSER.voz.cancelada}
            </p>
          ) : teclado ? (
            <p className="truncate text-xs text-foreground-muted" role="status">
              {COPY_COMPOSER.voz.grabandoTeclado}
            </p>
          ) : (
            <p
              className="flex items-center gap-1 truncate text-xs text-foreground-muted"
              style={{
                opacity: 1 - progreso * 0.9,
                transform: reduceMotion ? undefined : `translate3d(${dx * 0.6}px, 0, 0)`,
                transition: siguiendoAlDedo
                  ? "none"
                  : `transform 220ms ${EASE_SALIDA}, opacity 220ms ${EASE_SALIDA}`,
              }}
            >
              <m.span
                aria-hidden="true"
                className="flex"
                animate={
                  reduceMotion
                    ? undefined
                    : { transform: ["translateX(0px)", "translateX(-3px)", "translateX(0px)"] }
                }
                transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
              >
                <CaretLeft size={12} weight="bold" />
              </m.span>
              {COPY_COMPOSER.voz.deslizarCancelar}
            </p>
          )}
        </div>
      )}

      <AnimatePresence>
        {aviso && (
          <m.span
            key="aviso"
            role="status"
            className="pointer-events-none absolute right-0 bottom-full z-10 mb-2 whitespace-nowrap rounded-full border border-border bg-surface-raised px-3 py-1.5 text-xs font-medium text-foreground shadow-md"
            style={{ transformOrigin: "bottom right" }}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(4px) scale(0.96)" }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, transform: "translateY(0px) scale(1)" }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          >
            {COPY_COMPOSER.voz.mantener}
          </m.span>
        )}
      </AnimatePresence>

      <button
        type="button"
        disabled={disabled}
        onPointerDown={(event) => {
          clickEnviaRef.current = teclado;
          alBajar(event);
        }}
        onClick={(event) => {
          if (cerrando || descartando) return;
          const sinPuntero = event.detail === 0;
          if (estado.fase === "inactivo") {
            if (sinPuntero && punteroRef.current === null) void empezar(true);
            return;
          }
          const valido = clickEnviaRef.current || sinPuntero;
          clickEnviaRef.current = false;
          if (teclado && valido) detener(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && teclado) {
            event.preventDefault();
            cancelar();
          }
        }}
        onContextMenu={(event) => event.preventDefault()}
        aria-label={
          teclado
            ? COPY_COMPOSER.voz.enviar
            : sosteniendo
              ? COPY_COMPOSER.voz.soltarEnviar
              : COPY_COMPOSER.voz.grabar
        }
        title={enBarra ? undefined : COPY_COMPOSER.voz.mantener}
        className={cn(
          "relative flex size-11 shrink-0 touch-none select-none items-center justify-center rounded-full [-webkit-touch-callout:none]",
          "transition-[background-color,color] duration-(--duration-fast)",
          "disabled:pointer-events-none",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          !enBarra &&
            "text-foreground-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-45",
          (grabando || estado.fase === "pidiendo") &&
            "z-10 bg-brand text-brand-foreground shadow-md",
          teclado && "hover:bg-brand-hover",
          descartando && "text-foreground-muted",
        )}
        style={{
          transform:
            sosteniendo && !reduceMotion
              ? `translate3d(${dx}px, 0, 0) scale(${ESCALA_SOSTENIDO - progreso * 0.2})`
              : undefined,
          transition: siguiendoAlDedo
            ? "background-color 120ms ease, color 120ms ease"
            : `transform 240ms ${EASE_SALIDA}, background-color 120ms ease, color 120ms ease`,
        }}
      >
        {teclado ? (
          <PaperPlaneRight size={19} weight="fill" aria-hidden="true" />
        ) : (
          <Microphone
            size={22}
            weight={estado.fase === "inactivo" || descartando ? "regular" : "fill"}
            aria-hidden="true"
          />
        )}
      </button>
    </div>
  );
}

/**
 * La onda y la duración EXACTA desde el audio grabado. Si decodificar falla
 * (WebView de Android con webm/opus), queda la del cronómetro y una onda
 * plana: una nota sin onda se puede mandar igual.
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
