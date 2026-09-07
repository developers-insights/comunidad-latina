"use client";

import { useEffect, useRef } from "react";
import type { ILocalVideoTrack, IRemoteVideoTrack } from "agora-rtc-sdk-ng";
import { MicrophoneSlash, VideoCameraSlash } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui";
import { COPY } from "./copy";
import styles from "./llamada.module.css";

export interface MosaicoProps {
  nombre: string;
  avatarUrl: string | null;
  /** La pista de video, si esta persona está publicando. */
  video: ILocalVideoTrack | IRemoteVideoTrack | null;
  micApagado: boolean;
  camaraApagada: boolean;
  /** Todavía no atendió: se pinta atenuado y con su propia etiqueta. */
  esperando?: boolean;
  soyYo?: boolean;
  /** Orden de entrada, para escalonar la aparición. */
  indice?: number;
  className?: string;
}

/**
 * Un mosaico = una persona.
 *
 * ── POR QUÉ EL VIDEO LO MONTA ESTE COMPONENTE Y NO EL MOTOR ─────────────────
 * `track.play(elemento)` mete un `<video>` adentro del div que se le pasa,
 * fuera de React. Si el motor lo hiciera, tendría que conocer el DOM de la
 * pantalla y acordarse de llamar a `stop()` cada vez que un mosaico se
 * desmonta — y un `stop()` que no se llama deja un `<video>` reproduciendo en un
 * nodo huérfano, que es un `<video>` que sigue decodificando. Acá el efecto vive
 * al lado del nodo, y su limpieza es la del propio `useEffect`.
 *
 * El espejo (`scale-x-[-1]`) va sólo en el video propio: uno se ve como en un
 * espejo, a los demás se los ve como son.
 */
export function Mosaico({
  nombre,
  avatarUrl,
  video,
  micApagado,
  camaraApagada,
  esperando = false,
  soyYo = false,
  indice = 0,
  className,
}: MosaicoProps) {
  const contenedor = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const nodo = contenedor.current;
    if (!video || !nodo) return;
    video.play(nodo, { fit: "cover" });
    return () => {
      video.stop();
    };
  }, [video]);

  const mostrandoVideo = Boolean(video) && !camaraApagada;

  return (
    <figure
      className={cn(
        styles.mosaico,
        "group relative isolate flex min-h-0 items-center justify-center overflow-hidden",
        "rounded-[calc(var(--radius-xl)-0.375rem)] bg-white/[0.06] ring-1 ring-inset ring-white/10",
        "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.10)]",
        esperando && "opacity-60",
        className,
      )}
      style={{ "--cl-mosaico-retraso": `${Math.min(indice, 9) * 45}ms` } as React.CSSProperties}
    >
      <div
        ref={contenedor}
        className={cn(
          "absolute inset-0",
          soyYo && "scale-x-[-1]",
          mostrandoVideo ? "opacity-100" : "opacity-0",
        )}
      />

      {!mostrandoVideo && (
        <div className="relative flex flex-col items-center gap-2 px-3 text-center">
          <Avatar src={avatarUrl} name={nombre} size="lg" />
          {esperando && (
            <span className="text-[11px] font-medium text-on-media/70">
              {COPY.pantalla.conectandose}
            </span>
          )}
        </div>
      )}

      <figcaption className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/65 to-transparent px-2.5 pb-2 pt-6">
        {micApagado && (
          <span
            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-danger/85 text-on-danger"
            title={COPY.pantalla.silenciado}
          >
            <MicrophoneSlash size={12} weight="fill" aria-hidden="true" />
            <span className="sr-only">{COPY.pantalla.silenciado}</span>
          </span>
        )}
        {camaraApagada && !micApagado && (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white/15 text-on-media">
            <VideoCameraSlash size={12} aria-hidden="true" />
            <span className="sr-only">{COPY.pantalla.sinCamara}</span>
          </span>
        )}
        <span className="truncate text-xs font-semibold text-on-media">
          {soyYo ? COPY.pantalla.vos : nombre}
        </span>
      </figcaption>
    </figure>
  );
}
