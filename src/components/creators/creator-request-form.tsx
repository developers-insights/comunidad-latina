"use client";

import { useActionState } from "react";
import { CheckCircle, PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import {
  submitCreatorActivationRequest,
  type CreatorRequestState,
} from "@/app/(app)/creadores/solicitud/actions";

/**
 * Botón de "mandar la solicitud".
 *
 * Deshabilitarlo cuando falta algo es cortesía, no seguridad: quien decide es
 * `app.creator_activation_eligible()` en la base, y la action traduce el
 * rechazo a una frase humana. Por eso el botón deshabilitado SIEMPRE viene con
 * el motivo al lado — un control apagado sin explicación es de las cosas más
 * frustrantes que puede tener una pantalla.
 */

const COPY = {
  submit: "Mandar mi solicitud",
  submitting: "Enviando…",
  blocked: "Completá los requisitos de arriba para poder mandarla.",
} as const;

export function CreatorRequestForm({ eligible }: { eligible: boolean }) {
  const [state, formAction, isPending] = useActionState<CreatorRequestState, FormData>(
    submitCreatorActivationRequest,
    { status: "idle" },
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      {state.status === "error" && (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      )}
      {state.status === "success" && (
        <p role="status" className="flex items-start gap-1.5 text-sm text-success">
          <CheckCircle size={16} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
          {state.message}
        </p>
      )}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        loading={isPending}
        disabled={!eligible || state.status === "success"}
        className="w-full"
      >
        <PaperPlaneTilt size={18} aria-hidden="true" />
        {isPending ? COPY.submitting : COPY.submit}
      </Button>

      {!eligible && <p className="text-center text-sm text-foreground-muted">{COPY.blocked}</p>}
    </form>
  );
}
