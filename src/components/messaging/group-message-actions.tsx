"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DotsThreeVertical } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Button, Dialog, Field, Select, Textarea, useToast } from "@/components/ui";
import {
  borrarMensajeDeGrupoAction,
  reportarMensajeDeGrupoAction,
} from "@/app/(app)/mensajes/grupos/actions";
import { COPY } from "./copy";

/**
 * QUÉ SE PUEDE HACER CON UN MENSAJE AJENO (o con el propio).
 *
 * Va como un botón visible al costado de la burbuja y NO detrás de un toque
 * largo. El toque largo es lo que usa WhatsApp, pero acá pesa el reporte del
 * cliente sobre el editor de fotos: un gesto que no se ve es un gesto que no
 * existe, y encima en este teléfono los gestos venían fallando. Un botón con
 * `aria-label` además es lo único que un lector de pantalla puede anunciar.
 *
 * Las dos acciones son distintas y por eso no comparten diálogo:
 *   · BORRAR es del autor (y de quien administra): baja el mensaje, se ve al
 *     instante y no involucra a nadie más.
 *   · REPORTAR es de cualquiera: abre una denuncia con el MISMO catálogo de
 *     motivos que el resto de la app (`COPY.report.reasons`) y con el mismo
 *     cupo diario, porque el presupuesto de denuncias es de la persona y no de
 *     la pantalla desde la que reporta.
 */
export function GroupMessageActions({
  groupId,
  messageId,
  puedoBorrar,
  className,
}: {
  groupId: string;
  messageId: string;
  /** Soy el autor, o administro el grupo. */
  puedoBorrar: boolean;
  className?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const idMotivo = useId();
  const idDetalle = useId();
  const [abierto, setAbierto] = useState(false);
  const [reportando, setReportando] = useState(false);
  const [motivo, setMotivo] = useState<string>(COPY.report.reasons[0].value);
  const [detalle, setDetalle] = useState("");
  const [enviando, startTransition] = useTransition();

  function borrar() {
    startTransition(async () => {
      const resultado = await borrarMensajeDeGrupoAction({ groupId, messageId });
      setAbierto(false);

      if (resultado.ok) {
        toast({ title: COPY.groups.messageDeleted });
        router.refresh();
        return;
      }
      toast({ title: COPY.groups.deleteMessageError, variant: "danger" });
    });
  }

  function reportar() {
    startTransition(async () => {
      const resultado = await reportarMensajeDeGrupoAction({
        messageId,
        reason: motivo,
        details: detalle.trim() || undefined,
      });
      setReportando(false);
      setAbierto(false);
      setDetalle("");

      if (resultado.ok) {
        toast({ title: COPY.report.successTitle, description: COPY.groups.reported });
        return;
      }
      if (resultado.code === "rate-limited") {
        toast({
          title: COPY.report.rateLimitedTitle,
          description: COPY.report.rateLimitedBody,
          variant: "warning",
        });
        return;
      }
      toast({
        title: COPY.report.errorTitle,
        description: COPY.report.errorBody,
        variant: "danger",
      });
    });
  }

  return (
    <>
      <button
        type="button"
        aria-label={COPY.thread.moreActions}
        onClick={() => setAbierto(true)}
        className={cn(
          // 44px de área táctil (§3.2) con un ícono chico adentro: el peso
          // visual es el de un detalle, el objetivo es el de un botón.
          "flex size-11 shrink-0 items-center justify-center rounded-full text-foreground-muted",
          "transition-colors duration-(--duration-fast) hover:bg-surface-subtle hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          className,
        )}
      >
        <DotsThreeVertical size={18} weight="bold" aria-hidden="true" />
      </button>

      {/* Menú: dos acciones, sin submenús. */}
      <Dialog
        open={abierto && !reportando}
        onClose={() => setAbierto(false)}
        title={COPY.thread.moreActions}
        footer={
          <Button variant="outline" onClick={() => setAbierto(false)}>
            Cancelar
          </Button>
        }
      >
        <div className="flex flex-col gap-2">
          {puedoBorrar && (
            <Button
              variant="outline"
              className="w-full"
              loading={enviando}
              onClick={borrar}
            >
              {COPY.groups.deleteMessage}
            </Button>
          )}
          <Button
            variant="ghost"
            className="w-full text-danger"
            onClick={() => setReportando(true)}
          >
            {COPY.groups.report}
          </Button>
        </div>
      </Dialog>

      {/* Reporte: alto riesgo, con los motivos de siempre. */}
      <Dialog
        open={reportando}
        onClose={() => {
          setReportando(false);
          setAbierto(false);
        }}
        highRisk
        title={COPY.report.sheetTitle}
        description={COPY.report.intro}
        footer={
          <>
            <Button
              variant="outline"
              disabled={enviando}
              onClick={() => {
                setReportando(false);
                setAbierto(false);
              }}
            >
              Cancelar
            </Button>
            <Button variant="danger" loading={enviando} onClick={reportar}>
              {COPY.report.submit}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field htmlFor={idMotivo} label={COPY.report.reasonLabel}>
            <Select
              id={idMotivo}
              value={motivo}
              onChange={(event) => setMotivo(event.target.value)}
            >
              {COPY.report.reasons.map((opcion) => (
                <option key={opcion.value} value={opcion.value}>
                  {opcion.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field htmlFor={idDetalle} label={COPY.report.detailsLabel} optional>
            <Textarea
              id={idDetalle}
              rows={3}
              maxLength={1000}
              value={detalle}
              placeholder={COPY.report.detailsPlaceholder}
              onChange={(event) => setDetalle(event.target.value)}
            />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
