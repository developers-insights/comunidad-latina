import { FollowButton } from "@/components/social/follow-button";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

export interface FollowRowProps {
  targetId: string;
  followerCount: number;
  isFollowing: boolean;
  className?: string;
}

/**
 * Fila de "Seguir esta entidad" en la cabecera del detalle (0023, feedback
 * cliente 2026-07-19): contador de seguidores + explicación corta + botón.
 * El caller decide si se monta (regla: solo si el listing tiene created_by —
 * una entidad sin cuenta no publica novedades para seguir).
 */
export function FollowRow({ targetId, followerCount, isFollowing, className }: FollowRowProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg bg-surface-subtle p-3.5",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">
          {followerCount > 0 ? COPY.follow.followerCount(followerCount) : COPY.follow.firstFollower}
        </p>
        <p className="mt-0.5 text-xs text-foreground-muted">{COPY.follow.explain}</p>
      </div>
      <FollowButton
        targetKind="listing"
        targetId={targetId}
        initialFollowing={isFollowing}
        size="md"
      />
    </div>
  );
}
