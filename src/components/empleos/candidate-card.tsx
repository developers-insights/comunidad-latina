"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookmarkSimple,
  ChatCircleDots,
  CheckCircle,
  ChatsCircle,
  Eye,
  LinkSimple,
  Lock,
  MapPin,
  UserCircle,
  UserMinus,
  XCircle,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { Avatar, Button, Dialog, useToast } from "@/components/ui";
import { PublisherTrust, firstNameOf, toTrustLevel } from "@/components/listings";
import type { TrustSignal } from "@/components/trust";
import { cn } from "@/lib/utils";
import { portfolioLinkLabel } from "@/lib/empleos/cv";
import {
  employerTransitions,
  type EmployerStatus,
  type JobApplicationStatus,
} from "@/lib/empleos/application-status";
import {
  advanceJobApplicationAction,
  removeSavedCandidateAction,
  saveCandidateAction,
  startCandidateConversationAction,
} from "@/app/(app)/empleos/actions";
import type { JobCandidateView } from "@/app/(app)/empleos/queries";
import { ApplicationStatusBadge, statusLabel } from "./application-status-badge";
import { CandidateNote } from "./candidate-note";
import { CvDownloadButton } from "./cv-download-button";
import { COPY } from "./copy";

const C = COPY.candidates;

/** Cada paso del embudo con su verbo, su ícono y si necesita confirmación. */
const ACTION: Record<
  EmployerStatus,
  { label: string; icon: Icon; tone: "primary" | "outline" | "ghost"; confirm: boolean }
> = {
  reviewing: { label: C.advance.reviewing, icon: Eye, tone: "outline", confirm: false },
  interview: { label: C.advance.interview, icon: ChatsCircle, tone: "primary", confirm: false },
  hired: { label: C.advance.hired, icon: CheckCircle, tone: "primary", confirm: true },
  rejected: { label: C.advance.rejected, icon: XCircle, tone: "ghost", confirm: true },
  closed: { label: C.advance.closed, icon: Lock, tone: "ghost", confirm: true },
};

export interface CandidateCardProps {
  candidate: JobCandidateView;
  /** Desglose del Trust Score, armado en el server con la gramática canónica. */
  trustSignals: TrustSignal[];
}

/**
 * Una candidatura, en la vista de quien publicó el aviso.
 *
 * ── LAS TRES REGLAS QUE ESTA TARJETA RESPETA ───────────────────────────────
 *
 * 1. El consentimiento del perfil. Si la persona eligió no compartirlo, no hay
 *    foto, ni nombre, ni "Ver perfil" — y su id ni siquiera llegó al navegador
 *    (`fetchJobCandidates` lo deja en null). Lo que SÍ se ve es todo lo que
 *    envió a propósito: respuestas, mensaje, currículum, enlaces.
 *
 * 2. El embudo solo avanza. Los botones salen de `employerTransitions()`, la
 *    misma función que espeja el trigger de la base: nunca se ofrece algo que
 *    Postgres vaya a rechazar. Las decisiones sin vuelta atrás (contratar, no
 *    seleccionar, cerrar la vacante) piden confirmación, porque efectivamente
 *    no la tienen.
 *
 * 3. La nota es privada. Vive en otra tabla, con otra policy, y el candidato no
 *    es sujeto de ninguna — ver candidate-note.tsx.
 *
 * El avance NO es optimista: el estado es una decisión laboral que dispara una
 * notificación a una persona real. Preferimos medio segundo de spinner antes
 * que pintar "Contratado" y tener que retirarlo.
 */
