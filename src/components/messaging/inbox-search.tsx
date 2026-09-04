"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui";
import { abrirChatDirectoAction } from "@/app/(app)/mensajes/direct-actions";
import { COPY } from "./copy";
import { PeopleSearch, type PersonaEncontrada } from "./people-search";

/**
 * El buscador ARRIBA DE LA BANDEJA.
 *
 * Elegir a alguien abre el chat directo y navega al hilo. Si la conversación
 * nace pendiente —el contacto protegido §9.2 no cambia por venir de un
 * buscador— igual se navega al hilo: ahí adentro la pantalla ya explica que la
 * solicitud salió y que hay que esperar la respuesta (la pantalla del hilo lo
 * dice arriba de la caja de escribir). No hay toast a propósito: la action no
 * distingue un hilo nuevo pendiente de uno existente ya aceptado, y un toast
 * de "solicitud enviada" sobre un chat viejo sería mentir.
 */
export function InboxSearch() {
  const router = useRouter();
  const { toast } = useToast();
  const [ocupadoId, setOcupadoId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function elegir(persona: PersonaEncontrada) {
    if (ocupadoId) return;
    setOcupadoId(persona.id);

    startTransition(async () => {
      const resultado = await abrirChatDirectoAction({ profileId: persona.id });

      if (resultado.ok) {
        router.push(`/mensajes/${resultado.conversationId}`);
        return;
      }

      setOcupadoId(null);

      if (resultado.code === "blocked" || resultado.code === "self") {
        // MISMO texto para bloqueo, ignorado y perfil inexistente: cuál de los
        // tres pasó no es información que tenga que volver a quien pregunta.
        toast({ title: COPY.inbox.directBlocked, variant: "warning" });
        return;
      }
      if (resultado.code === "rate-limited") {
        toast({
          title: COPY.composer.rateLimitedTitle,
          description: COPY.composer.rateLimitedBody,
          variant: "warning",
        });
        return;
      }
      toast({
        title: COPY.composer.errorTitle,
        description: COPY.inbox.directError,
        variant: "danger",
      });
    });
  }

  return (
    <PeopleSearch
      onElegir={elegir}
      ocupadoId={ocupadoId}
      etiquetaAccion={COPY.inbox.openChat}
      className="mb-5"
    />
  );
}
