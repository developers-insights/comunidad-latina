"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChatCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, Spinner, useToast } from "@/components/ui";
import { abrirChatDirectoAction } from "@/app/(app)/mensajes/direct-actions";

const COPY = {
  cta: "Enviar mensaje",
  opening: "Abriendo…",
  /**
   * El contacto directo nace `pending`, igual que desde un aviso: quien recibe
   * acepta o ignora. Se dice acá y no dos pantallas después, para que nadie se
   * pregunte por qué el hilo no lo deja escribir todavía.
   */
  sent: "Le mandamos tu solicitud. Cuando acepte, van a poder hablar.",
  blocked: "El contacto con esta persona no está disponible.",
  error: "No pudimos abrir la conversación. Probá de nuevo.",
  tooMany: "Abriste varias conversaciones seguidas. Probá de nuevo en un rato.",
  /** Sin `profileId` no hay a quién escribirle: ver el comentario de abajo. */
  soonTitle: (name: string) => `Muy pronto vas a poder escribirle a ${name} desde acá`,
  soonBody:
    "Por ahora el contacto protegido arranca desde un aviso publicado — estamos terminando esta parte.",
} as const;

/**
 * CTA del perfil público cuando todavía NO existe conversación con esa persona.
 *
 * Hasta la 0134 este botón mostraba un toast que decía «muy pronto»: no había
 * ninguna forma de abrir un chat sin pasar por un aviso. Ahora llama a
 * `solicitar_contacto_directo` y navega al hilo — es la otra mitad del pedido
 * del cliente del 3/9 («busco Manuel Navarro y te mando un mensaje directo»).
 *
 * `profileId` es OPCIONAL a propósito y no un descuido: hay otra pantalla que
 * todavía monta este componente sin pasarlo (el perfil de creador). Sin id no
 * se puede abrir nada, así que ahí se conserva el comportamiento viejo —un
 * mensaje honesto— en vez de un botón que falla. Cuando esa pantalla pase el
 * id, esta rama se borra.
 */
export function MessageCta({
  firstName,
  profileId,
}: {
  firstName: string;
  profileId?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [abriendo, setAbriendo] = useState(false);
  const [, startTransition] = useTransition();

  function abrir() {
    if (!profileId) {
      toast({ title: COPY.soonTitle(firstName), description: COPY.soonBody });
      return;
    }
    if (abriendo) return;
    setAbriendo(true);

    startTransition(async () => {
      const resultado = await abrirChatDirectoAction({ profileId });

      if (resultado.ok) {
        toast({ title: COPY.sent });
        router.push(`/mensajes/${resultado.conversationId}`);
        return;
      }

      setAbriendo(false);

      if (resultado.code === "blocked" || resultado.code === "self") {
        toast({ title: COPY.blocked, variant: "warning" });
        return;
      }
      if (resultado.code === "rate-limited") {
        toast({ title: COPY.tooMany, variant: "warning" });
        return;
      }
      toast({ title: COPY.error, variant: "danger" });
    });
  }

  return (
    <Button
      variant="primary"
      size="lg"
      className="w-full"
      disabled={abriendo}
      onClick={abrir}
    >
      {abriendo ? (
        <Spinner size={20} />
      ) : (
        <ChatCircle size={20} aria-hidden="true" />
      )}
      {abriendo ? COPY.opening : COPY.cta}
    </Button>
  );
}
