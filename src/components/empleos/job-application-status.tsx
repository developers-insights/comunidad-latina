"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChatCircleDots,
  Confetti,
  HourglassMedium,
  Prohibit,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { BezelCard, Button, buttonVariants, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { updateJobApplicationAction } from "@/app/(app)/empleos/actions";
import type { ViewerApplication } from "@/app/(app)/empleos/queries";
import { COPY } from "./copy";

const C = COPY.apply.status;

type Status = ViewerApplication["status"];

/** Un estado = un tono + un ícono + su copy. Nada de textos armados en el render. */
const PRESENTATION: Record<
  Status,
  { title: string; body: string; icon: Icon; variant: "default" | "success" }
> = {
  submitted: {
    title: C.submittedTitle,
    body: C.submittedBody,
    icon: HourglassMedium,
    variant: "default",
  },
  accepted: {
    title: C.acceptedTitle,
    body: C.acceptedBody,
    icon: Confetti,
    variant: "success",
  },
  declined: {
    title: C.declinedTitle,
    body: C.declinedBody,
    icon: Prohibit,
    variant: "default",
  },
  withdrawn: {
    title: C.withdrawnTitle,
    body: C.withdrawnBody,
    icon: Prohibit,
    variant: "default",
  },
};

export interface JobApplicationStatusProps {
  application: ViewerApplication;
}

/**
 * Estado de MI postulación, en lugar del CTA "Postularme".
 *
 * `withdrawn` y `declined` NO vuelven a ofrecer postularse: la tabla tiene un
 * único registro por (aviso, persona), así que un segundo intento chocaría
 * contra el unique. Antes que un botón que falla, decimos qué pasó y ofrecemos
 * la salida que sí existe — seguir mirando empleos.
 */
export function JobApplicationStatus({ application }: JobApplicationStatusProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [status, setStatus] = useState<Status>(application.status);
  const [pending, setPending] = useState(false);

  const view = PRESENTATION[status] ?? PRESENTATION.submitted;
  const IconCmp = view.icon;

  async function withdraw() {
    setPending(true);
    try {
      const result = await updateJobApplicationAction({
        applicationId: application.id,
        action: "withdraw",
      });
      if (!result.ok) {
        toast({ variant: "danger", title: result.message ?? C.withdrawError });
        return;
      }
      setStatus(result.status);
      toast({ variant: "info", title: C.withdrawn });
      router.refresh();
    } catch {
      toast({ variant: "danger", title: C.withdrawError });
    } finally {
      setPending(false);
    }
  }

  return (
    <BezelCard
      variant={view.variant}
      coreClassName="flex flex-col items-center gap-2 px-6 py-6 text-center"
      role="status"
    >
      <IconCmp
        size={40}
        weight="fill"
        aria-hidden="true"
        className={status === "accepted" ? "text-success" : "text-foreground-muted"}
      />
      <h2 className="font-display text-lg font-bold text-foreground">{view.title}</h2>
      <p className="max-w-[40ch] text-sm text-foreground-secondary">{view.body}</p>

      {status === "submitted" && (
        <Button variant="ghost" size="sm" className="mt-1" loading={pending} onClick={withdraw}>
          {C.withdraw}
        </Button>
      )}

      {status === "accepted" && (
        <Link
          href="/mensajes"
          className={cn(buttonVariants({ variant: "primary", size: "md" }), "mt-2")}
        >
          <ChatCircleDots size={18} weight="fill" aria-hidden="true" />
          {C.goToMessages}
        </Link>
      )}

      {(status === "declined" || status === "withdrawn") && (
        <Link
          href="/empleos"
          className={cn(buttonVariants({ variant: "outline", size: "md" }), "mt-2")}
        >
          {C.browseMore}
        </Link>
      )}
    </BezelCard>
  );
}
