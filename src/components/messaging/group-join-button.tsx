"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "@phosphor-icons/react/dist/ssr";
import { Button, Spinner, useToast } from "@/components/ui";
import {
  solicitarIngresoAlGrupoAction,
  unirmeAlGrupoAction,
} from "@/app/(app)/mensajes/grupos/actions";
import {
  COPY_VETO,
  requiereSolicitud,
  type VisibilidadDeGrupo,
} from "@/lib/messaging/grupos";
import { COPY } from "./copy";

/**
 * "Unirme" a un grupo público, de un toque, desde la lista.
 *
 * Al entrar navega ADENTRO del grupo en vez de quedarse en la lista: unirse no
 * es la meta, leer lo que se está hablando sí. Es lo que hace WhatsApp cuando
 * se crea un grupo — te deja parado en el chat, con la tarjeta de bienvenida
 * (https://mobbin.com/screens/9de5c11a-e8d2-4aa3-b1e4-bf4d3a3888e9).
 */
export function GroupJoinButton({
  groupId,
  visibility = "public",
  requested = false,
  className,
}: {
  groupId: string;
  visibility?: VisibilidadDeGrupo;
  requested?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [enviando, setEnviando] = useState(false);
  const [, startTransition] = useTransition();

  function unirme() {
    if (enviando || requested) return;
    setEnviando(true);

    startTransition(async () => {
      const porSolicitud = requiereSolicitud(visibility);
      const resultado = porSolicitud
        ? await solicitarIngresoAlGrupoAction(groupId)
        : await unirmeAlGrupoAction(groupId);
      if (resultado.ok) {
        if (porSolicitud) {
          setEnviando(false);
          toast({
            title: COPY.groups.requestedJoin,
            description: COPY.groups.requestedJoinMessage,
            variant: "success",
          });
          router.refresh();
        } else {
          router.push(`/mensajes/grupos/${groupId}`);
        }
        return;
      }

      setEnviando(false);

      /**
       * "Te sacaron" NO comparte copy con "no pudimos sumarte" (0135). Los dos
       * son el mismo 42501 para la base, pero para la persona son opuestos:
       * uno invita a reintentar y el otro tiene que decir, sin vueltas, que
       * reintentar no va a servir. Un "probá de nuevo" acá sería un botón que
       * no funciona más y nadie que lo explique.
       */
      if (resultado.code === "banned") {
        toast({ title: COPY_VETO.joinBanned, variant: "warning" });
        return;
      }

      toast({
        title:
          resultado.code === "rate-limited"
            ? COPY.composer.rateLimitedTitle
            : COPY.groups.joinError,
        description:
          resultado.code === "rate-limited" ? COPY.composer.rateLimitedBody : undefined,
        variant: "warning",
      });
    });
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className={className}
      disabled={enviando || requested}
      onClick={unirme}
    >
      {enviando ? (
        <Spinner size={16} />
      ) : (
        <Plus size={16} weight="bold" aria-hidden="true" />
      )}
      {requested
        ? COPY.groups.requestedJoin
        : enviando
          ? requiereSolicitud(visibility)
            ? COPY.groups.requestingJoin
            : COPY.groups.joining
          : requiereSolicitud(visibility)
            ? COPY.groups.requestJoin
            : COPY.groups.join}
    </Button>
  );
}
