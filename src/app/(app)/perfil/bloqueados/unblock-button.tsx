"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { unblockUserAction } from "../actions";

const COPY = {
  action: "Desbloquear",
  successTitle: (name: string) => `Desbloqueaste a ${name}`,
  successBody: "Ya puede volver a contactarte y vas a ver sus publicaciones de nuevo.",
  errorTitle: "No se pudo desbloquear",
  errorBody: "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo.",
} as const;

export function UnblockButton({
  profileId,
  name,
}: {
  profileId: string;
  name: string;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onUnblock() {
    startTransition(async () => {
      const result = await unblockUserAction({ profileId });
      if (result.ok) {
        toast({
          title: COPY.successTitle(name),
          description: COPY.successBody,
          variant: "success",
        });
        router.refresh();
      } else {
        toast({
          title: COPY.errorTitle,
          description: COPY.errorBody,
          variant: "danger",
        });
      }
    });
  }

  return (
    <Button variant="outline" size="sm" loading={isPending} onClick={onUnblock}>
      {COPY.action}
    </Button>
  );
}
