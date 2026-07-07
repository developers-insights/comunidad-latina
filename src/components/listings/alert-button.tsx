"use client";

import { BellRinging } from "@phosphor-icons/react/dist/ssr";
import { Button, useToast } from "@/components/ui";
import { COPY } from "./copy";

/**
 * "Avisame cuando aparezca" del estado vacío. Las alertas reales llegan en
 * otra rebanada — degradación elegante: confirmación cálida, nunca un botón roto.
 */
export function AlertButton() {
  const { toast } = useToast();

  return (
    <Button
      variant="primary"
      onClick={() =>
        toast({
          title: COPY.list.alertToastTitle,
          description: COPY.list.alertToastBody,
          variant: "success",
        })
      }
    >
      <BellRinging size={18} aria-hidden="true" />
      {COPY.list.alertCta}
    </Button>
  );
}
