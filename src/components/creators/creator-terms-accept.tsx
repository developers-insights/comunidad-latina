"use client";

import { useActionState } from "react";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import {
  acceptCreatorTerms,
  type CreatorTermsActionState,
} from "@/app/(app)/creadores/terminos/actions";
import type { CreatorTermsState as AcceptanceState } from "@/lib/creators/terms";

/**
 * Aceptar los términos de creador.
 *
 * La versión viaja en un campo oculto y el servidor la compara con la vigente:
 * si los términos cambiaron con esta pantalla abierta, no se guarda una firma
 * sobre un texto que la persona no leyó (ver `terminos/actions.ts`).
 *
 * El botón dice lo que hace ("Acepto los términos"), no "Continuar": nadie
 * debería descubrir después que un botón neutro lo ató a un contrato.
 */

const COPY = {
  accept: "Acepto los términos de creador",
  again: "Aceptar la versión nueva",
  saving: "Guardando…",
  acceptedOn: (when: string) => `Los aceptaste el ${when}.`,
  outdated:
    "Aceptaste una versión anterior. Lo que firmaste sigue valiendo; te pedimos que leas los cambios y vuelvas a aceptar.",
} as const;

export function CreatorTermsAccept({
  version,
  state: acceptance,
  acceptedAtLabel,
}: {
  /** Versión vigente del documento en pantalla. */
  version: string;
  /** En qué situación está la persona respecto de esa versión. */
  state: AcceptanceState;
  /** Fecha de la aceptación anterior, ya formateada. */
  acceptedAtLabel: string | null;
}) {
  const [result, formAction, isPending] = useActionState<CreatorTermsActionState, FormData>(
    acceptCreatorTerms,
    { status: "idle" },
  );

  const alreadyCurrent = acceptance === "current" || result.status === "success";

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="version" value={version} />

      {acceptance === "outdated" && result.status !== "success" && (
        <p className="rounded-md bg-warning-bg px-3 py-2.5 text-sm leading-relaxed text-warning-ink">
          {COPY.outdated}
        </p>
      )}

      {result.status === "error" && (
        <p role="alert" className="text-sm text-danger">
          {result.message}
        </p>
      )}

      {alreadyCurrent ? (
        <p role="status" className="flex items-start gap-1.5 text-sm text-success">
          <CheckCircle size={16} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
          {result.status === "success"
            ? result.message
            : acceptedAtLabel
              ? COPY.acceptedOn(acceptedAtLabel)
              : "Ya los aceptaste."}
        </p>
      ) : (
        <Button type="submit" variant="primary" size="lg" loading={isPending} className="w-full">
          {isPending ? COPY.saving : acceptance === "outdated" ? COPY.again : COPY.accept}
        </Button>
      )}
    </form>
  );
}
