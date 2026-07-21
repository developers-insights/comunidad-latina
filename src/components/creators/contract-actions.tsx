"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle,
  Handshake,
  LockKey,
  PaperPlaneTilt,
  Warning,
  X,
} from "@phosphor-icons/react/dist/ssr";
import { BottomSheet, Button, useToast, type ButtonProps } from "@/components/ui";
import { Celebration, useCelebration } from "@/components/motion";
import { transitionContract } from "@/app/(app)/creadores/actions";
import {
  allowedActions,
  type ContractAction,
  type ContractRole,
  type ContractStatus,
} from "./contract-machine";
import { COPY } from "./copy";

const ACTION_ICON: Record<ContractAction, typeof LockKey> = {
  accept: Handshake,
  reject: X,
  fund: LockKey,
  deliver: PaperPlaneTilt,
  release: CheckCircle,
  cancel: X,
  dispute: Warning,
};

const ACTION_VARIANT: Record<ContractAction, ButtonProps["variant"]> = {
  accept: "primary",
  reject: "ghost",
  fund: "primary",
  deliver: "primary",
  release: "primary",
  cancel: "ghost",
  dispute: "outline",
};

/**
 * Botones de transición del contrato, derivados de (rol, estado) con la MISMA
 * máquina pura que autoriza el server — así el cliente jamás ofrece un botón que
 * el server vaya a rechazar. Las acciones sensibles piden confirmación; liberar
 * el pago dispara una celebración sutil.
 */
export function ContractActions({
  contractId,
  role,
  status,
}: {
  contractId: string;
  role: ContractRole;
  status: ContractStatus;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { celebrating, celebrate } = useCelebration();
  const [confirm, setConfirm] = useState<Exclude<ContractAction, "deliver" | "accept"> | null>(
    null,
  );
  const [running, setRunning] = useState<ContractAction | null>(null);

  const actions = allowedActions(role, status);
  if (actions.length === 0) return null;

  async function run(action: ContractAction) {
    setRunning(action);
    try {
      const result = await transitionContract({ contractId, action });
      if (!result.ok) {
        toast({ variant: "danger", title: result.error });
        if (result.stale) router.refresh();
        return;
      }
      if (action === "release") celebrate();
      toast({ variant: "success", title: COPY.actionDone[action] });
      setConfirm(null);
      router.refresh();
    } catch {
      toast({ variant: "danger", title: COPY.contract.errors.generic });
    } finally {
      setRunning(null);
    }
  }

  function onClick(action: ContractAction) {
    // Las acciones positivas ("aceptar", "entregar") son de bajo riesgo y van
    // directo. El resto —incluido "rechazar", que es terminal— pide confirmar.
    if (action === "deliver" || action === "accept") {
      void run(action);
    } else {
      setConfirm(action);
    }
  }

  return (
    <>
      {celebrating && <Celebration active={celebrating} message={COPY.actionDone.release} />}

      <div className="flex flex-col gap-2">
        {actions.map((rule) => {
          const Icon = ACTION_ICON[rule.action];
          return (
            <Button
              key={rule.action}
              variant={ACTION_VARIANT[rule.action]}
              size="lg"
              className="w-full"
              loading={running === rule.action}
              disabled={running !== null}
              onClick={() => onClick(rule.action)}
            >
              <Icon size={18} weight="fill" aria-hidden="true" />
              {COPY.action[rule.action]}
            </Button>
          );
        })}
      </div>

      <BottomSheet
        open={confirm !== null}
        onClose={() => {
          if (running === null) setConfirm(null);
        }}
        title={confirm ? COPY.action[confirm] : undefined}
        ariaLabel={confirm ? COPY.action[confirm] : "Confirmar"}
      >
        {confirm && (
          <div className="flex flex-col gap-4 pb-2">
            <p className="text-sm leading-relaxed text-foreground-secondary">
              {COPY.actionConfirm[confirm]}
            </p>
            <div className="flex flex-col gap-2">
              <Button
                variant={
                  confirm === "cancel" || confirm === "dispute" || confirm === "reject"
                    ? "danger"
                    : "primary"
                }
                size="lg"
                className="w-full"
                loading={running === confirm}
                onClick={() => run(confirm)}
              >
                {COPY.action[confirm]}
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                disabled={running !== null}
                onClick={() => setConfirm(null)}
              >
                Volver
              </Button>
            </div>
          </div>
        )}
      </BottomSheet>
    </>
  );
}
