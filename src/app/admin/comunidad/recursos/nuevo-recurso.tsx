"use client";

import { useState } from "react";
import { Plus } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { RecursoForm } from "./recurso-form";

/**
 * El botón «Agregar una ficha» y el formulario que abre.
 *
 * Cerrado por defecto: la lista es lo que se viene a mirar la mayoría de las
 * veces, y un formulario de catorce campos siempre abierto la empuja fuera de la
 * pantalla. Abierto se queda abierto entre altas — quien está cargando los
 * bancos de comida de la ciudad va a agregar treinta seguidos, no uno.
 */
export function NuevoRecurso() {
  const [abierto, setAbierto] = useState(false);

  if (!abierto) {
    return (
      <div>
        <Button variant="primary" size="md" onClick={() => setAbierto(true)}>
          <Plus size={18} weight="bold" aria-hidden="true" />
          Agregar una ficha
        </Button>
      </div>
    );
  }

  return <RecursoForm onCerrar={() => setAbierto(false)} />;
}
