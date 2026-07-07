"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { HandWaving } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { acceptConversationAction } from "@/app/(app)/mensajes/actions";
import { COPY } from "./copy";

/**
 * Banner de solicitud pendiente dentro del hilo, para la contraparte:
 * explica quién quiere hablar y por qué, con Aceptar como única acción primaria.
 */
export function AcceptBanner({
  conversationId,
  otherName,
  listingTitle,
}: {
  conversationId: string;
  otherName: string;
  listingTitle: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  function accept() {
    startTransition(async () => {
      const result = await acceptConversationAction(conversationId);
      if (result.ok) {
        toast({ title: COPY.thread.accepted, variant: "success" });
        router.refresh();
      } else {
        toast({ title: COPY.errors.generic, variant: "danger" });
      }
    });
  }

  return (
    <BezelCard className="text-center">
      <span
        aria-hidden="true"
        className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand"
      >
        <HandWaving size={26} />
      </span>
      <h2 className="mt-3 font-display text-lg font-semibold text-foreground">
        {COPY.thread.pendingAsCounterpartTitle}
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-foreground-secondary">
        {COPY.thread.pendingAsCounterpart(otherName, listingTitle)}
      </p>
      <Button
        variant="primary"
        className="mt-4 w-full"
        loading={isPending}
        onClick={accept}
      >
        {COPY.thread.accept}
      </Button>
    </BezelCard>
  );
}
