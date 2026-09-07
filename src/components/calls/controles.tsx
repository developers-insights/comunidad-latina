"use client";

import {
  ChatCircleDots,
  Microphone,
  MicrophoneSlash,
  PhoneDisconnect,
  SpeakerHigh,
  SpeakerSlash,
  UserPlus,
  VideoCamera,
  VideoCameraSlash,
} from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import styles from "./llamada.module.css";

interface ControlProps {
  etiqueta: string;
  ariaLabel: string;
  icono: React.ReactNode;
  onClick: () => void;
  /** El estado "apagado" se pinta encendido: es el que hay que poder ver de reojo. */
  activo?: boolean;
  destructivo?: boolean;
  disabled?: boolean;
}

/**
 * Un control de la bandeja.
 *
 * El área táctil es de 44px reales aunque el círculo pintado mida menos: en un
 * teléfono, seis botones en una fila caen justo en el ancho donde el pulgar
 * empieza a errarle, y esta es la barra que más se toca de toda la app.
 *
 * `aria-pressed` y no sólo `aria-label`: un lector de pantalla tiene que poder
 * decir si el micrófono está apagado sin que la persona lo deduzca del nombre
 * del botón, que cambia.
 */
function Control({
  etiqueta,
  ariaLabel,
  icono,
  onClick,
  activo = false,
  destructivo = false,
  disabled = false,
}: ControlProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      {...(destructivo ? {} : { "aria-pressed": activo })}
      className={cn(
        "group flex min-h-11 cursor-pointer select-none flex-col items-center gap-1.5 rounded-2xl px-0.5 py-1.5",
        "transition-[transform,opacity] duration-(--duration-fast) ease-(--ease-spring)",
        "active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
      )}
    >
      <span
        className={cn(
          "flex size-11 items-center justify-center rounded-full ring-1 ring-inset",
          "transition-[background-color,color,box-shadow] duration-(--duration-fast)",
          destructivo
            ? "bg-danger text-on-danger ring-white/20 shadow-[0_6px_18px_-6px_var(--color-danger)]"
            : activo
              ? "bg-on-media text-media-backdrop ring-white/40"
              : "bg-white/10 text-on-media ring-white/15 group-hover:bg-white/[0.18]",
        )}
      >
        {icono}
      </span>
      <span className="text-[10px] font-medium leading-tight text-on-media/75">{etiqueta}</span>
    </button>
  );
}

export interface ControlesProps {
  kind: "audio" | "video";
  micApagado: boolean;
  camaraApagada: boolean;
  sonidoApagado: boolean;
  puedeAgregar: boolean;
  hrefDelChat: string | null;
  onMic: () => void;
  onCamara: () => void;
  onSonido: () => void;
  onAgregar: () => void;
  onChat: () => void;
  onFinalizar: () => void;
}

/**
 * Los seis controles, en una bandeja con doble borde (cáscara translúcida +
 * núcleo) para que se lea como una pieza apoyada sobre el video y no como una
 * barra pegada al borde inferior.
 *
 * `pb-[env(safe-area-inset-bottom)]`: en un iPhone la barra de gestos se come
 * los últimos 34px, y "Finalizar" es el peor botón posible para dejar debajo de
 * un borde donde el sistema intercepta el toque.
 */
export function Controles(props: ControlesProps) {
  const {
    kind,
    micApagado,
    camaraApagada,
    sonidoApagado,
    puedeAgregar,
    hrefDelChat,
    onMic,
    onCamara,
    onSonido,
    onAgregar,
    onChat,
    onFinalizar,
  } = props;

  return (
    <div
      className={cn(
        styles.bandeja,
        "sticky bottom-0 mx-auto w-full max-w-lg px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3",
      )}
    >
      <div className="rounded-[2rem] bg-white/[0.07] p-1.5 ring-1 ring-inset ring-white/12 backdrop-blur-xl">
        <div className="grid grid-cols-6 gap-0.5 rounded-[calc(2rem-0.375rem)] bg-black/25 px-1 py-1.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]">
          <Control
            etiqueta={micApagado ? COPY.controles.activarMic : COPY.controles.silenciar}
            ariaLabel={micApagado ? COPY.controles.activarMicAria : COPY.controles.silenciarAria}
            icono={
              micApagado ? (
                <MicrophoneSlash size={20} weight="fill" aria-hidden="true" />
              ) : (
                <Microphone size={20} aria-hidden="true" />
              )
            }
            activo={micApagado}
            onClick={onMic}
          />

          <Control
            etiqueta={COPY.controles.video}
            ariaLabel={
              camaraApagada ? COPY.controles.prenderCamaraAria : COPY.controles.apagarCamaraAria
            }
            icono={
              camaraApagada ? (
                <VideoCameraSlash size={20} weight="fill" aria-hidden="true" />
              ) : (
                <VideoCamera size={20} aria-hidden="true" />
              )
            }
            activo={camaraApagada}
            // En una llamada de audio no hay cámara que prender: el control
            // queda deshabilitado en vez de desaparecer, así los seis botones no
            // se mueven de lugar entre una llamada y otra.
            disabled={kind === "audio"}
            onClick={onCamara}
          />

          <Control
            etiqueta={COPY.controles.altavoz}
            ariaLabel={
              sonidoApagado ? COPY.controles.encenderSonidoAria : COPY.controles.apagarSonidoAria
            }
            icono={
              sonidoApagado ? (
                <SpeakerSlash size={20} weight="fill" aria-hidden="true" />
              ) : (
                <SpeakerHigh size={20} aria-hidden="true" />
              )
            }
            activo={sonidoApagado}
            onClick={onSonido}
          />

          <Control
            etiqueta={COPY.controles.anadir}
            ariaLabel={COPY.controles.anadirAria}
            icono={<UserPlus size={20} aria-hidden="true" />}
            disabled={!puedeAgregar}
            onClick={onAgregar}
          />

          <Control
            etiqueta={COPY.controles.chat}
            ariaLabel={COPY.controles.chatAria}
            icono={<ChatCircleDots size={20} aria-hidden="true" />}
            disabled={!hrefDelChat}
            onClick={onChat}
          />

          <Control
            etiqueta={COPY.controles.finalizar}
            ariaLabel={COPY.controles.finalizarAria}
            icono={<PhoneDisconnect size={20} weight="fill" aria-hidden="true" />}
            destructivo
            onClick={onFinalizar}
          />
        </div>
      </div>
    </div>
  );
}
