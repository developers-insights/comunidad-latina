"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, Dialog, useToast } from "@/components/ui";
import { VENCIMIENTO_COPY, type ClosedReason } from "@/lib/listings";
import { cerrarPublicacion } from "./actions";

const C = VENCIMIENTO_COPY.cerrar;

/**
 * "Marcar como alquilado / cubierto / vendido / finalizado" (0117).
 *
 * CON diálogo de confirmación, y es la decisión contraria a `RenovarBoton` a
 * propósito: cerrar SÍ es difícil de deshacer — no borra nada, pero volver a
 * mostrar la publicación exige pasar de nuevo por moderación (mismo anti
 * bait-and-switch de la 0004 que ya rige "editar"). El tono del diálogo es
 * deliberadamente tranquilo: esto es una BUENA noticia (el trato se hizo), no
 * una advertencia — por eso no usa el patrón `ConfirmSlowDialog` (reservado
 * para operaciones de alto impacto cross-tenant de /admin), sólo el `Dialog`
 * genérico con `highRisk` para el rol `alertdialog`.
 *
 * `closedReason` lo decide el servidor (`closedReasonForKind`, a partir del
 * `kind` REAL de la fila) antes de que exista este componente: acá sólo se
 * usa para elegir qué texto mostrar. La base lo vuelve a calcular ella sola
 * al cerrar — este valor es UX, no autorización.
 */
export function CerrarBoton({
  listingId,
  kind,
  closedReason,
}: {
  listingId: string;
  kind: string;
  closedReason: ClosedReason;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function confirmar() {
    setEnviando(true);
    try {
      const resultado = await cerrarPublicacion({ listingId, kind });
      if (!resultado.ok) {
        toast({ variant: "danger", title: resultado.error });
        return;
      }
      setOpen(false);
      toast({ variant: "success", title: C.ok[resultado.closedReason] });
      // El servidor ya revalidó; esto refresca lo que la persona está mirando.
      startTransition(() => router.refresh());
    } catch {
      toast({ variant: "danger", title: C.error });
    } finally {
      setEnviando(false);
    }
  }

  const cta = C.cta[closedReason];
  const ocupado = enviando || isPending;

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <CheckCircle size={16} aria-hidden="true" />
        {cta}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`¿${cta}?`}
        description={C.confirmar.cuerpo}
        highRisk
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={ocupado}>
              {C.confirmar.cancelar}
            </Button>
            <Button variant="primary" loading={ocupado} onClick={confirmar}>
              {C.confirmar.confirmar}
            </Button>
          </>
        }
      />
    </>
  );
}
