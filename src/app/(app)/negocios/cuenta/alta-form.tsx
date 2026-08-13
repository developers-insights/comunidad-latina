"use client";

import { useActionState, useId } from "react";
import { Banner, Button, Field, Input, Select } from "@/components/ui";
import { BUSINESS_CATEGORIES } from "../categories";
import { crearCuentaDeNegocio } from "./actions";
import { COPY, MAX_NOMBRE_NEGOCIO } from "./copy";
import { ALTA_INICIAL } from "./estado";

/**
 * Formulario de alta. Dos campos y uno es opcional: crear el segundo perfil
 * tiene que costar menos que pensarlo. Todo lo demás del negocio —dirección,
 * horarios, fotos— vive en la FICHA del directorio, que es otra pantalla y otro
 * momento.
 *
 * El error se muestra en un Banner arriba y no debajo del campo porque el caso
 * más probable no es "el nombre está mal" sino "ya tenés una cuenta": es un
 * mensaje del formulario entero, no de un control.
 */
export function AltaForm() {
  const [state, action, pending] = useActionState(crearCuentaDeNegocio, ALTA_INICIAL);
  const nombreId = useId();
  const rubroId = useId();

  const error = state.estado === "error" ? state.mensaje : null;

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.estado === "ok" && (
        <Banner variant="info" className="rounded-xl">
          {state.mensaje}
        </Banner>
      )}
      {error && (
        <Banner variant="warning" className="rounded-xl" role="alert">
          {error}
        </Banner>
      )}

      <Field htmlFor={nombreId} label={COPY.form.nameLabel} help={COPY.form.nameHint}>
        <Input
          id={nombreId}
          name="nombre"
          required
          maxLength={MAX_NOMBRE_NEGOCIO}
          autoComplete="organization"
          placeholder={COPY.form.namePlaceholder}
        />
      </Field>

      <Field
        htmlFor={rubroId}
        label={COPY.form.categoryLabel}
        help={COPY.form.categoryHint}
        optional
      >
        <Select id={rubroId} name="rubro" defaultValue="">
          <option value="">{COPY.form.categoryEmpty}</option>
          {BUSINESS_CATEGORIES.map((categoria) => (
            <option key={categoria.value} value={categoria.value}>
              {categoria.label}
            </option>
          ))}
        </Select>
      </Field>

      <Button type="submit" variant="primary" loading={pending} className="self-start">
        {pending ? COPY.form.submitting : COPY.form.submit}
      </Button>
    </form>
  );
}
