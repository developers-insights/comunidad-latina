"use client";

import { useState, useTransition } from "react";
import { GlobeHemisphereWest } from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState, useToast } from "@/components/ui";
import { elegirZona } from "@/lib/zona/actions";
import { ZONA_COPY as C } from "@/lib/zona";

/**
 * =============================================================================
 * EL VACÍO DE UNA ZONA — la pantalla que evita que la app parezca rota
 * =============================================================================
 *
 * Este es el modo de falla que "Tu zona" trae de regalo si nadie lo atiende:
 * alguien elige Corona, entra a Empleos, no hay ningún aviso en Corona y ve
 * "todavía no hay empleos". Conclusión razonable y falsa: la app está vacía.
 *
 * Por eso el vacío de una zona NO es el vacío de la sección. Dice DÓNDE está
 * mirando (con el nombre de la zona, no "tu zona") y ofrece salir en UN toque
 * al mismo lugar al que llega el selector del header — la misma action, así que
 * el header se actualiza junto con la lista y no pueden decir cosas distintas.
 *
 * NO se usa cuando el filtro vino de la URL (`?zona=`, `?ciudad=`): ahí manda
 * el enlace y el módulo ya tiene su "limpiar filtros", que es el gesto correcto
 * — borrar el parámetro, no escribir una preferencia que el parámetro va a
 * seguir tapando. Ver `resolverVistaZona` en `@/lib/zona/server`.
 */
export function ZonaVacia({ zona, className }: { zona: string; className?: string }) {
  const [saliendo, setSaliendo] = useState(false);
  const [, startTransition] = useTransition();
  const { toast } = useToast();

  function verTodo() {
    setSaliendo(true);
    startTransition(async () => {
      const resultado = await elegirZona({ zona: null });
      setSaliendo(false);
      if (!resultado.ok) {
        toast({ title: resultado.mensaje, variant: "danger" });
        return;
      }
      toast({ title: C.toast.todas });
    });
  }

  return (
    <EmptyState
      className={className}
      illustration="/images/empty-state-search.png"
      title={C.vacio.titulo(zona)}
      message={C.vacio.mensaje(zona)}
      action={
        <Button variant="primary" size="md" onClick={verTodo} loading={saliendo}>
          <GlobeHemisphereWest size={18} aria-hidden="true" />
          {C.vacio.cta}
        </Button>
      }
    />
  );
}
