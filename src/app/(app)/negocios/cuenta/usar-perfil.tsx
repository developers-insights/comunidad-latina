"use client";

import { useTransition } from "react";
import { Button, useToast } from "@/components/ui";
import { cambiarIdentidad } from "@/lib/perfil-activo/actions";
import { PERFIL_ACTIVO_COPY } from "@/lib/perfil-activo/copy";
import { COPY } from "./copy";

/**
 * El mismo cambio que hace la hoja del header, con un botón explícito en la
 * pantalla del negocio. Existen los dos caminos a propósito: el del header es
 * el atajo de todos los días, y este es el que encuentra quien acaba de crear
 * la cuenta y todavía no sabe que el avatar de arriba cambia de perfil.
 *
 * La autorización no está acá: la pone el WITH CHECK de `active_identities`
 * (0103). Este botón sólo pide el cambio.
 */
export function UsarPerfil({
  businessId,
  nombre,
  nombrePersonal,
  activo,
}: {
  businessId: string;
  nombre: string;
  /** Cómo se llama la persona — para nombrar el perfil al que vuelve. */
  nombrePersonal: string;
  /** ¿Ya está actuando con este negocio? Entonces el botón vuelve al personal. */
  activo: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  return (
    <Button
      type="button"
      variant={activo ? "outline" : "primary"}
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const resultado = await cambiarIdentidad({
            businessId: activo ? null : businessId,
          });
          if (!resultado.ok) {
            toast({ title: resultado.mensaje, variant: "danger" });
            return;
          }
          toast({
            title: activo
              ? PERFIL_ACTIVO_COPY.toast.personal(nombrePersonal)
              : PERFIL_ACTIVO_COPY.toast.negocio(nombre),
          });
        })
      }
    >
      {pending
        ? COPY.card.switching
        : activo
          ? COPY.card.backToPersonal
          : COPY.card.useIt(nombre)}
    </Button>
  );
}
