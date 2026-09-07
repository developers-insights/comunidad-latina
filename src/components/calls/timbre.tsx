"use client";

import { useEffect } from "react";
import { Phone, PhoneSlash, VideoCamera } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Avatar, BottomSheet, Button } from "@/components/ui";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import type { LlamadaEntrante } from "@/lib/calls/vigilancia";
import { COPY } from "./copy";
import styles from "./llamada.module.css";

export interface TimbreProps {
  entrante: LlamadaEntrante;
  onAtender: () => void;
  onRechazar: () => void;
  atendiendo: boolean;
}

/**
 * El timbre.
 *
 * Es una hoja y no un diálogo modal a propósito: una llamada entrante no tiene
 * que secuestrar el teclado ni el foco de lo que la persona estaba haciendo —
 * puede estar terminando de escribir un mensaje— pero sí tiene que ser lo
 * primero que se ve. La hoja entra desde abajo, que es de donde entra todo lo
 * demás en esta app, y se cierra con Escape como cualquier otra.
 *
 * Vibra donde el navegador lo permita (Android). No suena: reproducir audio sin
 * un gesto previo lo bloquean todos los navegadores, y un timbre que suena "a
 * veces" es peor que uno que no suena — la persona aprendería a no confiar en él.
 */
export function Timbre({ entrante, onAtender, onRechazar, atendiendo }: TimbreProps) {
  const sinMovimiento = usePrefersReducedMotion();
  const esVideo = entrante.kind === "video";
  const nombre = entrante.quienLlama?.displayName ?? "Alguien de la comunidad";

  useEffect(() => {
    if (sinMovimiento) return;
    const vibrar = navigator.vibrate?.bind(navigator);
    if (!vibrar) return;
    const patron = [220, 180, 220, 900];
    vibrar(patron);
    const id = window.setInterval(() => vibrar(patron), 1520);
    return () => {
      window.clearInterval(id);
      vibrar(0);
    };
  }, [sinMovimiento]);

  return (
    <BottomSheet open onClose={onRechazar} ariaLabel={COPY.timbre.ariaLabel}>
      <div className="flex flex-col items-center gap-4 pb-2 pt-2 text-center">
        <p className="sr-only" role="status" aria-live="assertive">
          {COPY.timbre.ariaLabel}: {nombre}
        </p>

        <span className="relative flex items-center justify-center">
          <span
            aria-hidden="true"
            className={cn(styles.halo, "absolute size-16 rounded-full ring-2 ring-inset ring-brand/60")}
          />
          <span
            aria-hidden="true"
            className={cn(
              styles.haloTardio,
              "absolute size-16 rounded-full ring-2 ring-inset ring-brand/60",
            )}
          />
          <Avatar src={entrante.quienLlama?.avatarUrl ?? null} name={nombre} size="xl" />
        </span>

        <div>
          <p className="font-display text-xl font-semibold text-foreground">{nombre}</p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-foreground-secondary">
            {esVideo ? (
              <VideoCamera size={15} aria-hidden="true" />
            ) : (
              <Phone size={15} aria-hidden="true" />
            )}
            {entrante.grupoNombre
              ? COPY.timbre.enGrupo(entrante.grupoNombre)
              : esVideo
                ? COPY.timbre.video
                : COPY.timbre.audio}
          </p>
        </div>

        <div className="mt-1 flex w-full gap-2.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <Button
            variant="danger"
            className="h-13 flex-1 rounded-full"
            onClick={onRechazar}
            disabled={atendiendo}
          >
            <PhoneSlash size={18} weight="fill" aria-hidden="true" />
            {COPY.controles.rechazar}
          </Button>
          <Button
            className="h-13 flex-1 bg-success text-on-success hover:bg-success/90"
            onClick={onAtender}
            loading={atendiendo}
          >
            {!atendiendo && <Phone size={18} weight="fill" aria-hidden="true" />}
            {atendiendo ? COPY.timbre.atendiendo : COPY.controles.atender}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
