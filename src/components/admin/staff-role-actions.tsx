"use client";

import { useActionState, useState, useTransition } from "react";
import { Avatar, Badge, Button, Dialog } from "@/components/ui";
import {
  assignStaffRole,
  type StaffActionState,
} from "@/app/admin/global/administradores/actions";
import {
  ROLE_COPY,
  type AssignableRole,
} from "@/app/admin/global/administradores/staff-roles";

/**
 * Fila de una persona con los botones que le cambian el rol.
 *
 * Cada cambio pasa por un diálogo que dice QUÉ VA A PODER HACER esa persona, no
 * un "¿Estás seguro?". Dar administración de una comunidad es entregar el panel
 * entero de esa comunidad; quien lo hace tiene que leer el alcance antes.
 *
 * Los botones que no corresponden no se renderizan, pero eso es cortesía: la
 * server action revalida rol, comunidad y destinatario contra la base en cada
 * llamada (ver administradores/actions.ts).
 */

const COPY = {
  cancel: "Cancelar",
  joined: (label: string) => `Se sumó el ${label}`,
  superAdmin: "Equipo de la plataforma",
  superAdminNote: "Sus permisos no se cambian desde acá.",
} as const;

const initialState: StaffActionState = { status: "idle" };

export interface StaffPersonRow {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  /** `profiles.role` — la copia informativa del claim del JWT. */
  role: string;
  joinedLabel: string;
}

export function StaffRoleActions({
  person,
  tenantId,
  /** Roles que se ofrecen para esta fila (ya sin el que ya tiene). */
  offer,
}: {
  person: StaffPersonRow;
  tenantId: string;
  offer: AssignableRole[];
}) {
  const [state, formAction, pending] = useActionState(assignStaffRole, initialState);
  const [, startTransition] = useTransition();
  const [dialog, setDialog] = useState<AssignableRole | null>(null);

  // Cierre del diálogo al volver la action — ajuste de estado en render.
  const [prev, setPrev] = useState<StaffActionState>(state);
  if (state !== prev) {
    setPrev(state);
    if (state.status !== "idle") setDialog(null);
  }

  const isSuperAdmin = person.role === "global_admin";

  const submit = (role: AssignableRole) => {
    const fd = new FormData();
    fd.set("profileId", person.id);
    fd.set("tenantId", tenantId);
    fd.set("role", role);
    startTransition(() => formAction(fd));
  };

  const currentBadge =
    person.role === "global_admin"
      ? { variant: "brand" as const, label: COPY.superAdmin }
      : person.role === "domain_admin"
        ? { variant: ROLE_COPY.domain_admin.badge, label: ROLE_COPY.domain_admin.label }
        : person.role === "moderator"
          ? { variant: ROLE_COPY.moderator.badge, label: ROLE_COPY.moderator.label }
          : { variant: ROLE_COPY.member.badge, label: ROLE_COPY.member.label };

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-xs">
      <div className="flex items-center gap-3">
        <Avatar src={person.avatarUrl} name={person.displayName} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{person.displayName}</p>
          <p className="text-xs text-foreground-muted">{COPY.joined(person.joinedLabel)}</p>
        </div>
        <Badge variant={currentBadge.variant}>{currentBadge.label}</Badge>
      </div>

      {isSuperAdmin ? (
        <p className="text-xs text-foreground-muted">{COPY.superAdminNote}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {offer.map((role) => (
            <Button
              key={role}
              variant={role === "member" ? "ghost" : "secondary"}
              size="sm"
              onClick={() => setDialog(role)}
              loading={pending && dialog === role}
            >
              {role === "member" ? "Quitar permisos" : `Hacer que ${ROLE_COPY[role].label.toLowerCase()}`}
            </Button>
          ))}
        </div>
      )}

      {state.status !== "idle" && (
        <p
          role={state.status === "success" ? "status" : "alert"}
          className={state.status === "success" ? "text-xs text-success" : "text-xs text-danger"}
        >
          {state.message}
        </p>
      )}

      {offer.map((role) => (
        <Dialog
          key={role}
          open={dialog === role}
          onClose={() => setDialog(null)}
          title={ROLE_COPY[role].confirmTitle}
          description={person.displayName}
          highRisk={role === "domain_admin"}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialog(null)} disabled={pending}>
                {COPY.cancel}
              </Button>
              <Button variant="primary" loading={pending} onClick={() => submit(role)}>
                {ROLE_COPY[role].confirmLabel}
              </Button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-foreground-secondary">
            {ROLE_COPY[role].summary}
          </p>
        </Dialog>
      ))}
    </li>
  );
}
