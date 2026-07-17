"use client";

import { useState, useTransition } from "react";
import { DotsThree, Prohibit } from "@phosphor-icons/react/dist/ssr";
import { blockUserAction } from "@/app/(app)/perfil/actions";
import { ReportScamButton, ReportSheet } from "@/components/trust";
import { BottomSheet, Button, Dialog, useToast } from "@/components/ui";

const COPY = {
  menuLabel: "Más acciones",
  blockLabel: "Bloquear a esta persona",
  blockDialogTitle: "¿Bloquear a esta persona?",
  blockDialogDescription:
    "No va a poder contactarte ni escribirte, y las conversaciones que ya tengan se cierran. Podés desbloquearla cuando quieras.",
  blockConfirm: "Bloquear",
  blockCancel: "Cancelar",
  blockSuccess: "Bloqueaste a esta persona.",
  blockError:
    "No pudimos bloquear a esta persona — no es tu culpa. Probá de nuevo.",
  blockNeedLogin: "Entrá a tu cuenta para poder bloquear.",
} as const;

/**
 * Menú "⋯" del perfil público (§4.c): ReportScamButton SIEMPRE primero — la
 * consistencia posicional es en sí misma una señal de seguridad (§3.3).
 * Bloquear va después: es la acción más fuerte, nunca compite con reportar.
 */
export function ProfileActionsMenu({ profileId }: { profileId: string }) {
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function confirmBlock() {
    startTransition(async () => {
      const result = await blockUserAction({ profileId });
      setBlockDialogOpen(false);
      if (result.ok) {
        toast({ title: COPY.blockSuccess, variant: "success" });
      } else {
        toast({
          title:
            result.code === "unauthenticated"
              ? COPY.blockNeedLogin
              : COPY.blockError,
          variant: "danger",
        });
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        aria-label={COPY.menuLabel}
        aria-haspopup="dialog"
        className="flex size-11 items-center justify-center rounded-full text-foreground-secondary transition-colors duration-(--duration-fast) hover:bg-surface-subtle hover:text-foreground"
      >
        <DotsThree size={26} weight="bold" aria-hidden="true" />
      </button>

      <BottomSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        ariaLabel={COPY.menuLabel}
      >
        <div className="-mx-2 flex flex-col pb-2">
          {/* Reportar SIEMPRE primero (§3.3) */}
          <ReportScamButton
            onReport={() => {
              setMenuOpen(false);
              setReportOpen(true);
            }}
          />
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setBlockDialogOpen(true);
            }}
            className="flex min-h-11 w-full select-none items-center gap-2.5 px-4 py-3 text-left text-sm font-medium text-foreground-secondary transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring) hover:bg-surface-subtle hover:text-foreground active:scale-[0.98]"
          >
            <Prohibit size={18} aria-hidden="true" className="shrink-0" />
            {COPY.blockLabel}
          </button>
        </div>
      </BottomSheet>

      <ReportSheet
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        targetKind="profile"
        targetId={profileId}
      />

      <Dialog
        open={blockDialogOpen}
        onClose={() => !isPending && setBlockDialogOpen(false)}
        title={COPY.blockDialogTitle}
        description={COPY.blockDialogDescription}
        highRisk
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setBlockDialogOpen(false)}
              disabled={isPending}
            >
              {COPY.blockCancel}
            </Button>
            <Button variant="danger" loading={isPending} onClick={confirmBlock}>
              {COPY.blockConfirm}
            </Button>
          </>
        }
      />
    </>
  );
}
