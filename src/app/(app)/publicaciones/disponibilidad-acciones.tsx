"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, Key } from "@phosphor-icons/react/dist/ssr";
import { Button, Dialog, useToast } from "@/components/ui";
import { VENCIMIENTO_COPY } from "@/lib/listings";
import { confirmarDisponibilidad, marcarAlquilado } from "./actions";

/**
 * =============================================================================
 * LAS DOS RESPUESTAS A «¿SIGUE DISPONIBLE?» (0116, spec §4)
 * =============================================================================
 *
 * Van juntas en un archivo y juntas en la pantalla porque son la MISMA
 * pregunta. Separarlas —confirmar acá, marcar alquilado en otro menú— es lo que
 * produce el aviso zombi: quien ya alquiló no encuentra dónde decirlo, así que
 * no dice nada, y el cuarto sigue publicado hasta que vence solo un mes después.
 *
 * ── UNA PIDE CONFIRMACIÓN Y LA OTRA NO ──────────────────────────────────────
 * "Sigue disponible" no destruye nada: un toque y listo, igual que Renovar (ver
 * el docblock de `renovar-boton.tsx`). "Ya lo alquilé" saca el aviso del
 * listado, así que sí lleva diálogo — y ese diálogo dice que tiene vuelta atrás,
 * porque el miedo a que sea definitivo es exactamente lo que hace que nadie lo
 * toque.
 */

const D = VENCIMIENTO_COPY.disponibilidad;
const A = VENCIMIENTO_COPY.alquilado;

export function ConfirmarDisponibilidadBoton({
  listingId,
  kind,
}: {
  listingId: string;
  kind: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [enviando, setEnviando] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function confirmar() {
    setEnviando(true);
    try {
      const resultado = await confirmarDisponibilidad({ listingId, kind });
      if (!resultado.ok) {
        toast({ variant: "danger", title: resultado.error });
        return;
      }
      toast({ variant: "success", title: D.okTitulo, description: D.okCuerpo });
      startTransition(() => router.refresh());
    } catch {
      toast({ variant: "danger", title: D.errorGenerico });
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
      onClick={confirmar}
      disabled={ocupado}
      aria-busy={ocupado}
    >
      <CheckCircle size={16} aria-hidden="true" />
      {ocupado ? D.enviando : D.cta}
    </Button>
  );
}

export function MarcarAlquiladoBoton({
  listingId,
  kind,
}: {
  listingId: string;
  kind: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [abierto, setAbierto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function marcar() {
    setEnviando(true);
    try {
      const resultado = await marcarAlquilado({ listingId, kind });
      if (!resultado.ok) {
        toast({ variant: "danger", title: resultado.error });
        return;
      }
      setAbierto(false);
      toast({ variant: "success", title: A.okTitulo, description: A.okCuerpo });
      startTransition(() => router.refresh());
    } catch {
      toast({ variant: "danger", title: A.errorGenerico });
    } finally {
      setEnviando(false);
    }
  }

  const ocupado = enviando || isPending;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setAbierto(true)}
        disabled={ocupado}
      >
        <Key size={16} aria-hidden="true" />
        {A.cta}
      </Button>

      <Dialog
        open={abierto}
        onClose={() => {
          if (!ocupado) setAbierto(false);
        }}
        title={A.confirmarTitulo}
        description={A.confirmarCuerpo}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAbierto(false)}
              disabled={ocupado}
            >
              {A.cancelar}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={marcar}
              disabled={ocupado}
              aria-busy={ocupado}
            >
              {ocupado ? A.enviando : A.confirmarCta}
            </Button>
          </>
        }
      />
    </>
  );
}
