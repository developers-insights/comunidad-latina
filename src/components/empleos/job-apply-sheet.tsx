"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle, PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr";
import {
  BottomSheet,
  Button,
  Field,
  Textarea,
  buttonVariants,
  useToast,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { applyToJobAction } from "@/app/(app)/empleos/actions";
import type { JobAnswer, JobQuestion } from "./helpers";
import { COPY } from "./copy";

const C = COPY.apply;

/** Copy humano por código de la action — nunca el code crudo en pantalla. */
const ERROR_BY_CODE: Record<string, string> = {
  "own-job": C.errors.ownJob,
  "rate-limited": C.errors.rateLimited,
  "tenant-mismatch": C.errors.tenantMismatch,
  invalid: C.errors.invalid,
  error: C.errors.generic,
};

export interface JobApplySheetProps {
  jobId: string;
  /** Preguntas del aviso (attrs.questions). Vacío = postulación de un toque. */
  questions: JobQuestion[];
  /**
   * Sin sesión el mismo CTA lleva a entrar y vuelve al aviso. Abrir la hoja
   * para descubrir al enviar que hace falta cuenta sería trabajo tirado —
   * quien busca trabajo está en datos móviles.
   */
  isLoggedIn: boolean;
}

type AnswerValue = boolean | string;

/**
 * Postularse a un empleo: CTA sticky + hoja con las preguntas del aviso.
 *
 * Las preguntas son OBLIGATORIAS (la misma regla que valida el server en
 * validateJobAnswers): validamos en el cliente primero para no gastarle un
 * viaje a alguien que está en datos móviles, pero el server vuelve a validar
 * — el cliente no es una fuente de verdad.
 *
 * El éxito NO cierra la hoja de golpe: muestra la confirmación adentro (misma
 * mecánica que ApplySheet de creadores) y recién al cerrar refresca la página,
 * que ahora renderiza la tarjeta de estado en lugar del CTA.
 */
export function JobApplySheet({ jobId, questions, isLoggedIn }: JobApplySheetProps) {
  const router = useRouter();
  const { toast } = useToast();
  const groupId = useId();
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setAnswer(questionId: string, value: AnswerValue) {
    setAnswers((current) => ({ ...current, [questionId]: value }));
    setError(null);
  }

  function close() {
    if (submitting) return;
    setOpen(false);
    // Al cerrar después de enviar, la página vuelve a leer el estado y pinta la
    // tarjeta "Ya te postulaste" en lugar del CTA.
    if (done) router.refresh();
  }

  async function handleSubmit() {
    const missing = questions.some((question) => answers[question.id] === undefined);
    if (missing) {
      setError(C.errors.unanswered);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const payload: JobAnswer[] = questions.map((question) => ({
        questionId: question.id,
        answer: answers[question.id] as AnswerValue,
      }));

      const result = await applyToJobAction({
        jobId,
        message: message.trim() ? message.trim() : null,
        answers: payload,
      });

      if (!result.ok) {
        if (result.code === "unauthenticated") {
          router.push(`/entrar?next=${encodeURIComponent(`/empleos/${jobId}`)}`);
          return;
        }
        setError(result.message ?? ERROR_BY_CODE[result.code] ?? C.errors.generic);
        return;
      }

      setDone(true);
      toast({ variant: "success", title: C.successTitle });
    } catch {
      setError(C.errors.generic);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {/* CTA sticky: la acción principal del aviso vive siempre a mano, por
          encima del bottom nav (mismo anclaje que EventActions). */}
      <div
        className={cn(
          "fixed inset-x-0 z-30",
          "bottom-[calc(3.5rem+env(safe-area-inset-bottom))]",
          "bg-gradient-to-t from-canvas via-canvas/95 to-transparent pb-3 pt-6",
        )}
      >
        <div className="mx-auto w-full max-w-lg px-4">
          {isLoggedIn ? (
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={() => setOpen(true)}
            >
              <PaperPlaneTilt size={20} weight="fill" aria-hidden="true" />
              {C.cta}
            </Button>
          ) : (
            <Link
              href={`/entrar?next=${encodeURIComponent(`/empleos/${jobId}`)}`}
              className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full")}
            >
              <PaperPlaneTilt size={20} weight="fill" aria-hidden="true" />
              {C.ctaLoggedOut}
            </Link>
          )}
        </div>
      </div>

      <BottomSheet
        open={open}
        onClose={close}
        title={done ? undefined : C.sheetTitle}
        ariaLabel={C.sheetTitle}
      >
        {done ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle size={52} weight="fill" aria-hidden="true" className="text-success" />
            <h3 className="font-display text-lg font-bold text-foreground">{C.successTitle}</h3>
            <p className="max-w-[40ch] text-sm text-foreground-secondary">{C.successBody}</p>
            <Button variant="primary" className="mt-2 w-full" onClick={close}>
              {C.successClose}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-5 pb-2">
            <p className="text-sm text-foreground-secondary">{C.intro}</p>

            {questions.map((question, index) => {
              const labelId = `${groupId}-q${index}`;
              const value = answers[question.id];
              return (
                <div key={question.id} className="flex flex-col gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
                    {C.questionCounter(index + 1, questions.length)}
                  </p>
                  <p id={labelId} className="font-semibold text-foreground">
                    {question.label}
                  </p>

                  {question.type === "yes_no" ? (
                    <div role="group" aria-labelledby={labelId} className="flex gap-2">
                      <OptionButton
                        fill
                        selected={value === true}
                        onClick={() => setAnswer(question.id, true)}
                      >
                        {C.yes}
                      </OptionButton>
                      <OptionButton
                        fill
                        selected={value === false}
                        onClick={() => setAnswer(question.id, false)}
                      >
                        {C.no}
                      </OptionButton>
                    </div>
                  ) : (
                    <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-2">
                      {/* key con índice: dos opciones pueden tener el mismo texto. */}
                      {(question.options ?? []).map((option, index) => (
                        <OptionButton
                          key={`${index}-${option}`}
                          selected={value === option}
                          onClick={() => setAnswer(question.id, option)}
                        >
                          {option}
                        </OptionButton>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            <Field
              htmlFor="job-apply-message"
              label={C.messageLabel}
              help={C.messageHelp}
              optional
            >
              <Textarea
                id="job-apply-message"
                rows={4}
                value={message}
                maxLength={800}
                placeholder={C.messagePlaceholder}
                onChange={(event) => setMessage(event.target.value)}
              />
            </Field>

            {error && (
              <p role="alert" className="text-sm font-medium text-danger">
                {error}
              </p>
            )}

            <Button
              variant="primary"
              size="lg"
              className="w-full"
              loading={submitting}
              onClick={handleSubmit}
            >
              {submitting ? C.submitting : C.submit}
            </Button>
          </div>
        )}
      </BottomSheet>
    </>
  );
}

/**
 * Opción de respuesta: píldora táctil (≥44px) con el acento del módulo cuando
 * está elegida. `aria-pressed` en vez de radios nativos porque el grupo ya
 * nombra la pregunta y así la respuesta se lee como lo que es: un toque.
 */
function OptionButton({
  selected,
  onClick,
  children,
  fill = false,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** Sí/No parten la fila al medio; las opciones múltiples se miden por su texto. */
  fill?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      style={
        selected
          ? {
              borderColor: "color-mix(in oklab, var(--accent-empleos) 55%, transparent)",
              backgroundColor: "color-mix(in oklab, var(--accent-empleos) 14%, transparent)",
            }
          : undefined
      }
      className={cn(
        "min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold",
        fill && "flex-1",
        "transition-[background-color,border-color,transform] duration-(--duration-fast) ease-(--ease-spring)",
        "active:scale-[0.96] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        selected ? "text-foreground" : "border-border bg-surface text-foreground-secondary",
      )}
    >
      {children}
    </button>
  );
}
