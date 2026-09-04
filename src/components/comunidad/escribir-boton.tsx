"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EnvelopeSimple } from "@phosphor-icons/react/dist/ssr";
import { Button, useToast } from "@/components/ui";
import { COMUNIDAD_COPY } from "@/lib/comunidad";
import { contactarPedido } from "@/app/(app)/comunidad/pedir-ayuda/actions";

const C = COMUNIDAD_COPY.pedirAyuda.card;

/**
 * "Escribirle" — el canal PRIVADO con quien escribió el pedido.
 *
 * Convive con las respuestas públicas y no compite con ellas: la respuesta
 * pública es la que le sirve a los próximos veinte que busquen lo mismo (que es
 * el producto entero), y el mensaje privado es para lo que no se publica —una
 * dirección particular, el nombre de alguien que va a atender, coordinar una
 * entrega—. Por eso es secundario en la pantalla y no primario.
 *
 * No es un `mailto:` ni un `tel:` porque no hay nada de eso guardado: la tabla
 * de la 0120 no tiene una sola columna de contacto, a propósito. Este botón
 * abre (o recupera) una conversación protegida y navega al hilo, que es donde
 * la app ya sabe pedir aceptación, reportar y bloquear.
 *
 * Sin confirmación previa: abrir un hilo no destruye nada y del otro lado no
 * pasa nada hasta que se escribe el primer mensaje.
 */
export function EscribirBoton({
  pedidoId,
  className,
}: {
  pedidoId: string;
  className?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [enviando, setEnviando] = useState(false);

  async function escribir() {
    setEnviando(true);
    try {
      const resultado = await contactarPedido({ pedidoId });
      if (!resultado.ok) {
        if (resultado.needsAuth) {
          router.push(
            `/entrar?next=${encodeURIComponent(`/comunidad/pedir-ayuda/${pedidoId}`)}`,
          );
          return;
        }
        toast({ variant: "danger", title: resultado.error });
        return;
      }
      router.push(`/mensajes/${resultado.conversationId}`);
    } catch {
      toast({ variant: "danger", title: C.escribirErrores.generic });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={escribir}
      disabled={enviando}
      aria-busy={enviando}
      className={className}
    >
      <EnvelopeSimple size={18} aria-hidden="true" />
      {C.escribir}
    </Button>
  );
}
