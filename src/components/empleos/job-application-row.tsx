"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "@phosphor-icons/react/dist/ssr";
import { Avatar, Badge, Button, useToast, type BadgeProps } from "@/components/ui";
import { PublisherTrust, firstNameOf, toTrustLevel } from "@/components/listings";
import type { TrustSignal } from "@/components/trust";
import { updateJobApplicationAction } from "@/app/(app)/empleos/actions";
import type { JobApplicationView } from "@/app/(app)/empleos/queries";
import { COPY } from "./copy";

const C = COPY.detail.applications;

const STATUS_LABEL: Record<string, string> = {
  submitted: C.statusSubmitted,
  accepted: C.statusAccepted,
  declined: C.statusDeclined,
  withdrawn: C.statusWithdrawn,
};

const STATUS_VARIANT: Record<string, NonNullable<BadgeProps["variant"]>> = {
  submitted: "info",
  accepted: "success",
  declined: "neutral",
  withdrawn: "neutral",
};

export interface JobApplicationRowProps {
  application: JobApplicationView;
  /**
   * Desglose del Trust Score de quien se postula. Va aparte del `trust` del
   * modelo porque las señales las arma el server con la gramática canónica
   * (buildTrustSignals) — el badge nunca es un número mudo (§3.3).
   */
  trustSignals: TrustSignal[];
}

/**
 * Una postulación recibida, en la vista de quien publicó el aviso: quién es,
 * cuánta confianza trae, qué respondió y las dos decisiones posibles.
 *
 * Aceptar/rechazar es OPTIMISTA: la fila cambia de estado en el acto y vuelve
 * atrás si el server dice que no. La respuesta a una postulación es el momento
 * más impaciente del flujo — quien contrata está revisando varias seguidas.
 */
export function JobApplicationRow({ application, trustSignals }: JobApplicationRowProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [status, setStatus] = useState(application.status);
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);

  async function act(action: "accept" | "decline") {
    const previous = status;
    setPending(action);
    setStatus(action === "accept" ? "accepted" : "declined");
    try {
      const result = await updateJobApplicationAction({
        applicationId: application.id,
        action,
      });
      if (!result.ok) {
        setStatus(previous);
        toast({ variant: "danger", title: result.message ?? C.errorGeneric });
        return;
      }
      setStatus(result.status);
      toast({ variant: "success", title: C.updated });
      router.refresh();
    } catch {
      setStatus(previous);
      toast({ variant: "danger", title: C.errorGeneric });
    } finally {
      setPending(null);
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4">
      <div className="flex items-start gap-3">
        <Avatar size="md" src={application.avatarUrl} name={application.displayName} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-semibold text-foreground">{application.displayName}</p>
            <Badge variant={STATUS_VARIANT[status] ?? "neutral"} className="shrink-0">
              {STATUS_LABEL[status] ?? status}
            </Badge>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="text-xs text-foreground-muted">{application.createdAtLabel}</span>
            {application.trust && (
              <PublisherTrust
                displayName={application.displayName}
                firstName={firstNameOf(application.displayName)}
                score={application.trust.score}
                level={toTrustLevel(application.trust.level)}
                signals={trustSignals}
                size="inline"
              />
            )}
          </div>
        </div>
      </div>

      {application.message && (
        <div>
          <h4 className="mb-1 text-xs font-semibold text-foreground-secondary">
            {C.messageTitle}
          </h4>
          <p className="whitespace-pre-line rounded-md bg-surface-subtle px-3 py-2.5 text-sm text-foreground-secondary">
            {application.message}
          </p>
        </div>
      )}

      {application.answers.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-xs font-semibold text-foreground-secondary">
            {C.answersTitle}
          </h4>
          {/* Pregunta → respuesta como lista de definición: es exactamente eso,
              y así el lector de pantalla las lee apareadas. */}
          <dl className="flex flex-col gap-2">
            {/* key con índice: dos preguntas pueden tener el MISMO texto. */}
            {application.answers.map((answer, index) => (
              <div key={`${index}-${answer.question}`} className="flex flex-col gap-0.5">
                <dt className="text-sm text-foreground-muted">{answer.question}</dt>
                <dd className="text-sm font-semibold text-foreground">{answer.answer}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {status === "submitted" && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            loading={pending === "decline"}
            disabled={pending !== null}
            onClick={() => act("decline")}
          >
            <X size={15} aria-hidden="true" />
            {C.decline}
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={pending === "accept"}
            disabled={pending !== null}
            onClick={() => act("accept")}
          >
            <Check size={15} weight="bold" aria-hidden="true" />
            {C.accept}
          </Button>
        </div>
      )}

      {status === "accepted" && (
        <p className="text-sm text-foreground-secondary">{C.acceptedNote}</p>
      )}
    </li>
  );
}
