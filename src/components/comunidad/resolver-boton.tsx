"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowCounterClockwise, CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, useToast } from "@/components/ui";
import { COMUNIDAD_COPY } from "@/lib/comunidad";
import { toggleLostFoundResolved } from "@/app/(app)/comunidad/actions";

const C = COMUNIDAD_COPY.perdidos.resolve;

/**
 * "Ya apareció" / "Volver a abrir el caso".
 *
 * Sólo se renderiza para quien publicó (la página decide con `caso.isOwner`), y
 * la base lo vuelve a verificar: `public.marcar_caso_resuelto` (0096) exige
 * dueño + tenant + kind adentro. O sea que esconder el botón es UX, no
 * seguridad — que es como tiene que ser.
 *
 * DOS DECISIONES:
 *
 *  · SE PUEDE DESHACER. Marcar resuelto por error, sin vuelta atrás, obligaría
 *    a republicar el caso entero justo cuando la persona está apurada. El
 *    reverso está en la misma función, no en un camino nuevo.
 *  · NO HAY DIÁLOGO DE CONFIRMACIÓN. La acción no destruye nada y se deshace de
 *    un toque: un "¿estás seguro?" acá sería fricción sin nada que proteger.
 *    (Lo mismo NO valdría para borrar el caso, que sí lo tendría.)
 *
 * El estado optimista se actualiza recién cuando la action responde `ok`:
 * mostrar "resuelto" antes de tiempo y tener que volver atrás es peor que
 * esperar 300 ms con el botón en `disabled`.
 */
export function ResolverBoton({
  caseId,
  resolved,
}: {
  caseId: string;
  /** Estado actual según el servidor. */
  resolved: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [estaResuelto, setEstaResuelto] = useState(resolved);
  const [isPending, startTransition] = useTransition();
  const [enviando, setEnviando] = useState(false);

  async function alternar() {
    const proximo = !estaResuelto;
    setEnviando(true);
    try {
      const resultado = await toggleLostFoundResolved({ caseId, resolved: proximo });
      if (!resultado.ok) {
        toast({ variant: "danger", title: resultado.error });
        return;
      }
      setEstaResuelto(proximo);
      toast({
        variant: "success",
        title: proximo ? C.markedOk : C.reopenedOk,
      });
      // La lista y el detalle ya se revalidaron en el servidor; esto refresca
      // lo que el usuario está mirando ahora mismo.
      startTransition(() => router.refresh());
    } catch {
      toast({ variant: "danger", title: C.failed });
    } finally {
      setEnviando(false);
    }
  }

  const ocupado = enviando || isPending;

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        variant={estaResuelto ? "outline" : "primary"}
        size="md"
        onClick={alternar}
        disabled={ocupado}
        aria-busy={ocupado}
        className="w-full"
      >
        {estaResuelto ? (
          <>
            <ArrowCounterClockwise size={18} aria-hidden="true" />
            {C.undoCta}
          </>
        ) : (
          <>
            <CheckCircle size={18} weight="fill" aria-hidden="true" />
            {C.markCta}
          </>
        )}
      </Button>
      {!estaResuelto && (
        <p className="text-sm leading-relaxed text-foreground-muted">{C.markHint}</p>
      )}
    </div>
  );
}
