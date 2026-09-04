"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle, ChatCircleDots, Info } from "@phosphor-icons/react/dist/ssr";
import { Badge, BezelCard, Button, useToast } from "@/components/ui";
import {
  COMUNIDAD_COPY,
  HELP_STATUS_HINT,
  HELP_STATUS_LABEL,
  HELP_TOPIC_LABEL,
  type HelpNotice,
  type HelpStatus,
} from "@/lib/comunidad";
import { cambiarEstadoDePedido } from "@/app/(app)/comunidad/pedir-ayuda/actions";

const C = COMUNIDAD_COPY.pedirAyuda.mios;

/**
 * Un pedido propio, con lo único que esta pantalla existe para dar: EN QUÉ ANDA
 * y qué se puede hacer al respecto.
 *
 * ── POR QUÉ ACÁ SE VE EL MOTIVO DE LA MODERACIÓN ────────────────────────────
 * Sin esta pantalla, que el equipo oculte un pedido sería una desaparición: la
 * persona escribió, se publicó, y un día ya no está. Volvería a escribir lo
 * mismo y lo volveríamos a ocultar. Mostrar el motivo es lo que convierte un
 * "no" en algo que se puede corregir.
 *
 * ── UN SOLO BOTÓN, Y ES "YA LO RESOLVÍ" ─────────────────────────────────────
 * La 0130 dejó una sola acción del autor sobre un pedido publicado: archivarlo.
 * No hay "editar" porque el contenido se congela al publicarse (juntar
 * respuestas con un texto y reescribirlo después es el bait-and-switch que la
 * 0120 ya defendía), y no hay "borrar" porque el archivado conserva las
 * respuestas que otros se tomaron el trabajo de escribir.
 *
 * Pide confirmación en el mismo botón, sin modal: de `archived` no sale
 * ninguna flecha, así que es la única acción que no se deshace — y un diálogo
 * para esto sería una alfombra roja para una decisión chica.
 *
 * Los estados legados (`draft`, `pending`) siguen apareciendo con su etiqueta:
 * quedan filas de la cola vieja de la 0120 y su dueño tiene que poder cerrarlas.
 */
export function MiPedidoCard({ pedido }: { pedido: HelpNotice }) {
  const router = useRouter();
  const { toast } = useToast();
  const [enviando, setEnviando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [isPending, startTransition] = useTransition();

  const ocupado = enviando || isPending;
  // Todo lo que no está archivado se puede cerrar. Los cuatro estados restantes
  // tienen flecha a `archived` en la máquina de estados del autor (0130), así
  // que este booleano y el trigger dicen lo mismo.
  const abierto = pedido.status !== "archived";

  async function resolver() {
    setEnviando(true);
    try {
      const resultado = await cambiarEstadoDePedido({
        pedidoId: pedido.id,
        hasta: "archived",
      });
      if (!resultado.ok) {
        toast({ variant: "danger", title: resultado.error });
        return;
      }
      toast({ variant: "success", title: C.hecho.resuelto });
      startTransition(() => router.refresh());
    } catch {
      toast({ variant: "danger", title: COMUNIDAD_COPY.escribirPedido.errors.generic });
    } finally {
      setEnviando(false);
      setConfirmando(false);
    }
  }

  return (
    <BezelCard
      variant={pedido.status === "rejected" ? "warning" : "default"}
      coreClassName="flex flex-col gap-3 p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold leading-snug text-foreground">
            {pedido.title}
          </h3>
          <p className="mt-0.5 text-sm text-foreground-muted">
            {HELP_TOPIC_LABEL[pedido.topic]} · {pedido.areaLabel}
          </p>
        </div>
        <Badge variant={BADGE_POR_ESTADO[pedido.status]}>
          {HELP_STATUS_LABEL[pedido.status]}
        </Badge>
      </div>

      <p className="text-sm leading-relaxed text-foreground-secondary">
        {HELP_STATUS_HINT[pedido.status]}
      </p>

      {pedido.status === "rejected" && pedido.reviewNote && (
        <div className="rounded-md bg-surface-subtle p-3">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            <Info size={14} weight="fill" aria-hidden="true" className="text-info" />
            {C.rechazoTitle}
          </h4>
          <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">
            {pedido.reviewNote}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-subtle pt-3">
        <Link
          href={`/comunidad/pedir-ayuda/${pedido.id}`}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
        >
          <ChatCircleDots size={16} weight="fill" aria-hidden="true" />
          {pedido.replyCount > 0 ? C.verRespuestas(pedido.replyCount) : C.verPedido}
        </Link>

        {abierto &&
          (confirmando ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-foreground-secondary">{C.confirmarResuelto}</span>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={ocupado}
                aria-busy={ocupado}
                onClick={resolver}
              >
                {C.resolver}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={ocupado}
                onClick={() => setConfirmando(false)}
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
              onClick={() => setConfirmando(true)}
            >
              <CheckCircle size={16} weight="fill" aria-hidden="true" />
              {C.resolver}
            </Button>
          ))}
      </div>

      {pedido.status === "approved" && !confirmando && (
        <p className="text-xs leading-relaxed text-foreground-muted">{C.resolverHint}</p>
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
