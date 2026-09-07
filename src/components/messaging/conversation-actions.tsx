"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Dialog } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import {
  acceptConversationAction,
  ignoreConversationAction,
} from "@/app/(app)/mensajes/actions";
import { blockUserAction } from "@/app/(app)/perfil/actions";
import { COPY } from "./copy";

/**
 * Qué se hace con una solicitud de contacto pendiente (§9.2).
 *
 * Tres salidas, y son tres cosas distintas — por eso no se colapsan en dos:
 *
 *  · **Aceptar** → RPC `accept_conversation`. A partir de ahí pueden escribirse.
 *  · **Ignorar** → esta conversación pasa a `blocked` y sale del inbox. La
 *    persona puede volver a pedir contacto por otro aviso: es "ahora no".
 *  · **Bloquear** → RPC `block_user` (0020). Bloqueo GLOBAL: cierra todos los
 *    hilos entre ambos y corta el contacto nuevo en las dos direcciones.
 *
 * Ignorar y bloquear terminaban en la misma pantalla vacía, pero prometer
 * "Bloquear" y hacer sólo lo primero sería mentirle a quien lo usa para
 * protegerse. Bloquear es el único que pide confirmación: es global y la
 * pantalla desde donde se deshace (tu perfil) no es esta.
 */
export function ConversationActions({
  conversationId,
  personaId,
  nombre,
  className,
}: {
  conversationId: string;
  /** Sin él no se ofrece Bloquear: no hay a quién bloquear. */
  personaId?: string;
  nombre?: string;
  className?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [action, setAction] = useState<"accept" | "ignore" | "block" | null>(null);
  const [confirmarBloqueo, setConfirmarBloqueo] = useState(false);

  function run(kind: "accept" | "ignore") {
    setAction(kind);
    startTransition(async () => {
      const result =
        kind === "accept"
          ? await acceptConversationAction(conversationId)
          : await ignoreConversationAction(conversationId);
      if (result.ok) {
        toast({
          title: kind === "accept" ? COPY.inbox.accepted : COPY.inbox.ignored,
          variant: kind === "accept" ? "success" : "default",
        });
        router.refresh();
      } else {
        toast({ title: COPY.errors.generic, variant: "danger" });
      }
      setAction(null);
    });
  }

  function bloquear() {
    if (!personaId) return;
    setConfirmarBloqueo(false);
    setAction("block");
    startTransition(async () => {
      const result = await blockUserAction({ profileId: personaId });
      if (result.ok) {
        toast({ title: COPY.inbox.blocked, variant: "default" });
        router.refresh();
      } else {
        toast({ title: COPY.inbox.blockError, variant: "danger" });
      }
      setAction(null);
    });
  }

  return (
    <>
      <div className={className ?? "flex flex-wrap items-center gap-2"}>
        <Button
          size="sm"
          variant="primary"
          loading={isPending && action === "accept"}
          disabled={isPending}
          onClick={() => run("accept")}
        >
          {COPY.inbox.accept}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          loading={isPending && action === "ignore"}
          disabled={isPending}
          onClick={() => run("ignore")}
        >
          {COPY.inbox.ignore}
        </Button>
        {personaId && (
          <Button
            size="sm"
            variant="ghost"
            loading={isPending && action === "block"}
            disabled={isPending}
            onClick={() => setConfirmarBloqueo(true)}
            className="ml-auto text-danger-ink hover:bg-danger-bg"
          >
            {COPY.inbox.block}
          </Button>
        )}
      </div>

      <Dialog
        open={confirmarBloqueo}
        onClose={() => setConfirmarBloqueo(false)}
        highRisk
        title={COPY.inbox.blockConfirmTitle(nombre ?? "esta persona")}
        description={COPY.inbox.blockConfirmBody}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmarBloqueo(false)}>
              {COPY.inbox.cancel}
            </Button>
            <Button variant="danger" onClick={bloquear}>
              {COPY.inbox.blockConfirm}
            </Button>
          </>
        }
      />
    </>
  );
}
