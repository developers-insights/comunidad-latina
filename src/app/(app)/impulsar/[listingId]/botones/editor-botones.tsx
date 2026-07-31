"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FloppyDisk } from "@phosphor-icons/react/dist/ssr";
import { Button, Field, Input, useToast } from "@/components/ui";
import {
  MONETIZATION_COPY,
  externalCtasFor,
  type ExternalCtaKind,
} from "@/lib/monetization";
import { saveListingCtasAction } from "@/lib/monetization/actions";

const M = MONETIZATION_COPY;

export interface EditorBotonesProps {
  listingId: string;
  kind: string;
  initial: Partial<Record<ExternalCtaKind, string | null>>;
}

/**
 * Carga de los botones de acción de un aviso PREMIUM.
 *
 * El formulario sólo muestra los botones que ESE módulo ofrece — un evento no
 * ve "Sitio web" ni un profesional ve "Comprar boletos". Es la misma lista de
 * `MODULE_CTAS` que usa el detalle y que vuelve a aplicar la server action: si
 * alguien manda un botón ajeno en el payload, se descarta allá.
 *
 * Dejar un campo vacío BORRA ese botón. Es idempotente a propósito: guardar es
 * una sola operación sobre las 7 columnas, no "agregar" y "quitar" por separado
 * — que es lo que evita que el aviso quede con un botón que su dueño creía
 * haber sacado.
 */
export function EditorBotones({ listingId, kind, initial }: EditorBotonesProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const cta of externalCtasFor(kind)) seed[cta] = initial[cta] ?? "";
    return seed;
  });
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<ExternalCtaKind | null>(null);

  const ctas = externalCtasFor(kind);

  function save() {
    setError(null);
    setErrorField(null);
    startTransition(async () => {
      const result = await saveListingCtasAction({ listingId, ctas: values });
      if (!result.ok) {
        setError(result.error);
        setErrorField(result.field ?? null);
        return;
      }
      toast({
        title: M.cta.formSaved,
        description: M.cta.formSavedBody,
        variant: "success",
      });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-foreground-secondary">{M.cta.formIntro}</p>

      {ctas.map((cta) => (
        <Field
          key={cta}
          htmlFor={`cta-${cta}`}
          label={M.cta.fieldLabel[cta]}
          help={cta === "directions" ? M.cta.fieldHelp.directions : undefined}
          error={errorField === cta ? (error ?? undefined) : undefined}
          optional
        >
          <Input
            id={`cta-${cta}`}
            type={cta === "phone" || cta === "whatsapp" ? "tel" : "text"}
            inputMode={cta === "phone" || cta === "whatsapp" ? "tel" : "text"}
            maxLength={500}
            value={values[cta] ?? ""}
            placeholder={M.cta.fieldPlaceholder[cta]}
            aria-invalid={errorField === cta ? true : undefined}
            onChange={(event) => {
              setValues((current) => ({ ...current, [cta]: event.target.value }));
              if (errorField === cta) {
                setError(null);
                setErrorField(null);
              }
            }}
          />
        </Field>
      ))}

      {error && !errorField && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <Button
        variant="primary"
        size="lg"
        className="w-full"
        loading={isPending}
        onClick={save}
      >
        <FloppyDisk size={18} aria-hidden="true" />
        Guardar botones
      </Button>
    </div>
  );
}
