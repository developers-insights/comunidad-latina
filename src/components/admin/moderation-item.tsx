"use client";

import { useActionState } from "react";
import { Check, X } from "@phosphor-icons/react/dist/ssr";
import { Badge } from "@/components/ui";
import {
  resolveModerationItem,
  type ResolveModerationState,
} from "@/app/admin/moderacion/actions";
import { ScoreBar } from "./score-bar";
import { PendingButton } from "./pending-button";

/**
 * Tarjeta de un caso de la cola de moderación: qué es, extracto, puntaje de
 * IA con barra, razones, y Aprobar/Rechazar. Densa pero legible (§1.1.④).
 */

export interface ModerationItemData {
  id: string;
  subjectKind: string;
  subjectId: string;
  tier: number;
  aiScore: number | null;
  reasons: string[];
  createdAt: string;
  /** Extracto del contenido resuelto server-side (o null si no se pudo leer). */
  excerpt: string | null;
}

const COPY = {
  approve: "Aprobar",
  reject: "Rechazar",
  noExcerpt: "No pudimos traer el contenido — revisalo desde su enlace antes de decidir.",
  tier: (tier: number) => `Nivel ${tier}`,
  kindLabel: {
    post: "Publicación",
    comment: "Comentario",
    listing: "Aviso",
    message: "Mensaje",
    profile: "Perfil",
    photo: "Foto de aviso",
  } as Record<string, string>,
} as const;

const KIND_VARIANT: Record<string, "info" | "brand" | "warning" | "neutral"> = {
  post: "info",
  comment: "info",
  listing: "brand",
  photo: "brand",
  message: "warning",
  profile: "neutral",
};

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

const initialState: ResolveModerationState = { status: "idle" };

export function ModerationItem({ item }: { item: ModerationItemData }) {
  const [state, formAction] = useActionState(resolveModerationItem, initialState);

  return (
    <article className="rounded-lg border border-border bg-surface p-4 shadow-xs">
      <header className="flex flex-wrap items-center gap-2">
        <Badge variant={KIND_VARIANT[item.subjectKind] ?? "neutral"}>
          {COPY.kindLabel[item.subjectKind] ?? item.subjectKind}
        </Badge>
        <Badge variant={item.tier >= 3 ? "danger" : "neutral"}>{COPY.tier(item.tier)}</Badge>
        <span className="ml-auto text-xs tabular-nums text-foreground-muted">
          {formatWhen(item.createdAt)}
        </span>
      </header>

      <div className="mt-3">
        <ScoreBar score={item.aiScore} />
      </div>

      {item.reasons.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Motivos">
          {item.reasons.map((reason) => (
            <li
              key={reason}
              className="rounded-full bg-surface-subtle px-2 py-0.5 text-xs text-foreground-secondary"
            >
              {reason}
            </li>
          ))}
        </ul>
      )}

      <blockquote className="mt-3 rounded-md bg-surface-subtle px-3 py-2.5 text-sm text-foreground">
        {item.excerpt ? (
          <p className="line-clamp-4 whitespace-pre-line break-words">{item.excerpt}</p>
        ) : (
          <p className="italic text-foreground-muted">{COPY.noExcerpt}</p>
        )}
      </blockquote>

      {state.status === "error" && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {state.message}
        </p>
      )}

      <form action={formAction} className="mt-4 flex justify-end gap-2">
        <input type="hidden" name="itemId" value={item.id} />
        <PendingButton
          variant="outline"
          size="sm"
          name="decision"
          value="reject"
          type="submit"
          className="border-danger/40 text-danger hover:bg-danger-bg"
        >
          <X size={16} aria-hidden="true" />
          {COPY.reject}
        </PendingButton>
        <PendingButton variant="secondary" size="sm" name="decision" value="approve" type="submit">
          <Check size={16} aria-hidden="true" />
          {COPY.approve}
        </PendingButton>
      </form>
    </article>
  );
}
