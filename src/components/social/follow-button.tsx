"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus } from "@phosphor-icons/react/dist/ssr";
import { Button, useToast, type ButtonProps } from "@/components/ui";
import { toggleFollowAction } from "@/app/(app)/social/actions";
import { cn } from "@/lib/utils";

export interface FollowButtonProps {
  targetKind: "listing" | "profile";
  targetId: string;
  /** Resuelto en el server (¿ya lo sigue quien mira?). */
  initialFollowing: boolean;
  /** Copy por contexto: "Seguir" (default), "Seguir tienda", "Seguir evento"… */
  labelFollow?: string;
  labelFollowing?: string;
  size?: ButtonProps["size"];
  className?: string;
}

/**
 * Botón Seguir/Siguiendo (0023). Optimista: cambia al toque y revierte si el
 * server dice que no. Sin sesión → invita a entrar (needsAuth del action).
 * Regla de producto: seguir una entidad hace que sus novedades orgánicas
 * aparezcan en TU feed (lo pagado llega igual a todos, marcado "Publicidad").
 */
export function FollowButton({
  targetKind,
  targetId,
  initialFollowing,
  labelFollow = "Seguir",
  labelFollowing = "Siguiendo",
  size = "sm",
  className,
}: FollowButtonProps) {
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  function handleClick() {
    const previous = following;
    setFollowing(!previous);
    startTransition(async () => {
      const result = await toggleFollowAction({ targetKind, targetId });
      if (!result.ok) {
        setFollowing(previous);
        if (result.needsAuth) {
          toast({ variant: "info", title: result.error });
          router.push("/entrar");
          return;
        }
        toast({ variant: "danger", title: result.error });
        return;
      }
      setFollowing(result.following);
    });
  }

  return (
    <Button
      type="button"
      variant={following ? "secondary" : "primary"}
      size={size}
      onClick={handleClick}
      disabled={pending}
      aria-pressed={following}
      className={cn("shrink-0", className)}
    >
      {following ? (
        <Check size={16} weight="bold" aria-hidden="true" />
      ) : (
        <Plus size={16} weight="bold" aria-hidden="true" />
      )}
      {following ? labelFollowing : labelFollow}
    </Button>
  );
}
