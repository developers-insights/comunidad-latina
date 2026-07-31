"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChatCircleDots,
  ChatsCircle,
  Confetti,
  Eye,
  HourglassMedium,
  Lock,
  MinusCircle,
  Prohibit,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { BezelCard, Button, Dialog, buttonVariants, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  canApplicantWithdraw,
  type JobApplicationStatus,
} from "@/lib/empleos/application-status";
import { withdrawJobApplicationAction } from "@/app/(app)/empleos/actions";
import type { ViewerApplication } from "@/app/(app)/empleos/queries";
import { COPY } from "./copy";

const C = COPY.apply.status;

/** Un estado = un tono + un ícono + su copy. Nada de textos armados en el render. */
const PRESENTATION: Record<
  JobApplicationStatus,
  { title: string; body: string; icon: Icon; variant: "default" | "success" | "warning" }
> = {
  submitted: {
    title: C.submittedTitle,
    body: C.submittedBody,
    icon: HourglassMedium,
    variant: "default",
  },
  reviewing: {
    title: C.reviewingTitle,
    body: C.reviewingBody,
    icon: Eye,
    variant: "default",
  },
  interview: {
    title: C.interviewTitle,
    body: C.interviewBody,
    icon: ChatsCircle,
    variant: "warning",
  },
  hired: {
    title: C.hiredTitle,
    body: C.hiredBody,
    icon: Confetti,
    variant: "success",
  },
  rejected: {
    title: C.rejectedTitle,
    body: C.rejectedBody,
    icon: Prohibit,
    variant: "default",
  },
  closed: {
    title: C.closedTitle,
    body: C.closedBody,
    icon: Lock,
    variant: "default",
  },
  withdrawn: {
    title: C.withdrawnTitle,
    body: C.withdrawnBody,
    icon: MinusCircle,
    variant: "default",
  },
};

export interface JobApplicationStatusProps {
  application: ViewerApplication;
}

/**
 * Estado de MI postulación, en lugar del CTA "Postularme".
 *
 * Ningún estado resuelto vuelve a ofrecer postularse: la tabla tiene un único
 * registro por (aviso, persona), así que un segundo intento chocaría contra el
 * unique. Antes que un botón que falla, decimos qué pasó y ofrecemos la salida
 * que sí existe — escribir por Mensajes, o seguir mirando empleos.
 *
 * Retirarse pide confirmación porque no tiene vuelta atrás: el embudo solo
 * avanza (0047), así que `withdrawn` es definitivo en ese aviso.
 */
export function JobApplicationStatus({ application }: JobApplicationStatusProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [status, setStatus] = useState<JobApplicationStatus>(application.status);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const view = PRESENTATION[status] ?? PRESENTATION.submitted;
  const IconCmp = view.icon;
  const canWithdraw = canApplicantWithdraw(status);
  const canMessage = status === "interview" || status === "hired";

  async function withdraw() {
    setPending(true);
    try {
      const result = await withdrawJobApplicationAction({ applicationId: application.id });
      if (!result.ok) {
        toast({ variant: "danger", title: result.message ?? C.withdrawError });
        return;
      }
      setStatus("withdrawn");
      setConfirming(false);
      toast({ variant: "info", title: C.withdrawn });
      router.refresh();
    } catch {
      toast({ variant: "danger", title: C.withdrawError });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <BezelCard
        variant={view.variant === "warning" ? "warning" : view.variant}
        coreClassName="flex flex-col items-center gap-2 px-6 py-6 text-center"
        role="status"
      >
        <IconCmp
          size={40}
          weight="fill"
          aria-hidden="true"
          className={status === "hired" ? "text-success" : "text-foreground-muted"}
        />
        <h2 className="font-display text-lg font-bold text-foreground">{view.title}</h2>
        <p className="max-w-[40ch] text-sm text-foreground-secondary">{view.body}</p>

        {canMessage && (
          <Link
            href="/mensajes"
            className={cn(buttonVariants({ variant: "primary", size: "md" }), "mt-2")}
          >
            <ChatCircleDots size={18} weight="fill" aria-hidden="true" />
            {C.goToMessages}
          </Link>
        )}

        {(status === "rejected" || status === "withdrawn" || status === "closed") && (
          <Link
            href="/empleos"
            className={cn(buttonVariants({ variant: "outline", size: "md" }), "mt-2")}
          >
            {C.browseMore}
          </Link>
        )}

        <Link
          href="/empleos/mis-aplicaciones"
          className="mt-1 min-h-11 text-sm font-semibold text-brand underline underline-offset-2"
        >
          {C.seeAll}
        </Link>

        {canWithdraw && (
          <Button variant="ghost" size="sm" className="mt-1" onClick={() => setConfirming(true)}>
            {C.withdraw}
          </Button>
        )}
      </BezelCard>

      <Dialog
        open={confirming}
        onClose={() => !pending && setConfirming(false)}
        title={C.withdrawConfirmTitle}
        description={C.withdrawConfirmBody}
        highRisk
        footer={
          <>
            <Button variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
              {C.withdrawCancel}
            </Button>
            <Button variant="danger" loading={pending} onClick={withdraw}>
              {C.withdrawConfirm}
            </Button>
          </>
        }
      />
    </>
  );
}
