"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChatCircleDots } from "@phosphor-icons/react/dist/ssr";
import { Button, useToast } from "@/components/ui";
import { COMUNIDAD_COPY } from "@/lib/comunidad";
import { contactarAvisoDeAyuda } from "@/app/(app)/comunidad/ayuda-mutua/actions";

const C = COMUNIDAD_COPY.ayudaMutua.card;

/**
 * "Escribirle" — la ÚNICA forma de llegar a quien publicó un aviso de ayuda.
 *
 * No es un `mailto:` ni un `tel:` porque no hay nada de eso guardado: la tabla
 * de la 0120 no tiene una sola columna de contacto, a propósito. Este botón
 * abre (o recupera) una conversación protegida y navega al hilo, que es donde
 * la app ya sabe pedir aceptación, reportar y bloquear.
 *
 * Sin confirmación previa: abrir un hilo no destruye nada y del otro lado no
 * pasa nada hasta que se escribe el primer mensaje. Un "¿estás seguro?" acá
 * sería fricción sobre alguien que está tratando de ayudar.
 */
export function EscribirBoton({
  avisoId,
  esPedido,
  className,
}: {
  avisoId: string;
  /** `true` cuando el aviso es un lugar pidiendo manos: cambia sólo la etiqueta. */
  esPedido: boolean;
  className?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [enviando, setEnviando] = useState(false);

  async function escribir() {
    setEnviando(true);
    try {
      const resultado = await contactarAvisoDeAyuda({ avisoId });
      if (!resultado.ok) {
        if (resultado.needsAuth) {
          router.push(`/entrar?next=${encodeURIComponent("/comunidad/ayuda-mutua")}`);
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
      variant="primary"
      size="sm"
      onClick={escribir}
      disabled={enviando}
      aria-busy={enviando}
      className={className}
    >
      <ChatCircleDots size={18} aria-hidden="true" />
      {esPedido ? C.escribirNeed : C.escribir}
    </Button>
  );
}
