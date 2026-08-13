"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowClockwise } from "@phosphor-icons/react/dist/ssr";
import { Button, useToast } from "@/components/ui";
import { VENCIMIENTO_COPY } from "@/lib/listings";
import { renovarPublicacion } from "./actions";

const C = VENCIMIENTO_COPY.renovar;

/**
 * "Renovar" / "Volver a publicar" — un toque, sin diálogo de confirmación.
 *
 * NO HAY "¿ESTÁS SEGURO?" y es deliberado: renovar no destruye nada, no cobra
 * nada y no es irreversible. Un modal acá sería fricción sobre la acción que la
 * pantalla entera existe para facilitar. (Lo contrario valdría para borrar la
 * publicación, que sí lo tendría.)
 *
 * La pantalla decide si dibujar este botón con `puedeRenovar()`, pero eso es UX:
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

  async function renovar() {
    setEnviando(true);
    try {
      const resultado = await renovarPublicacion({ listingId, kind });
      if (!resultado.ok) {
        toast({ variant: "danger", title: resultado.error });
        return;
      }
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
    <Button
      type="button"
      variant="primary"
      size="sm"
      onClick={renovar}
      disabled={ocupado}
      aria-busy={ocupado}
    >
      <ArrowClockwise size={16} aria-hidden="true" />
      {ocupado ? C.enviando : vencida ? C.ctaVencida : C.cta}
    </Button>
  );
}
