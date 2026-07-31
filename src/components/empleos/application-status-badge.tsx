import {
  CheckCircle,
  ChatsCircle,
  Eye,
  HourglassMedium,
  Lock,
  MinusCircle,
  XCircle,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { Badge, type BadgeProps } from "@/components/ui";
import type { JobApplicationStatus } from "@/lib/empleos/application-status";
import { COPY } from "./copy";

/**
 * Estado de una postulación, con el MISMO vocabulario en las dos vistas.
 *
 * Cada estado lleva ícono + palabra, nunca solo color (§3.2): quien no
 * distingue el verde del gris tiene que poder leer igual si lo contrataron.
 */
const PRESENTATION: Record<
  JobApplicationStatus,
  { icon: Icon; variant: NonNullable<BadgeProps["variant"]> }
> = {
  submitted: { icon: HourglassMedium, variant: "info" },
  reviewing: { icon: Eye, variant: "info" },
  interview: { icon: ChatsCircle, variant: "warning" },
  hired: { icon: CheckCircle, variant: "success" },
  rejected: { icon: XCircle, variant: "neutral" },
  withdrawn: { icon: MinusCircle, variant: "neutral" },
  closed: { icon: Lock, variant: "neutral" },
};

export function statusLabel(status: JobApplicationStatus): string {
  return COPY.status.label[status];
}

export interface ApplicationStatusBadgeProps {
  status: JobApplicationStatus;
  className?: string;
}

export function ApplicationStatusBadge({ status, className }: ApplicationStatusBadgeProps) {
  const { icon: IconCmp, variant } = PRESENTATION[status];
  return (
    <Badge variant={variant} className={className}>
      <IconCmp size={13} weight="fill" aria-hidden="true" />
      {statusLabel(status)}
    </Badge>
  );
}
