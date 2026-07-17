"use client";

import { useState, useTransition } from "react";
import {
  ArrowCounterClockwise,
  Clock,
  Prohibit,
} from "@phosphor-icons/react/dist/ssr";
import { Avatar, Badge, Button, Dialog, Textarea, useToast } from "@/components/ui";
import type { StaffRole } from "@/app/admin/guard";
import {
  banUserAction,
  reactivateUserAction,
  suspendUserAction,
} from "@/app/admin/miembros/actions";

/**
 * Fila de un miembro (panel Miembros): estado de cuenta + acciones de
 * sanción. Un solo Dialog highRisk por fila cubre las 3 acciones que piden
 * motivo (suspender ×2, dar de baja) — reactivar no lo pide (§ RPC).
 */

export interface MemberRowData {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  /** profiles.role — informativo (staff no se sanciona desde acá, lo valida la RPC igual). */
  role: string;
  accountStatus: "active" | "suspended" | "banned";
  suspendedUntil: string | null;
  openReports: number;
}

type PendingAction = { kind: "suspend"; days: 7 | 30 } | { kind: "ban" } | { kind: "reactivate" };

const COPY = {
  active: "Activo",
  banned: "De baja",
  suspendedUntil: (date: string) => `Suspendido hasta ${date}`,
  staffBadge: "Parte del equipo",
  reportsBadge: (n: number) => (n === 1 ? "1 reporte abierto" : `${n} reportes abiertos`),
  suspend7: "Suspender 7 días",
  suspend30: "Suspender 30 días",
  ban: "Dar de baja",
  reactivate: "Reactivar",
  reasonLabel: "Motivo (obligatorio)",
  reasonPlaceholder: "Ej: publicó contenido falso repetidas veces.",
  cancel: "Cancelar",
  confirmSuspend: (days: number) => `Suspender ${days} días`,
  confirmBan: "Sí, dar de baja",
  confirmReactivate: "Sí, reactivar",
  titleSuspend: (name: string, days: number) => `¿Suspender a ${name} por ${days} días?`,
  descSuspend:
    "Su cuenta queda en pausa hasta que termine la suspensión: no va a poder usar la app ni escribir mensajes. Se reactiva sola al vencer.",
  titleBan: (name: string) => `¿Dar de baja a ${name}?`,
  descBan:
    "Bloquea su acceso a la cuenta y su login. Podés reactivarla más adelante si hace falta.",
  titleReactivate: (name: string) => `¿Reactivar a ${name}?`,
  descReactivate: "Vuelve a poder publicar, mandar mensajes y entrar con su cuenta ya mismo.",
  reasonRequired: "Contanos el motivo antes de confirmar.",
  suspendedOk: "Listo — la cuenta quedó suspendida.",
  bannedOk: "Listo — la cuenta quedó dada de baja.",
  reactivatedOk: "Listo — la cuenta volvió a estar activa.",
} as const;

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

