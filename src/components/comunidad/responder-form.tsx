"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr";
import { Button, Field, Textarea, useToast } from "@/components/ui";
import { COMUNIDAD_COPY, HELP_REPLY_MAX, HELP_REPLY_MIN } from "@/lib/comunidad";
import { responderPedido } from "@/app/(app)/comunidad/pedir-ayuda/actions";

const C = COMUNIDAD_COPY.pedirAyuda.respuestas;

/**
 * =============================================================================
 * LA CAJA DE RESPONDER
 * =============================================================================
 *
 * Va ARRIBA de la lista de respuestas y no abajo. Es un desvío consciente del
 * patrón de Glassdoor "The Worklife Bowl"
 * (https://mobbin.com/screens/466a3d35-ac5c-4263-915b-07e6a36d6048), que fija
 * el composer al borde inferior de la pantalla: acá esa barra chocaría con la
 * navegación de abajo de la app, y en un hilo de veinte respuestas el botón
 * quedaría escondido detrás del scroll. Arriba de la lista, la acción principal
 * se ve sin desplazarse y sigue estando debajo del pedido, que es lo que hay
 * que leer antes de contestar.
 *
 * ── EL AYUDA DICE LO CONTRARIO QUE EN EL PEDIDO, Y ESTÁ BIEN ────────────────
 * En el formulario del pedido el texto de ayuda pide NO poner teléfonos. Acá
 * dice que sí se puede poner el de una oficina. No es una contradicción: es la
 * regla real del módulo, escrita donde corresponde. El número de una oficina es
 * información; el propio, pegado al barrio y a la necesidad, es un dato
 * personal (§6 de la 0130).
 *
 * ── EL TEXTO NO SE PIERDE ───────────────────────────────────────────────────
 * Si la action rechaza —por moderación, por cupo, porque el pedido se cerró en
 * el medio— el textarea se queda como estaba, con el error arriba del botón.
 * Sólo se vacía cuando la respuesta ya existe del otro lado.
 */
export function ResponderForm({ pedidoId }: { pedidoId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const inputId = "responder-texto";
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [isPending, startTransition] = useTransition();

  const ocupado = enviando || isPending;
  const listo = texto.trim().length >= HELP_REPLY_MIN;

  async function enviar() {
    if (!listo || ocupado) return;
    setError(null);
    setEnviando(true);
    try {
      const resultado = await responderPedido({ pedidoId, body: texto.trim() });
      if (!resultado.ok) {
        if (resultado.needsAuth) {
          router.push(
            `/entrar?next=${encodeURIComponent(`/comunidad/pedir-ayuda/${pedidoId}`)}`,
          );
          return;
        }
        setError(resultado.error);
        return;
      }
      setTexto("");
      toast({ variant: "success", title: C.hecho.publicada });
      startTransition(() => router.refresh());
    } catch {
      setError(C.errors.generic);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Field htmlFor={inputId} label={C.escribirLabel} help={C.escribirHelp}>
        <Textarea
          id={inputId}
          value={texto}
          onChange={(event) => setTexto(event.target.value)}
          placeholder={C.escribirPlaceholder}
          maxLength={HELP_REPLY_MAX}
          rows={3}
        />
      </Field>

      {error && (
        <p
          role="alert"
          className="rounded-md bg-danger-bg px-3 py-2.5 text-sm leading-relaxed text-danger-ink"
        >
          {error}
        </p>
      )}

      <Button
        type="button"
        variant="primary"
        size="md"
        className="self-start"
        onClick={enviar}
        disabled={!listo || ocupado}
        aria-busy={ocupado}
        loading={ocupado}
      >
        <PaperPlaneTilt size={18} weight="fill" aria-hidden="true" />
        {ocupado ? C.enviando : C.enviar}
      </Button>
    </div>
  );
}
