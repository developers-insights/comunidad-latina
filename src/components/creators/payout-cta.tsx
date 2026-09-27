"use client";

import { useState } from "react";
import { ArrowUpRight, Bank } from "@phosphor-icons/react/dist/ssr";
import { Button, useToast, type ButtonProps } from "@/components/ui";
import { openPayoutDashboard, startPayoutOnboarding } from "@/app/(app)/creadores/cobros/actions";
import { FLOW_COPY } from "./flow-copy";

export function PayoutCta({
  label,
  mode = "onboarding",
  variant = "primary",
  className,
}: {
  label: string;
  mode?: "onboarding" | "dashboard";
  variant?: ButtonProps["variant"];
  className?: string;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      const result = mode === "dashboard" ? await openPayoutDashboard() : await startPayoutOnboarding();
      if (!result.ok) {
        toast({ variant: "danger", title: result.error });
        setBusy(false);
        return;
      }
      window.location.assign(result.url);
    } catch (error) {
      console.error("[cobros] no se pudo abrir Stripe", error);
      toast({ variant: "danger", title: FLOW_COPY.generic });
      setBusy(false);
    }
  }

  return (
    <Button variant={variant} size="lg" className={className} loading={busy} onClick={go}>
      <Bank size={18} weight="fill" aria-hidden="true" />
      {label}
      <ArrowUpRight size={15} weight="bold" aria-hidden="true" />
    </Button>
  );
}
