"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { ChatCircleText, CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { Avatar, Button, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { responderSolicitudAction } from "@/app/(app)/notificaciones/solicitud-actions";
import {
  chatHref,
  partirTituloPorActor,
  perfilHref,
  type DecisionSolicitud,
  type EstadoSolicitud,
  type ResponderSolicitudResult,
  type SolicitudDelAviso,
} from "@/lib/notifications/solicitud";
import { COPY } from "./copy";

export type SolicitudEnAvisoProps = {
  notificationId: string;
  solicitud: SolicitudDelAviso;
  titulo: string;
  createdAt: string;
  timeLabel: string;
  leida: boolean;
  compacta?: boolean;
  /** Al tocar un enlace: la gaveta de la campana se cierra antes de navegar. */
  onNavegar?: () => void;
  /** Responder marca el aviso leído; el globito se entera sin esperar a la base. */
  onLeida?: () => void;
};

const linkFoco =
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring";

export function SolicitudEnAviso({
  notificationId,
  solicitud,
  titulo,
  createdAt,
  timeLabel,
  leida,
  compacta = false,
  onNavegar,
  onLeida,
}: SolicitudEnAvisoProps) {
  const { toast } = useToast();
  const reduceMotion = useReducedMotion();
  const [estadoServidor, setEstadoServidor] = useState(solicitud.estado);
  const [estado, setEstado] = useState<EstadoSolicitud>(solicitud.estado);
  const [yaLeida, setYaLeida] = useState(leida);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();
  const enCurso = useRef(false);

  if (estadoServidor !== solicitud.estado) {
    setEstadoServidor(solicitud.estado);
    setEstado(solicitud.estado);
  }

  const { actor } = solicitud;
  const { conNombre, resto } = partirTituloPorActor(titulo, actor.nombre);

  function responder(decision: DecisionSolicitud) {
    // El ref corta el doble toque en el mismo frame, antes de que React pinte
    // el estado optimista que ya esconde los botones.
    if (enCurso.current || estado !== "pendiente") return;
    enCurso.current = true;
    setError(null);

    const previo = estado;
    setEstado(decision === "confirmar" ? "aceptada" : "eliminada");
    if (!yaLeida) {
      setYaLeida(true);
      onLeida?.();
    }

    startTransition(async () => {
      let resultado: ResponderSolicitudResult;
      try {
        resultado = await responderSolicitudAction({
          notificationId,
          conversationId: solicitud.conversationId,
          decision,
        });
      } catch (fallo) {
        console.warn("[notificaciones] responder la solicitud falló", {
          message: fallo instanceof Error ? fallo.message : "error desconocido",
        });
        resultado = { ok: false, code: "error" };
      }

      if (resultado.ok) {
        setEstado(resultado.estado);
      } else if (resultado.code === "ya_resuelta" || resultado.code === "no_disponible") {
        setEstado(resultado.estado ?? "no_disponible");
      } else {
        setEstado(previo);
        setError(COPY.solicitud.error);
        toast({ title: COPY.solicitud.error, variant: "danger" });
      }
      enCurso.current = false;
    });
  }

  const transicion = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, y: 4 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -4 },
      };

  return (
    <div
      className={cn(
        "flex flex-1 items-start gap-3 text-left",
        compacta
          ? "rounded-xl px-2.5 py-2.5"
          : "rounded-lg border px-3 py-3.5",
        !compacta &&
          (yaLeida ? "border-border-subtle bg-surface/60" : "border-brand-subtle bg-surface shadow-xs"),
        compacta && !yaLeida && "bg-brand-tint/40",
      )}
    >
      <Link
        href={perfilHref(actor.id)}
        onClick={onNavegar}
        aria-label={COPY.solicitud.verPerfil(actor.nombre)}
        className={cn("shrink-0 rounded-full", linkFoco)}
      >
        <Avatar
          src={actor.avatarUrl}
          name={actor.nombre}
          size="md"
          className={compacta ? "size-9" : undefined}
        />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p
            className={cn(
              "min-w-0 text-sm leading-snug text-foreground",
              yaLeida ? "font-medium" : "font-semibold",
            )}
          >
            <Link
              href={perfilHref(actor.id)}
              onClick={onNavegar}
              className={cn(
                "font-semibold text-foreground transition-colors duration-(--duration-fast) hover:text-brand-ink",
                "rounded-sm",
                linkFoco,
              )}
            >
              {actor.nombre}
            </Link>
            {conNombre ? ` ${resto}` : <span className="block">{resto}</span>}
          </p>
          <time
            dateTime={createdAt}
            className="shrink-0 text-[11px] tabular-nums text-foreground-muted"
          >
            {timeLabel}
          </time>
        </div>

        <div aria-live="polite" className="mt-1">
          <AnimatePresence mode="wait" initial={false}>
            <m.div
              key={estado}
              initial={transicion.initial}
              animate={transicion.animate}
              exit={transicion.exit}
              transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
            >
              {estado === "pendiente" && (
                <>
                  <p className="text-xs leading-relaxed text-foreground-secondary">
                    {COPY.solicitud.pendiente}
                  </p>
                  <div className="mt-2.5 flex gap-2">
                    <Button
                      size="md"
                      variant="primary"
                      disabled={pendiente}
                      onClick={() => responder("confirmar")}
                      aria-label={COPY.solicitud.confirmarLabel(actor.nombre)}
                      className={cn("active:scale-[0.97]", compacta ? "flex-1" : "min-w-28")}
                    >
                      {COPY.solicitud.confirmar}
                    </Button>
                    <Button
                      size="md"
                      variant="secondary"
                      disabled={pendiente}
                      onClick={() => responder("eliminar")}
                      aria-label={COPY.solicitud.eliminarLabel(actor.nombre)}
                      className={cn(
                        "rounded-full active:scale-[0.97]",
                        compacta ? "flex-1" : "min-w-28",
                      )}
                    >
                      {COPY.solicitud.eliminar}
                    </Button>
                  </div>
                </>
              )}

              {estado === "aceptada" && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success-ink">
                    <CheckCircle size={16} weight="fill" aria-hidden="true" />
                    {COPY.solicitud.aceptada}
                  </span>
                  <Link
                    href={chatHref(solicitud.conversationId)}
                    onClick={onNavegar}
                    aria-label={COPY.solicitud.escribirLabel(actor.nombre)}
                    className={cn(
                      "inline-flex min-h-11 items-center gap-1.5 rounded-full px-4",
                      "bg-surface-subtle text-sm font-semibold text-foreground",
                      "transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring)",
                      "hover:bg-surface-hover active:scale-[0.97]",
                      linkFoco,
                    )}
                  >
                    <ChatCircleText size={16} aria-hidden="true" />
                    {COPY.solicitud.escribir}
                  </Link>
                </div>
              )}

              {estado === "eliminada" && (
                <p className="text-xs text-foreground-muted">{COPY.solicitud.eliminada}</p>
              )}

              {estado === "no_disponible" && (
                <p className="text-xs text-foreground-muted">{COPY.solicitud.noDisponible}</p>
              )}
            </m.div>
          </AnimatePresence>
        </div>

        {error && (
          <p role="alert" className="mt-2 text-xs font-medium text-danger-ink">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
