"use client";

import { useState, useTransition } from "react";
import { Check, Plus } from "@phosphor-icons/react/dist/ssr";
import { AUTH_REASON, useRequireAuth } from "@/components/auth/auth-sheet";
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
 * server dice que no.
 * Regla de producto: seguir una entidad hace que sus novedades orgánicas
 * aparezcan en TU feed (lo pagado llega igual a todos, marcado "Publicidad").
 *
 * ── SIN SESIÓN NO SE NAVEGA (cliente 2026-08-20) ────────────────────────────
 * "Mientras menos pasos mejor". Este botón era el peor caso de toda la app: un
 * `router.push("/entrar")` PELADO, sin `next`. La persona tocaba "Seguir" en la
 * tarjeta de una tienda, se comía un toast, aterrizaba en la pantalla de entrar
 * y —una vez adentro— volvía al feed. No a la tienda: al feed. El listado que
 * estaba mirando, su scroll y la entidad que quería seguir se perdían los tres,
 * y para seguirla había que encontrarla de nuevo.
 *
 * Ahora la puerta se abre ENCIMA, sobre la misma pantalla, y al entrar el
 * seguimiento se aplica solo. Este botón aparece en tarjetas de listado, en
 * cabeceras de tienda y en el perfil de un creador: en las tres superficies, no
 * moverse es lo que hace que "seguir" cueste un toque y no una expedición.
 *
 * El reintento entra por `applyFollow` y NO por `handleClick`: el server action
 * deriva quién sigue desde la cookie, así que no hay ningún dato del anónimo que
 * revisar de nuevo — y volver a pasar por el camino de arriba sería empezar el
 * toggle otra vez, con el estado ya movido.
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
  const requireAuth = useRequireAuth();

  /**
   * Abre la hoja de entrada dejando el seguimiento listo para aplicarse solo.
   *
   * El deseo se arma DENTRO de `onAuthenticated` y nunca antes: quien toca
   * "Seguir" sin cuenta y cierra la hoja sin entrar no tiene por qué terminar
   * siguiendo a nadie más tarde, cuando entre por otro motivo.
   */
  function requireFollow(next: boolean) {
    requireAuth({
      reason: AUTH_REASON.follow,
      onAuthenticated: () => applyFollow(next),
    });
  }

  function handleClick() {
    applyFollow(!following);
  }

  /** El camino optimista. Con o sin sesión: el server es el que decide. */
  function applyFollow(next: boolean) {
    setFollowing(next);
    startTransition(async () => {
      const result = await toggleFollowAction({ targetKind, targetId });
      if (!result.ok) {
        // La UI no puede quedarse diciendo que sigue a alguien que no sigue.
        setFollowing(!next);
        if (result.needsAuth) {
          // Sin toast: el título de la hoja ya dice para qué hay que entrar, y
          // decirlo dos veces es un paso más para leer lo mismo.
          requireFollow(next);
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
