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
 * solicitud salió y que hay que esperar la respuesta. Se muestra además un
 * toast, porque llegar a un hilo donde no se puede escribir todavía necesita
 * una explicación en el momento, no dos pantallas después.
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
