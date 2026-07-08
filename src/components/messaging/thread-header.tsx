"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ArrowLeft, DotsThree } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Avatar, BottomSheet, Button, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import {
  ReportScamButton,
  TrustScoreBadge,
  TrustScoreSheet,
  type TrustLevel,
  type TrustSignal,
} from "@/components/trust";
import { reportScamAction } from "@/app/(app)/mensajes/actions";
import { COPY } from "./copy";

export interface ThreadHeaderProps {
  otherProfile: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  };
  trust: {
    score: number;
    level: TrustLevel;
    signals: TrustSignal[];
  } | null;
  listing: {
    title: string;
    href: string | null;
  } | null;
}

/**
 * Header del hilo (§9.2): la otra persona con su Trust Score explicable,
 * el aviso que originó la conversación y el menú "⋯" con Reportar estafa
 * SIEMPRE como primera opción (§3.3 — consistencia posicional).
 */
export function ThreadHeader({ otherProfile, trust, listing }: ThreadHeaderProps) {
  const { toast } = useToast();
  const [trustOpen, setTrustOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [isPending, startTransition] = useTransition();

  const firstName = otherProfile.displayName.split(/\s+/)[0] ?? otherProfile.displayName;

  function submitReport() {
    if (!reason || isPending) return;
    startTransition(async () => {
      const result = await reportScamAction({
        targetKind: "profile",
        targetId: otherProfile.id,
        reason,
        ...(details.trim() ? { details: details.trim() } : {}),
      });
      if (result.ok) {
        setReportOpen(false);
        setReason(null);
        setDetails("");
        toast({
          title: COPY.report.successTitle,
          description: COPY.report.successBody,
          variant: "success",
        });
      } else {
        toast({
          title: COPY.report.errorTitle,
          description: COPY.report.errorBody,
          variant: "danger",
        });
      }
    });
  }

  return (
    <header className="flex items-center gap-3">
      <Link
        href="/mensajes"
        aria-label="Volver a mensajes"
        className="flex size-11 shrink-0 items-center justify-center rounded-full text-foreground-secondary transition-colors hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
      >
        <ArrowLeft size={22} aria-hidden="true" />
      </Link>

      <Avatar src={otherProfile.avatarUrl} name={otherProfile.displayName} size="md" />

      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-base font-semibold text-foreground">
          {otherProfile.displayName}
        </p>
        <div className="flex min-w-0 items-center gap-2">
          {trust && (
            <TrustScoreBadge
              score={trust.score}
              level={trust.level}
              size="inline"
              onClick={() => setTrustOpen(true)}
            />
          )}
          {listing &&
            (listing.href ? (
              <Link
                href={listing.href}
                className="truncate text-xs font-medium text-brand-ink underline-offset-4 hover:underline"
              >
                {COPY.thread.viewListing}: {listing.title}
              </Link>
            ) : (
              <span className="truncate text-xs text-foreground-muted">
                {COPY.inbox.aboutListing(listing.title)}
              </span>
            ))}
        </div>
      </div>

      <button
        type="button"
        aria-label={COPY.thread.moreActions}
        onClick={() => setMenuOpen(true)}
        className="flex size-11 shrink-0 items-center justify-center rounded-full text-foreground-secondary transition-colors hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
      >
        <DotsThree size={26} weight="bold" aria-hidden="true" />
      </button>

      {trust && (
        <TrustScoreSheet
          open={trustOpen}
          onClose={() => setTrustOpen(false)}
          name={firstName}
          score={trust.score}
          level={trust.level}
          signals={trust.signals}
        />
      )}

      {/* Menú "⋯" — Reportar estafa SIEMPRE primera opción (§3.3) */}
      <BottomSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        ariaLabel={COPY.thread.moreActions}
      >
        <div className="-mx-4 pb-2">
          <ReportScamButton
            variant="menu-item"
            onReport={() => {
              setMenuOpen(false);
              setReportOpen(true);
            }}
          />
        </div>
      </BottomSheet>

      {/* Flujo de reporte: motivo + detalles opcionales */}
      <BottomSheet
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title={COPY.report.sheetTitle}
      >
        <p className="text-sm text-foreground-secondary">{COPY.report.intro}</p>

        <fieldset className="mt-4">
          <legend className="text-sm font-semibold text-foreground">
            {COPY.report.reasonLabel}
          </legend>
          {/* Radios NATIVOS (mismo patrón que profile-actions-menu): semántica
              y navegación por flechas gratis — nada de role="radio" a mano. */}
          <div className="mt-2.5 flex flex-col gap-2">
            {COPY.report.reasons.map((option) => {
              const selected = reason === option.value;
              return (
                <label
                  key={option.value}
                  className={cn(
                    "flex min-h-11 w-full cursor-pointer select-none items-center gap-3 rounded-md border px-4 py-2.5 text-left text-sm font-medium",
                    "transition-[background-color,border-color] duration-(--duration-fast)",
                    "focus-within:ring-[3px] focus-within:ring-focus-ring",
                    selected
                      ? "border-brand bg-brand-tint text-brand-ink"
                      : "border-border bg-surface text-foreground hover:bg-surface-subtle",
                  )}
                >
                  <input
                    type="radio"
                    name="thread-report-reason"
                    value={option.value}
                    checked={selected}
                    onChange={() => setReason(option.value)}
                    className="size-4 accent-[var(--color-brand)]"
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-4">
          <label
            htmlFor="report-details"
            className="text-sm font-semibold text-foreground"
          >
            {COPY.report.detailsLabel}
          </label>
          <Textarea
            id="report-details"
            rows={3}
            maxLength={1000}
            value={details}
            placeholder={COPY.report.detailsPlaceholder}
            onChange={(event) => setDetails(event.target.value)}
            className="mt-2"
          />
        </div>

        <Button
          variant="danger"
          className="mb-2 mt-5 w-full"
          disabled={!reason}
          loading={isPending}
          onClick={submitReport}
        >
          {COPY.report.submit}
        </Button>
      </BottomSheet>
    </header>
  );
}
