"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CaretRight,
  Eye,
  EyeSlash,
  FilePdf,
  LinkSimple,
  MapPin,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import { Button, Dialog, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { canApplicantWithdraw } from "@/lib/empleos/application-status";
import {
  updateShareProfileAction,
  withdrawJobApplicationAction,
} from "@/app/(app)/empleos/actions";
import type { MyApplication } from "@/app/(app)/empleos/queries";
import { ApplicationStatusBadge } from "./application-status-badge";
import { COPY } from "./copy";

const C = COPY.myApplications;
const S = COPY.apply.status;

export interface MyApplicationCardProps {
  application: MyApplication;
}

/**
 * Una postulación en "Mis postulaciones".
 *
 * Muestra a qué me postulé, cómo va, y las dos únicas cosas que todavía puedo
 * mover: retirar la postulación (definitivo — el embudo solo avanza) y el
 * consentimiento de mostrar mi perfil, que la base me reserva a MÍ (0047:
 * `share_profile` es la única columna del postulante que sigue siendo editable
 * después de postularse, y solo por el postulante).
 *
 * Todo lo demás —respuestas, mensaje, currículum, enlaces— está congelado por
 * trigger. Por eso la tarjeta LISTA lo que envió en vez de ofrecer editarlo:
 * un botón "editar" que la base rechaza sería peor que no tenerlo.
 */
export function MyApplicationCard({ application }: MyApplicationCardProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [status, setStatus] = useState(application.status);
  const [share, setShare] = useState(application.shareProfile);
  const [sharePending, setSharePending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  const canWithdraw = canApplicantWithdraw(status);

  async function toggleShare() {
    setSharePending(true);
    const next = !share;
    try {
      const result = await updateShareProfileAction({
        applicationId: application.id,
        share: next,
      });
      if (!result.ok) {
        toast({ variant: "danger", title: result.message ?? C.profileError });
        return;
      }
      setShare(result.share);
      toast({ variant: "success", title: C.profileUpdated });
    } catch {
      toast({ variant: "danger", title: C.profileError });
    } finally {
      setSharePending(false);
    }
  }

  async function withdraw() {
    setWithdrawing(true);
    try {
      const result = await withdrawJobApplicationAction({ applicationId: application.id });
      if (!result.ok) {
        toast({ variant: "danger", title: result.message ?? S.withdrawError });
        return;
      }
      setStatus("withdrawn");
      setConfirming(false);
      toast({ variant: "info", title: S.withdrawn });
      router.refresh();
    } catch {
      toast({ variant: "danger", title: S.withdrawError });
    } finally {
      setWithdrawing(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-base font-bold leading-snug text-foreground">
            {application.jobTitle}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-foreground-muted">
            {application.salaryLabel && (
              <span className="numeric font-semibold text-foreground-secondary">
                {application.salaryLabel}
              </span>
            )}
            {application.areaLabel && (
              <span className="flex items-center gap-1">
                <MapPin size={12} aria-hidden="true" />
                {application.areaLabel}
              </span>
            )}
          </div>
        </div>
        <ApplicationStatusBadge status={status} className="shrink-0" />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-muted">
        <span>{C.appliedAt(application.createdAtLabel)}</span>
        {application.updatedAtLabel !== application.createdAtLabel && (
          <span>{C.updatedAt(application.updatedAtLabel)}</span>
        )}
      </div>

      {!application.jobIsOpen && (
        <p className="flex items-center gap-1.5 text-xs text-foreground-muted">
          <WarningCircle size={14} aria-hidden="true" className="shrink-0" />
          {C.jobClosed}
        </p>
      )}

      {/* Lo que mandé, resumido: no se edita (la base lo congela), se consulta. */}
      <div className="flex flex-wrap items-center gap-2">
        {application.hasCv && (
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-subtle px-2.5 py-1 text-xs font-medium text-foreground-secondary">
            <FilePdf size={13} weight="fill" aria-hidden="true" />
            {C.withCv}
          </span>
        )}
        {application.portfolioLinks.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-subtle px-2.5 py-1 text-xs font-medium text-foreground-secondary">
            <LinkSimple size={13} aria-hidden="true" />
            {C.withLinks(application.portfolioLinks.length)}
          </span>
        )}
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
            share
              ? "bg-surface-subtle text-foreground-secondary"
              : "bg-warning-bg text-warning-ink",
          )}
        >
          {share ? (
            <Eye size={13} aria-hidden="true" />
          ) : (
            <EyeSlash size={13} aria-hidden="true" />
          )}
          {share ? C.profileShared : C.profileHidden}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-3">
        <Link
          href={`/empleos/${application.jobId}`}
          className={cn(
            "inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          )}
        >
          {C.viewJob}
          <CaretRight size={14} weight="bold" aria-hidden="true" />
        </Link>

        <div className="flex flex-wrap items-center gap-1">
          {/* El consentimiento se puede retirar SIEMPRE, incluso con la
              postulación resuelta: es un dato personal, no una jugada del embudo. */}
          <Button variant="ghost" size="sm" loading={sharePending} onClick={toggleShare}>
            {share ? C.profileToggleOff : C.profileToggleOn}
          </Button>
          {canWithdraw && (
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
              {S.withdraw}
            </Button>
          )}
        </div>
      </div>

      <Dialog
        open={confirming}
        onClose={() => !withdrawing && setConfirming(false)}
        title={S.withdrawConfirmTitle}
        description={S.withdrawConfirmBody}
        highRisk
        footer={
          <>
            <Button variant="ghost" disabled={withdrawing} onClick={() => setConfirming(false)}>
              {S.withdrawCancel}
            </Button>
            <Button variant="danger" loading={withdrawing} onClick={withdraw}>
              {S.withdrawConfirm}
            </Button>
          </>
        }
      />
    </li>
  );
}
