"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import {
  acceptConversationAction,
  ignoreConversationAction,
} from "@/app/(app)/mensajes/actions";
import { COPY } from "./copy";

/**
 * Aceptar / Ignorar una solicitud de contacto pendiente (§9.2).
 * Aceptar → RPC accept_conversation · Ignorar → blocked (sale del inbox).
 */
export function ConversationActions({
  conversationId,
  className,
}: {
  conversationId: string;
  className?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [action, setAction] = useState<"accept" | "ignore" | null>(null);

  function run(kind: "accept" | "ignore") {
    setAction(kind);
    startTransition(async () => {
      const result =
        kind === "accept"
          ? await acceptConversationAction(conversationId)
          : await ignoreConversationAction(conversationId);
      if (result.ok) {
        toast({
          title: kind === "accept" ? COPY.inbox.accepted : COPY.inbox.ignored,
          variant: kind === "accept" ? "success" : "default",
        });
        router.refresh();
      } else {
        toast({ title: COPY.errors.generic, variant: "danger" });
      }
      setAction(null);
    });
  }

  return (
    <div className={className ?? "flex items-center gap-2"}>
      <Button
        size="sm"
        variant="primary"
        loading={isPending && action === "accept"}
        disabled={isPending}
        onClick={() => run("accept")}
      >
        {COPY.inbox.accept}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        loading={isPending && action === "ignore"}
        disabled={isPending}
        onClick={() => run("ignore")}
      >
        {COPY.inbox.ignore}
      </Button>
    </div>
  );
}
