"use client";

import { useState, useTransition } from "react";
import { HandsClapping, ShareNetwork } from "@phosphor-icons/react/dist/ssr";
import { AUTH_REASON, useRequireAuth } from "@/components/auth/auth-sheet";
import { Button, useToast } from "@/components/ui";
import { toggleEventInterestAction } from "@/app/(app)/eventos/actions";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

const C = COPY.events.detail;

export interface EventActionsProps {
  eventId: string;
  eventTitle: string;
  /**
   * ¿Había sesión al pintar? No cambia el botón —es el mismo para todos— sino
   * si el primer toque abre la puerta antes de anotar.
   */
  isLoggedIn: boolean;
  /** ¿La persona ya está anotada? (reaction like existente) */
  initialInterested: boolean;
  /** Interesados al momento del render del server. */
  initialCount: number;
}

/**
 * CTA sticky del detalle de evento: "Quiero ir" (reaction like sobre el
 * listing, con contador de interesados) + compartir (share nativo con
 * fallback a copiar link).
 *
 * ── ANOTARSE NO SACA DE LA PANTALLA (cliente 2026-08-20) ────────────────────
 * "Mientras menos pasos mejor". Sin sesión, "Quiero ir" era un enlace a /entrar:
 * la persona perdía la pantalla del evento —la fecha, el lugar, el mapa que
 * estaba leyendo— y volvía a ella recién después de entrar, para recién ahí
 * tocar de nuevo el mismo botón. Dos toques y dos pantallas para un "voy".
 *
 * Ahora el botón es UNO SOLO para todos: se toca, y si hace falta cuenta la
 * puerta se abre encima del evento. Al entrar, la anotación se aplica sola y el
 * contador de interesados se mueve sin que la persona haya tocado nada más.
 */
export function EventActions({
  eventId,
  eventTitle,
  isLoggedIn,
  initialInterested,
  initialCount,
}: EventActionsProps) {
  const { toast } = useToast();
  const requireAuth = useRequireAuth();
  const [isPending, startTransition] = useTransition();
  const [interested, setInterested] = useState(initialInterested);
  const [count, setCount] = useState(initialCount);

  /**
   * Abre la puerta con la anotación lista para aplicarse al entrar.
   *
   * Se arma DENTRO de `onAuthenticated`: quien mira un evento sin cuenta, toca
   * "Quiero ir" y se arrepiente no puede terminar anotado más tarde, cuando
   * entre por cualquier otro motivo.
   */
  function requireInterest() {
    requireAuth({
      reason: AUTH_REASON.interest,
      onAuthenticated: () => applyInterest(),
    });
  }

  function handleInterest() {
    if (isPending) return;
    if (!isLoggedIn) {
      requireInterest();
      return;
    }
    applyInterest();
  }

  /**
   * El camino con sesión. El reintento post-entrada llega DIRECTO acá y no por
   * `handleInterest`: `isLoggedIn` viene del servidor y en el closure de antes
   * de entrar sigue diciendo `false`, así que pasar de nuevo por ese guard
   * reabriría la hoja que la persona acaba de cerrar, en bucle. El server
   * action deriva quién se anota desde la cookie, que ya está escrita.
   */
  function applyInterest() {
    startTransition(async () => {
      const result = await toggleEventInterestAction(eventId);
      if (!result.ok) {
        if (result.needsAuth) {
          requireInterest();
          return;
        }
        toast({
          title: C.goingErrorTitle,
          description: result.error ?? C.goingErrorBody,
          variant: "warning",
        });
        return;
      }
      setInterested(result.interested);
      setCount((value) => Math.max(0, value + (result.interested ? 1 : -1)));
    });
  }

  async function handleShare() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: eventTitle, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast({ title: C.shareCopiedTitle, description: C.shareCopiedBody, variant: "success" });
    } catch {
      // La persona canceló el share nativo — no es un error.
    }
  }

  return (
    <div
      className={cn(
        "fixed inset-x-0 z-30",
        "bottom-[calc(3.5rem+env(safe-area-inset-bottom))]",
        "bg-gradient-to-t from-canvas via-canvas/95 to-transparent pb-3 pt-6",
      )}
    >
      <div className="mx-auto flex w-full max-w-lg items-center gap-2 px-4">
        <Button
          variant={interested ? "secondary" : "primary"}
          size="lg"
          className="flex-1"
          loading={isPending}
          aria-pressed={interested}
          onClick={handleInterest}
        >
          <HandsClapping size={20} weight={interested ? "fill" : "regular"} aria-hidden="true" />
          {interested ? C.goingActive : C.goingCta}
        </Button>
        <Button variant="outline" size="lg" onClick={handleShare} aria-label={C.shareCta}>
          <ShareNetwork size={20} aria-hidden="true" />
          {C.shareCta}
        </Button>
      </div>
      <p className="numeric mt-1.5 text-center text-xs text-foreground-muted">
        {C.interestedCount(count)}
      </p>
    </div>
  );
}
