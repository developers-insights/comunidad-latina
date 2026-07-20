"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, CheckCircle, X } from "@phosphor-icons/react/dist/ssr";
import { Avatar, Badge, Button, buttonVariants, useToast, type BadgeProps } from "@/components/ui";
import { IdentityBadge } from "@/components/auth/identity-badge";
import { PublisherTrust } from "@/components/listings";
import type { TrustLevel, TrustSignal } from "@/components/trust";
import { cn } from "@/lib/utils";
import { updateApplication } from "@/app/(app)/creadores/actions";
import { RatingStars } from "./rating-stars";
import { ContractForm } from "./contract-form";
import { formatCents } from "./money";
import { COPY } from "./copy";

export interface ApplicationCreator {
  profileId: string;
  displayName: string;
  avatarUrl: string | null;
  identityVerified: boolean;
  headline: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  completedJobs: number;
  score: number;
  level: TrustLevel;
  signals: TrustSignal[];
}

export interface ApplicationRowProps {
  application: {
    id: string;
    status: string;
    message: string;
    proposedAmountCents: number | null;
  };
  creator: ApplicationCreator;
  gigTitle: string;
  /** Presupuesto del aviso en centavos (fallback para prellenar el contrato). */
  gigBudgetCents: number;
}

const STATUS_LABEL: Record<string, string> = {
  submitted: COPY.applications.submitted,
  accepted: COPY.applications.accepted,
  declined: COPY.applications.declined,
  withdrawn: COPY.applications.withdrawn,
};

const STATUS_VARIANT: Record<string, NonNullable<BadgeProps["variant"]>> = {
  submitted: "info",
  accepted: "success",
  declined: "neutral",
  withdrawn: "neutral",
};

/**
 * Fila de una propuesta recibida (vista del dueño del aviso): perfil resumido
 * del creador con su "score de crédito" (estrellas + trabajos + Trust Score +
 * verificación), su mensaje, y las acciones aceptar / rechazar / crear contrato.
 */
export function ApplicationRow({ application, creator, gigTitle, gigBudgetCents }: ApplicationRowProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [status, setStatus] = useState(application.status);
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);

  async function act(action: "accept" | "decline") {
    setPending(action);
    try {
      const result = await updateApplication({ applicationId: application.id, action });
      if (!result.ok) {
        toast({ variant: "danger", title: result.error });
        return;
      }
      setStatus(result.status);
      toast({ variant: "success", title: COPY.applications.statusUpdated });
      router.refresh();
    } catch {
      toast({ variant: "danger", title: COPY.applications.errors.generic });
    } finally {
      setPending(null);
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4">
      <div className="flex items-start gap-3">
        <Avatar
          size="md"
          src={creator.avatarUrl}
          name={creator.displayName}
          badge={creator.identityVerified ? <IdentityBadge /> : undefined}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-semibold text-foreground">{creator.displayName}</p>
            <Badge variant={STATUS_VARIANT[status] ?? "neutral"} className="shrink-0">
              {STATUS_LABEL[status] ?? status}
            </Badge>
          </div>
          {creator.headline && (
            <p className="truncate text-sm text-foreground-secondary">{creator.headline}</p>
          )}
        </div>
      </div>

      {/* Score de crédito del creador: estrellas + trabajos + Trust Score */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <RatingStars avg={creator.ratingAvg} count={creator.ratingCount} />
        {creator.completedJobs > 0 && (
          <span className="inline-flex items-center gap-1 text-sm text-foreground-secondary">
            <CheckCircle size={15} weight="fill" aria-hidden="true" className="text-success" />
            {COPY.applications.completedJobs(creator.completedJobs)}
          </span>
        )}
        <PublisherTrust
          displayName={creator.displayName}
          firstName={creator.displayName.split(/\s+/)[0] ?? creator.displayName}
          score={creator.score}
          level={creator.level}
          signals={creator.signals}
          size="inline"
        />
      </div>

      <p className="whitespace-pre-line rounded-md bg-surface-subtle px-3 py-2.5 text-sm text-foreground-secondary">
        {application.message}
      </p>

      {application.proposedAmountCents !== null && (
        <p className="text-sm text-foreground-secondary">
          {COPY.applications.proposedAmount}{" "}
          <span className="numeric font-bold text-brand">
            {formatCents(application.proposedAmountCents)}
          </span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/creadores/perfil/${creator.profileId}`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          {COPY.applications.viewProfile}
          <ArrowRight size={15} aria-hidden="true" />
        </Link>

        {status === "submitted" && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              loading={pending === "decline"}
              disabled={pending !== null}
              onClick={() => act("decline")}
            >
              <X size={15} aria-hidden="true" />
              {COPY.applications.decline}
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={pending === "accept"}
              disabled={pending !== null}
              onClick={() => act("accept")}
            >
              <Check size={15} weight="bold" aria-hidden="true" />
              {COPY.applications.accept}
            </Button>
          </>
        )}

        {status === "accepted" && (
          <ContractForm
            creatorId={creator.profileId}
            creatorName={creator.displayName}
            applicationId={application.id}
            defaultTitle={gigTitle}
            defaultAmountCents={application.proposedAmountCents ?? gigBudgetCents}
            triggerLabel={COPY.applications.createContract}
            triggerSize="sm"
            triggerClassName="ml-auto"
          />
        )}
      </div>
    </li>
  );
}

/**
 * Control para el creador que ya aplicó: retirar su propuesta (submitted).
 */
export function WithdrawButton({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);

  async function withdraw() {
    setPending(true);
    try {
      const result = await updateApplication({ applicationId, action: "withdraw" });
      if (!result.ok) {
        toast({ variant: "danger", title: result.error });
        return;
      }
      toast({ variant: "info", title: COPY.gig.applicationWithdrawn });
      router.refresh();
    } catch {
      toast({ variant: "danger", title: COPY.applications.errors.generic });
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant="ghost" size="sm" loading={pending} onClick={withdraw}>
      {COPY.applications.withdraw}
    </Button>
  );
}