export function MemberRow({
  member,
  staffRole,
}: {
  member: MemberRowData;
  staffRole: StaffRole;
}) {
  const { toast } = useToast();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const canBan = staffRole === "domain_admin" || staffRole === "global_admin";
  const isStaffProfile = member.role !== "member";

  function openDialog(action: PendingAction) {
    setReason("");
    setReasonError(null);
    setPending(action);
  }

  function closeDialog() {
    if (busy) return;
    setPending(null);
  }

  function confirm() {
    if (!pending) return;
    if (pending.kind !== "reactivate" && reason.trim().length < 5) {
      setReasonError(COPY.reasonRequired);
      return;
    }

    startTransition(async () => {
      const result =
        pending.kind === "suspend"
          ? await suspendUserAction({ profileId: member.id, days: pending.days, reason: reason.trim() })
          : pending.kind === "ban"
            ? await banUserAction({ profileId: member.id, reason: reason.trim() })
            : await reactivateUserAction({ profileId: member.id });

      setPending(null);
      if (result.ok) {
        const okMessage =
          pending.kind === "suspend"
            ? COPY.suspendedOk
            : pending.kind === "ban"
              ? COPY.bannedOk
              : COPY.reactivatedOk;
        toast({ title: okMessage, variant: "success" });
      } else {
        toast({ title: result.message, variant: "danger" });
      }
    });
  }

  const dialogCopy =
    pending?.kind === "suspend"
      ? {
          title: COPY.titleSuspend(member.displayName, pending.days),
          description: COPY.descSuspend,
          confirmLabel: COPY.confirmSuspend(pending.days),
        }
      : pending?.kind === "ban"
        ? { title: COPY.titleBan(member.displayName), description: COPY.descBan, confirmLabel: COPY.confirmBan }
        : pending?.kind === "reactivate"
          ? {
              title: COPY.titleReactivate(member.displayName),
              description: COPY.descReactivate,
              confirmLabel: COPY.confirmReactivate,
            }
          : null;

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar src={member.avatarUrl} name={member.displayName} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{member.displayName}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {member.accountStatus === "active" && <Badge variant="success">{COPY.active}</Badge>}
            {member.accountStatus === "suspended" && (
              <Badge variant="warning">
                {COPY.suspendedUntil(member.suspendedUntil ? formatDate(member.suspendedUntil) : "")}
              </Badge>
            )}
            {member.accountStatus === "banned" && <Badge variant="danger">{COPY.banned}</Badge>}
            {isStaffProfile && <Badge variant="neutral">{COPY.staffBadge}</Badge>}
            {member.openReports > 0 && (
              <Badge variant="danger">{COPY.reportsBadge(member.openReports)}</Badge>
            )}
          </div>
        </div>
      </div>

      {!isStaffProfile && (
        <div className="flex flex-wrap gap-2 sm:shrink-0">
          {member.accountStatus === "active" && (
            <>
              <Button variant="outline" size="sm" onClick={() => openDialog({ kind: "suspend", days: 7 })}>
                <Clock size={16} aria-hidden="true" />
                {COPY.suspend7}
              </Button>
              <Button variant="outline" size="sm" onClick={() => openDialog({ kind: "suspend", days: 30 })}>
                <Clock size={16} aria-hidden="true" />
                {COPY.suspend30}
              </Button>
            </>
          )}
          {member.accountStatus !== "active" && (
            <Button variant="secondary" size="sm" onClick={() => openDialog({ kind: "reactivate" })}>
              <ArrowCounterClockwise size={16} aria-hidden="true" />
              {COPY.reactivate}
            </Button>
          )}
          {member.accountStatus !== "banned" && canBan && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => openDialog({ kind: "ban" })}
            >
              <Prohibit size={16} aria-hidden="true" />
              {COPY.ban}
            </Button>
          )}
        </div>
      )}

      <Dialog
        open={pending !== null}
        onClose={closeDialog}
        title={dialogCopy?.title ?? ""}
        description={dialogCopy?.description}
        highRisk
        footer={
          <>
            <Button variant="secondary" onClick={closeDialog} disabled={busy}>
              {COPY.cancel}
            </Button>
            <Button
              variant={pending?.kind === "reactivate" ? "primary" : "danger"}
              loading={busy}
              onClick={confirm}
            >
              {dialogCopy?.confirmLabel ?? ""}
            </Button>
          </>
        }
      >
        {pending && pending.kind !== "reactivate" && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`reason-${member.id}`} className="text-sm font-medium text-foreground">
              {COPY.reasonLabel}
            </label>
            <Textarea
              id={`reason-${member.id}`}
              rows={3}
              maxLength={500}
              placeholder={COPY.reasonPlaceholder}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setReasonError(null);
              }}
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={reasonError ? `reason-${member.id}-error` : undefined}
            />
            {reasonError && (
              <p id={`reason-${member.id}-error`} role="alert" className="text-sm text-danger">
                {reasonError}
              </p>
            )}
          </div>
        )}
      </Dialog>
    </article>
  );
}