export function CandidateCard({ candidate, trustSignals }: CandidateCardProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [status, setStatus] = useState<JobApplicationStatus>(candidate.status);
  const [pendingAction, setPendingAction] = useState<EmployerStatus | null>(null);
  const [confirming, setConfirming] = useState<EmployerStatus | null>(null);
  const [saved, setSaved] = useState(candidate.saved);
  const [savePending, setSavePending] = useState(false);
  const [messagePending, setMessagePending] = useState(false);

  const transitions = employerTransitions(status);
  const profile = candidate.profile;
  const displayName = profile?.displayName ?? C.anonymousName;

  async function advance(next: EmployerStatus) {
    setPendingAction(next);
    try {
      const result = await advanceJobApplicationAction({
        applicationId: candidate.id,
        next,
      });
      if (!result.ok) {
        toast({
          variant: "danger",
          title: result.code === "conflict" ? C.advanceConflict : (result.message ?? C.advanceError),
        });
        if (result.code === "conflict") router.refresh();
        return;
      }
      setStatus(result.status);
      setConfirming(null);
      toast({ variant: "success", title: C.advanceDone(statusLabel(result.status)) });
      router.refresh();
    } catch {
      toast({ variant: "danger", title: C.advanceError });
    } finally {
      setPendingAction(null);
    }
  }

  async function toggleSave() {
    setSavePending(true);
    const next = !saved;
    try {
      const result = next
        ? await saveCandidateAction({ applicationId: candidate.id })
        : await removeSavedCandidateAction({ applicationId: candidate.id });
      if (!result.ok) {
        toast({ variant: "danger", title: result.message ?? C.saveError });
        return;
      }
      setSaved(result.saved);
      toast({ variant: "success", title: result.saved ? C.savedToast : C.unsavedToast });
    } catch {
      toast({ variant: "danger", title: C.saveError });
    } finally {
      setSavePending(false);
    }
  }

  async function message() {
    setMessagePending(true);
    try {
      const result = await startCandidateConversationAction({ applicationId: candidate.id });
      if (!result.ok) {
        toast({ variant: "danger", title: result.message ?? C.advanceError });
        return;
      }
      router.push(`/mensajes/${result.conversationId}`);
    } catch {
      toast({ variant: "danger", title: C.advanceError });
    } finally {
      setMessagePending(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4">
      {/* ---- Identidad + estado ------------------------------------------- */}
      <div className="flex items-start gap-3">
        {profile ? (
          <Avatar size="md" src={profile.avatarUrl} name={profile.displayName} />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-foreground-muted"
          >
            <UserCircle size={24} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p
              className={cn(
                "truncate font-semibold",
                profile ? "text-foreground" : "text-foreground-secondary",
              )}
            >
              {displayName}
            </p>
            <ApplicationStatusBadge status={status} className="shrink-0" />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="text-xs text-foreground-muted">{candidate.createdAtLabel}</span>
            {profile && (
              <span className="flex items-center gap-1 text-xs text-foreground-muted">
                <MapPin size={12} aria-hidden="true" />
                {profile.areaLabel ?? C.noCity}
              </span>
            )}
            {profile?.trust && (
              <PublisherTrust
                displayName={profile.displayName}
                firstName={firstNameOf(profile.displayName)}
                score={profile.trust.score}
                level={toTrustLevel(profile.trust.level)}
                signals={trustSignals}
                // Regla 1 de esta tarjeta: sin consentimiento el id ya vino
                // null desde el server (`fetchJobCandidates`), así que esto se
                // apaga solo — no hace falta un segundo candado acá.
                profileId={candidate.applicantId}
                size="inline"
              />
            )}
          </div>
          {!profile && (
            <p className="mt-1 text-xs text-foreground-muted">{C.anonymousHint}</p>
          )}
        </div>
      </div>

      {/* ---- Lo que envió -------------------------------------------------- */}
      {candidate.message && (
        <div>
          <h4 className="mb-1 text-xs font-semibold text-foreground-secondary">
            {C.messageTitle}
          </h4>
          <p className="whitespace-pre-line rounded-md bg-surface-subtle px-3 py-2.5 text-sm text-foreground-secondary">
            {candidate.message}
          </p>
        </div>
      )}

      {candidate.answers.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-xs font-semibold text-foreground-secondary">
            {C.answersTitle}
          </h4>
          {/* Pregunta → respuesta como lista de definición: es exactamente eso,
              y así el lector de pantalla las lee apareadas. */}
          <dl className="flex flex-col gap-2">
            {/* key con índice: dos preguntas pueden tener el MISMO texto. */}
            {candidate.answers.map((answer, index) => (
              <div key={`${index}-${answer.question}`} className="flex flex-col gap-0.5">
                <dt className="text-sm text-foreground-muted">{answer.question}</dt>
                <dd className="text-sm font-semibold text-foreground">{answer.answer}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div>
        <h4 className="mb-1.5 text-xs font-semibold text-foreground-secondary">{C.cvTitle}</h4>
        {candidate.hasCv ? (
          <CvDownloadButton applicationId={candidate.id} />
        ) : (
          <p className="text-sm text-foreground-muted">{C.cvNone}</p>
        )}
      </div>

      {candidate.portfolioLinks.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-xs font-semibold text-foreground-secondary">
            {C.portfolioTitle}
          </h4>
          <ul className="flex flex-col gap-1">
            {candidate.portfolioLinks.map((link, index) => (
              <li key={`${index}-${link}`}>
                {/* rel completo: el enlace lo escribió un tercero. */}
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer nofollow ugc"
                  className={cn(
                    "flex min-h-11 items-center gap-1.5 text-sm text-brand underline underline-offset-2",
                    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                  )}
                >
                  <LinkSimple size={15} aria-hidden="true" className="shrink-0" />
                  <span className="truncate">{portfolioLinkLabel(link)}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- Nota privada -------------------------------------------------- */}
      <CandidateNote applicationId={candidate.id} initialNote={candidate.note} />

      {/* ---- Acciones sobre la persona ------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
        {candidate.applicantId && (
          <Link
            href={`/perfil/${candidate.applicantId}`}
            className={cn(
              "inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-foreground-secondary",
              "hover:bg-surface-subtle hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            )}
          >
            <UserCircle size={16} aria-hidden="true" />
            {C.viewProfile}
          </Link>
        )}
        {/* Mismo gate que "Ver perfil", y por la misma razón: abrir el chat
            muestra nombre, foto y verificación de la persona en el encabezado
            del hilo. Ofrecerlo acá deshacía en un toque lo que esta tarjeta
            oculta a propósito. La acción del servidor también lo rechaza —esto
            es para no ofrecer lo que va a fallar, no la barrera. */}
        {candidate.applicantId && (
          <Button variant="ghost" size="sm" loading={messagePending} onClick={message}>
            <ChatCircleDots size={16} aria-hidden="true" />
            {C.sendMessage}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          loading={savePending}
          aria-pressed={saved}
          onClick={toggleSave}
        >
          <BookmarkSimple
            size={16}
            weight={saved ? "fill" : "regular"}
            aria-hidden="true"
            className={saved ? "text-brand" : undefined}
          />
          {saved ? C.saved : C.save}
        </Button>
      </div>

      {/* ---- Avanzar el embudo --------------------------------------------- */}
      {transitions.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap justify-end gap-2">
            {transitions.map((next) => {
              const { label, icon: IconCmp, tone, confirm } = ACTION[next];
              return (
                <Button
                  key={next}
                  variant={tone === "primary" ? "primary" : tone === "outline" ? "outline" : "ghost"}
                  size="sm"
                  loading={pendingAction === next}
                  disabled={pendingAction !== null}
                  onClick={() => (confirm ? setConfirming(next) : advance(next))}
                >
                  <IconCmp size={15} aria-hidden="true" />
                  {label}
                </Button>
              );
            })}
          </div>
          <p className="text-right text-xs text-foreground-muted">{C.advanceHint}</p>
        </div>
      ) : status === "hired" ? (
        <p className="text-sm text-foreground-secondary">{C.hiredNote}</p>
      ) : null}

      <Dialog
        open={confirming !== null}
        onClose={() => pendingAction === null && setConfirming(null)}
        title={confirming ? C.confirmTitle(statusLabel(confirming)) : ""}
        description={C.confirmBody}
        highRisk
        footer={
          <>
            <Button
              variant="ghost"
              disabled={pendingAction !== null}
              onClick={() => setConfirming(null)}
            >
              {C.confirmCancel}
            </Button>
            <Button
              variant={confirming === "hired" ? "primary" : "danger"}
              loading={pendingAction !== null}
              onClick={() => confirming && advance(confirming)}
            >
              {C.confirmCta}
            </Button>
          </>
        }
      />
    </li>
  );
}

/** Ícono para el estado vacío del filtro "sin responder". */
export const CandidateEmptyIcon = UserMinus;
