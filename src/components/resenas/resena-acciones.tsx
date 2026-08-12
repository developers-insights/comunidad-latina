"use client";

import { useActionState, useId, useState } from "react";
import { ChatCircleDots, Flag } from "@phosphor-icons/react/dist/ssr";
import { Button, Field, Textarea } from "@/components/ui";
import {
  reportarResenaAction,
  responderResenaAction,
} from "@/app/(app)/negocios/resenas/actions";
import { RESENA_STATE_INICIAL } from "@/app/(app)/negocios/resenas/estado";
import { MAX_CARACTERES_RESENA, RESENAS_COPY as C } from "@/lib/resenas";
import { cn } from "@/lib/utils";

export interface ResenaAccionesProps {
  reviewId: string;
  listingId: string;
  /** Quien mira administra el aviso: puede responder (y sólo responder). */
  puedeResponder: boolean;
  /** Hay respuesta cargada: el botón dice "editar" en vez de "responder". */
  tieneRespuesta: boolean;
  respuestaActual: string | null;
  /** Sin sesión no se ofrece reportar: la RPC lo rechazaría igual. */
  puedeReportar: boolean;
  className?: string;
}

/**
 * Las dos acciones que cuelgan de UNA reseña: responderla (el negocio) y
 * reportarla (cualquiera).
 *
 * Los dos formularios se abren en el lugar y no en un modal: son textos cortos y
 * el contexto —la reseña que se está respondiendo o reportando— tiene que quedar
 * a la vista mientras se escribe. Un modal lo tapa justo cuando más se necesita.
 *
 * `aria-expanded` + `aria-controls` en los disparadores para que el estado
 * abierto/cerrado se anuncie; el foco no se roba, se deja donde el usuario lo
 * puso.
 */
export function ResenaAcciones({
  reviewId,
  listingId,
  puedeResponder,
  tieneRespuesta,
  respuestaActual,
  puedeReportar,
  className,
}: ResenaAccionesProps) {
  const respuestaId = useId();
  const reporteId = useId();
  const [abierto, setAbierto] = useState<"ninguno" | "responder" | "reportar">("ninguno");

  const [respuestaState, responderAction, respondiendo] = useActionState(
    responderResenaAction,
    RESENA_STATE_INICIAL,
  );
  const [reporteState, reportarAction, reportando] = useActionState(
    reportarResenaAction,
    RESENA_STATE_INICIAL,
  );

  if (!puedeResponder && !puedeReportar) return null;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-1">
        {puedeResponder && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={abierto === "responder"}
            aria-controls={respuestaId}
            onClick={() => setAbierto((previo) => (previo === "responder" ? "ninguno" : "responder"))}
          >
            <ChatCircleDots size={16} aria-hidden="true" />
            {tieneRespuesta ? C.editarRespuesta : C.responder}
          </Button>
        )}
        {puedeReportar && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={abierto === "reportar"}
            aria-controls={reporteId}
            onClick={() => setAbierto((previo) => (previo === "reportar" ? "ninguno" : "reportar"))}
          >
            <Flag size={16} aria-hidden="true" />
            {C.reportar}
          </Button>
        )}
      </div>

      {puedeResponder && (
        <div id={respuestaId} hidden={abierto !== "responder"}>
          <form action={responderAction} className="flex flex-col gap-3">
            <input type="hidden" name="reviewId" value={reviewId} />
            <input type="hidden" name="listingId" value={listingId} />
            <Field
              htmlFor={`${respuestaId}-texto`}
              label={C.respuestaLabel}
              help={C.respuestaHelp}
            >
              <Textarea
                id={`${respuestaId}-texto`}
                name="reply"
                rows={3}
                maxLength={MAX_CARACTERES_RESENA}
                defaultValue={respuestaActual ?? ""}
                placeholder={C.respuestaPlaceholder}
              />
            </Field>
            {respuestaState.status !== "idle" && (
              <p
                role={respuestaState.status === "success" ? "status" : "alert"}
                className={cn(
                  "text-sm font-medium",
                  respuestaState.status === "success" ? "text-success-ink" : "text-danger",
                )}
              >
                {respuestaState.message}
              </p>
            )}
            <Button type="submit" variant="primary" size="sm" loading={respondiendo}>
              {respondiendo ? C.respuestaGuardando : C.respuestaGuardar}
            </Button>
          </form>
        </div>
      )}

      {puedeReportar && (
        <div id={reporteId} hidden={abierto !== "reportar"}>
          <form action={reportarAction} className="flex flex-col gap-3">
            <input type="hidden" name="reviewId" value={reviewId} />
            <input type="hidden" name="listingId" value={listingId} />
            <Field htmlFor={`${reporteId}-motivo`} label={C.reportarLabel} help={C.reportarNota}>
              <Textarea
                id={`${reporteId}-motivo`}
                name="reason"
                rows={3}
                maxLength={1000}
                placeholder={C.reportarPlaceholder}
              />
            </Field>
            {reporteState.status !== "idle" && (
              <p
                role={reporteState.status === "success" ? "status" : "alert"}
                className={cn(
                  "text-sm font-medium",
                  reporteState.status === "success" ? "text-success-ink" : "text-danger",
                )}
              >
                {reporteState.message}
              </p>
            )}
            <Button type="submit" variant="outline" size="sm" loading={reportando}>
              {reportando ? C.reportarEnviando : C.reportarEnviar}
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
