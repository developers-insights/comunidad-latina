"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowClockwise } from "@phosphor-icons/react/dist/ssr";
import { Button, Dialog, useToast } from "@/components/ui";
import { VENCIMIENTO_COPY } from "@/lib/listings";
import { renovarPublicacion } from "./actions";

const C = VENCIMIENTO_COPY.renovar;
const RC = C.confirmarDisponibilidad;

/**
 * "Renovar" / "Volver a publicar" — un toque, sin diálogo de confirmación
 * PARA LA ACCIÓN DE RENOVAR EN SÍ.
 *
 * NO HAY "¿ESTÁS SEGURO DE RENOVAR?" y sigue siendo deliberado: renovar no
 * destruye nada, no cobra nada y no es irreversible. Un modal ahí sería
 * fricción sobre la acción que la pantalla entera existe para facilitar.
 *
 * Lo que SÍ hay, desde la 0117, es un diálogo DISTINTO: cuando la publicación
 * lleva más de 60 días activa, `public.renovar_publicacion()` responde
 * `necesita_confirmar_disponibilidad` en vez de renovar. Ese diálogo no
 * pregunta "¿querés renovar?" —eso ya se contestó apretando el botón—
 * pregunta "¿sigue en pie el trato?", que es una pregunta real con un "no"
 * que tiene adónde ir: si ya no está disponible, el camino es "Marcar como
 * alquilado" (o cubierto/vendido/finalizado), en `CerrarBoton`, ahí al lado.
 *
 * La pantalla decide si dibujar el botón con `puedeRenovar()`, pero eso es UX:
 * la autorización real la hace `public.renovar_publicacion()` adentro de la
 * base. Por eso, si la base rechaza, se muestra SU motivo traducido y no un
 * error genérico — el desacuerdo entre lo que la pantalla creía y lo que la base
 * decidió tiene que ser legible (pasa, por ejemplo, si la publicación venció
 * entre que se renderizó la página y se apretó el botón).
 */
export function RenovarBoton({
  listingId,
  kind,
  vencida,
}: {
  listingId: string;
  kind: string;
  /** Cambia la etiqueta: renovar algo vivo no es lo mismo que revivirlo. */
  vencida: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [enviando, setEnviando] = useState(false);
  const [isPending, startTransition] = useTransition();
  /** `null` = diálogo cerrado. Con valor, trae los días para el copy. */
  const [confirmacion, setConfirmacion] = useState<{ dias: number } | null>(null);

  async function renovar(confirmaDisponibilidad: boolean) {
    setEnviando(true);
    try {
      const resultado = await renovarPublicacion({
        listingId,
        kind,
        confirmaDisponibilidad,
      });
      if (!resultado.ok) {
        if (resultado.motivo === "necesita_confirmar_disponibilidad") {
          // No es un error: es la pregunta. Se abre el diálogo en vez de un
          // toast rojo — apretar "Renovar" no falló, sólo falta una respuesta.
          setConfirmacion({ dias: resultado.diasPublicada ?? 60 });
          return;
        }
        // Cualquier OTRO motivo cierra el diálogo si estaba abierto: puede
        // pasar reintentando con `confirmaDisponibilidad: true` y que la base
        // rechace por algo distinto (p. ej. llegó al tope justo en el medio).
        // La pregunta "¿sigue disponible?" ya no aplica — dejar el diálogo
        // abierto debajo del toast de error sería confuso.
        setConfirmacion(null);
        toast({ variant: "danger", title: resultado.error });
        return;
      }
      setConfirmacion(null);
      toast({
        variant: "success",
        title: C.okTitulo,
        description: C.okCuerpo(resultado.diasDeVigencia),
      });
      // El servidor ya revalidó; esto refresca lo que la persona está mirando.
      startTransition(() => router.refresh());
    } catch {
      toast({ variant: "danger", title: C.errorGenerico });
    } finally {
      setEnviando(false);
    }
  }

  const ocupado = enviando || isPending;

  return (
    <>
      <Button
        type="button"
        variant="primary"
        size="sm"
        onClick={() => renovar(false)}
        disabled={ocupado}
        aria-busy={ocupado}
      >
        <ArrowClockwise size={16} aria-hidden="true" />
        {ocupado ? C.enviando : vencida ? C.ctaVencida : C.cta}
      </Button>

      <Dialog
        open={confirmacion !== null}
        onClose={() => setConfirmacion(null)}
        title={RC.titulo}
        description={confirmacion ? RC.cuerpo(confirmacion.dias) : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmacion(null)} disabled={ocupado}>
              {RC.cancelar}
            </Button>
            <Button variant="primary" loading={ocupado} onClick={() => renovar(true)}>
              {RC.confirmar}
            </Button>
          </>
        }
      />
    </>
  );
}
