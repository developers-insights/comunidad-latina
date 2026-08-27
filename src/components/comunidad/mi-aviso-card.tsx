"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowCounterClockwise,
  ArrowUUpLeft,
  Info,
  NotePencil,
  PaperPlaneTilt,
  Prohibit,
} from "@phosphor-icons/react/dist/ssr";
import { Badge, BezelCard, Button, useToast } from "@/components/ui";
import {
  COMUNIDAD_COPY,
  HELP_DIRECTION_COPY,
  HELP_STATUS_HINT,
  HELP_STATUS_LABEL,
  HELP_TOPIC_LABEL,
  type HelpNotice,
  type HelpStatus,
} from "@/lib/comunidad";
import { cambiarEstadoDeAvisoDeAyuda } from "@/app/(app)/comunidad/ayuda-mutua/actions";

const C = COMUNIDAD_COPY.ayudaMutua.mios;

/**
 * Un aviso propio, con lo único que esta pantalla existe para dar: EN QUÉ ANDA
 * y qué se puede hacer al respecto.
 *
 * ── POR QUÉ ACÁ SE VE EL MOTIVO DEL RECHAZO ─────────────────────────────────
 * Sin esta pantalla, un rechazo sería una desaparición: la persona escribió,
 * mandó, y su aviso no aparece nunca. Volvería a escribir el mismo texto y lo
 * volveríamos a rechazar, indefinidamente. Mostrar el motivo —y dejar corregir
 * sobre lo ya escrito, sin empezar de cero— es lo que convierte un "no" en un
 * paso más del camino.
 *
 * ── LOS BOTONES SALEN DE LA MÁQUINA DE ESTADOS, NO DE UN `if` A MANO ────────
 * Cada acción pregunta por `puedeTransicionar` a través de la action, que a su
 * vez es el espejo del trigger de la 0120. Un botón que aparece cuando no
 * corresponde es un botón que la base rechaza; escribir la lista dos veces
 * garantizaría que un día digan cosas distintas.
 *
 * ── "DAR DE BAJA" PIDE CONFIRMACIÓN; EL RESTO NO ────────────────────────────
 * Es la única acción que no se deshace desde la app (de `archived` no sale
 * ninguna flecha, por diseño: resucitar un aviso publicaría de nuevo algo que
 * su autor decidió bajar). Se confirma en el mismo botón, sin modal: un
 * diálogo para esto sería una alfombra roja para una decisión chica.
 */
export function MiAvisoCard({ aviso }: { aviso: HelpNotice }) {
  const router = useRouter();
  const { toast } = useToast();
  const [enviando, setEnviando] = useState(false);
  const [confirmandoBaja, setConfirmandoBaja] = useState(false);
  const [isPending, startTransition] = useTransition();

  const ocupado = enviando || isPending;
  const direccion = HELP_DIRECTION_COPY[aviso.direction];

  async function mover(hasta: HelpStatus, alTerminar?: () => void) {
    setEnviando(true);
    try {
      const resultado = await cambiarEstadoDeAvisoDeAyuda({ avisoId: aviso.id, hasta });
      if (!resultado.ok) {
        toast({ variant: "danger", title: resultado.error });
        return;
      }
      if (hasta === "archived") toast({ variant: "success", title: C.hecho.dadoDeBaja });
      if (hasta === "draft") toast({ variant: "success", title: C.hecho.retirado });
      if (alTerminar) alTerminar();
      else startTransition(() => router.refresh());
    } catch {
      toast({ variant: "danger", title: COMUNIDAD_COPY.ofrecerse.errors.generic });
    } finally {
      setEnviando(false);
      setConfirmandoBaja(false);
    }
  }

  return (
    <BezelCard
      variant={aviso.status === "rejected" ? "warning" : "default"}
      coreClassName="flex flex-col gap-3 p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold leading-snug text-foreground">
            {aviso.title}
          </h3>
          <p className="mt-0.5 text-sm text-foreground-muted">
            {direccion.badge} · {HELP_TOPIC_LABEL[aviso.topic]} · {aviso.areaLabel}
          </p>
        </div>
        <Badge variant={BADGE_POR_ESTADO[aviso.status]}>{HELP_STATUS_LABEL[aviso.status]}</Badge>
      </div>

      <p className="text-sm leading-relaxed text-foreground-secondary">
        {HELP_STATUS_HINT[aviso.status]}
      </p>

      {aviso.status === "rejected" && aviso.reviewNote && (
        <div className="rounded-md bg-surface-subtle p-3">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            <Info size={14} weight="fill" aria-hidden="true" className="text-info" />
            {C.rechazoTitle}
          </h4>
          <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">
            {aviso.reviewNote}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border-subtle pt-3">
        {aviso.status === "draft" && (
          <>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={ocupado}
              aria-busy={ocupado}
              onClick={() => mover("pending")}
            >
              <PaperPlaneTilt size={16} weight="fill" aria-hidden="true" />
              {COMUNIDAD_COPY.ofrecerse.submit}
            </Button>
            <Link
              href={`/comunidad/ayuda-mutua/publicar?editar=${aviso.id}`}
              className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
            >
              <NotePencil size={16} aria-hidden="true" />
              {C.corregir}
            </Link>
          </>
        )}

        {aviso.status === "pending" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={ocupado}
            aria-busy={ocupado}
            onClick={() => mover("draft")}
          >
            <ArrowUUpLeft size={16} aria-hidden="true" />
            {C.retirar}
          </Button>
        )}

        {aviso.status === "rejected" && (
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={ocupado}
            aria-busy={ocupado}
            onClick={() =>
              mover("draft", () =>
                router.push(`/comunidad/ayuda-mutua/publicar?editar=${aviso.id}`),
              )
            }
          >
            <ArrowCounterClockwise size={16} aria-hidden="true" />
            {C.corregir}
          </Button>
        )}

        {(aviso.status === "approved" || aviso.status === "pending") &&
          (confirmandoBaja ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-foreground-secondary">{C.confirmarBaja}</span>
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={ocupado}
                aria-busy={ocupado}
                onClick={() => mover("archived")}
              >
                {C.darDeBaja}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={ocupado}
                onClick={() => setConfirmandoBaja(false)}
              >
                No
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={ocupado}
              onClick={() => setConfirmandoBaja(true)}
            >
              <Prohibit size={16} aria-hidden="true" />
              {C.darDeBaja}
            </Button>
          ))}
      </div>

      {aviso.status === "approved" && !confirmandoBaja && (
        <p className="text-xs leading-relaxed text-foreground-muted">{C.darDeBajaHint}</p>
      )}
      {aviso.status === "pending" && !confirmandoBaja && (
        <p className="text-xs leading-relaxed text-foreground-muted">{C.retirarHint}</p>
      )}
    </BezelCard>
  );
}

const BADGE_POR_ESTADO: Record<HelpStatus, "neutral" | "brand" | "success" | "warning" | "danger"> =
  {
    draft: "neutral",
    pending: "warning",
    approved: "success",
    rejected: "danger",
    archived: "neutral",
  };
