"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { HandsClapping, ShareNetwork } from "@phosphor-icons/react/dist/ssr";
import { Button, buttonVariants, useToast } from "@/components/ui";
import { toggleEventInterestAction } from "@/app/(app)/eventos/actions";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

const C = COPY.events.detail;

export interface EventActionsProps {
  eventId: string;
  eventTitle: string;
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
 */
export function EventActions({
  eventId,
  eventTitle,
  isLoggedIn,
  initialInterested,
  initialCount,
}: EventActionsProps) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [interested, setInterested] = useState(initialInterested);
  const [count, setCount] = useState(initialCount);

  function handleInterest() {
    if (isPending) return;
    startTransition(async () => {
      const result = await toggleEventInterestAction(eventId);
      if (!result.ok) {
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
        {isLoggedIn ? (
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
        ) : (
          <Link
            href={`/entrar?next=${encodeURIComponent(`/eventos/${eventId}`)}`}
            className={cn(buttonVariants({ variant: "primary", size: "lg" }), "flex-1")}
          >
            <HandsClapping size={20} aria-hidden="true" />
            {C.goingCta}
          </Link>
        )}
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
