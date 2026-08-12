"use client";

import { useActionState, useId, useState } from "react";
import { PencilSimple, Trash } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, Button, Field, Textarea } from "@/components/ui";
import {
  borrarResenaAction,
  publicarResenaAction,
} from "@/app/(app)/negocios/resenas/actions";
import { RESENA_STATE_INICIAL } from "@/app/(app)/negocios/resenas/estado";
import { MAX_CARACTERES_RESENA, RESENAS_COPY as C } from "@/lib/resenas";
import { cn } from "@/lib/utils";
import { SelectorPuntaje } from "./selector-puntaje";

export interface ResenaFormProps {
  listingId: string;
  /** Mi reseña, si ya dejé una: el formulario pasa a modo edición. */
  resenaPropia?: { id: string; puntaje: number; texto: string | null } | null;
  className?: string;
}

/**
 * Formulario de reseña — uno solo para las dos situaciones.
 *
 * Si ya reseñé, el formulario se abre en modo EDICIÓN con lo que dejé, en vez de
 * dejarme escribir una segunda y estrellarme contra el índice único de la base.
 * El límite se dice antes de escribir, no después de mandar.
 *
 * Cuando ya hay una reseña propia el bloque arranca COLAPSADO: la ficha es del
 * negocio, no mía, y mi propio formulario abierto ocupando pantalla cada vez que
 * entro es ruido. Se abre con un botón, que además es el único lugar desde donde
 * se puede borrar.
 */
export function ResenaForm({ listingId, resenaPropia, className }: ResenaFormProps) {
  const textoId = useId();
  const [state, formAction, pending] = useActionState(publicarResenaAction, RESENA_STATE_INICIAL);
  const [borrarState, borrarAction, borrando] = useActionState(
    borrarResenaAction,
    RESENA_STATE_INICIAL,
  );
  const [abierto, setAbierto] = useState(!resenaPropia);

  const editando = Boolean(resenaPropia);
  const mensaje = state.status !== "idle" ? state : borrarState.status !== "idle" ? borrarState : null;

  if (!abierto) {
    return (
      <BezelCard coreClassName={cn("flex flex-wrap items-center gap-3 p-4", className)}>
        <p className="min-w-0 flex-1 text-sm text-foreground-secondary">{C.yaResenaste}</p>
        <Button variant="outline" size="sm" onClick={() => setAbierto(true)}>
          <PencilSimple size={16} aria-hidden="true" />
          {C.editar}
        </Button>
      </BezelCard>
    );
  }

  return (
    <BezelCard coreClassName={cn("flex flex-col gap-4 p-4", className)}>
      <div>
        <h3 className="font-display text-base font-bold text-foreground">
          {editando ? C.editarTitulo : C.escribirTitulo}
        </h3>
        <p className="mt-0.5 text-sm text-foreground-secondary">{C.aviso}</p>
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="listingId" value={listingId} />

        <SelectorPuntaje name="rating" defaultValue={resenaPropia?.puntaje ?? 0} />

        <Field htmlFor={textoId} label={C.textoLabel} help={C.textoHelp} optional>
          <Textarea
            id={textoId}
            name="body"
            rows={4}
            maxLength={MAX_CARACTERES_RESENA}
            defaultValue={resenaPropia?.texto ?? ""}
            placeholder={C.textoPlaceholder}
          />
        </Field>

        {mensaje && (
          <p
            role={mensaje.status === "success" ? "status" : "alert"}
            className={cn(
              "text-sm font-medium",
              mensaje.status === "success" ? "text-success-ink" : "text-danger",
            )}
          >
            {mensaje.message}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" loading={pending} className="flex-1">
            {pending ? C.publicando : editando ? C.guardarCambios : C.publicar}
          </Button>
          {editando && (
            <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>
              {C.cancelar}
            </Button>
          )}
        </div>
      </form>

      {resenaPropia && (
        <form
          action={borrarAction}
          onSubmit={(event) => {
            if (!window.confirm(C.borrarConfirmar)) event.preventDefault();
          }}
        >
          <input type="hidden" name="reviewId" value={resenaPropia.id} />
          <input type="hidden" name="listingId" value={listingId} />
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            loading={borrando}
            className="text-danger hover:text-danger"
          >
            <Trash size={16} aria-hidden="true" />
            {borrando ? C.borrando : C.borrar}
          </Button>
        </form>
      )}
    </BezelCard>
  );
}
