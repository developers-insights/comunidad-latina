"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle,
  FilePdf,
  LinkSimple,
  PaperPlaneTilt,
} from "@phosphor-icons/react/dist/ssr";
import {
  BottomSheet,
  Button,
  Field,
  Textarea,
  buttonVariants,
  useToast,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { normalizePortfolioLinks, portfolioLinkLabel } from "@/lib/empleos/cv";
import { applyToJobAction } from "@/app/(app)/empleos/actions";
import type { ApplicantProfilePreview } from "@/app/(app)/empleos/queries";
import { ApplicantProfileCard } from "./applicant-profile-card";
import { CvUploadField, type AttachedCv } from "./cv-upload-field";
import { PortfolioLinksField } from "./portfolio-links-field";
import type { JobAnswer, JobQuestion } from "./helpers";
import { COPY } from "./copy";

const C = COPY.apply;

/** Copy humano por código de la action — nunca el code crudo en pantalla. */
const ERROR_BY_CODE: Record<string, string> = {
  "own-job": C.errors.ownJob,
  "rate-limited": C.errors.rateLimited,
  "tenant-mismatch": C.errors.tenantMismatch,
  invalid: C.errors.invalid,
  cv: C.errors.cv,
  portfolio: C.errors.portfolio,
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
  /** Autocompletado: lo que quien contrata va a ver si comparte su perfil. */
  profile: ApplicantProfilePreview | null;
}

type AnswerValue = boolean | string;
type Panel = "form" | "review" | "done";

/**
 * Postularse a un empleo: CTA sticky + hoja con TODO lo que la spec pide —
 * perfil autocompletado (con su interruptor), preguntas del aviso, mensaje,
 * currículum adjunto y enlaces de portafolio.
 *
 * ── POR QUÉ HAY UN PASO DE REVISIÓN ────────────────────────────────────────
 * Porque compartir el perfil es un consentimiento, y un consentimiento que no
 * muestra qué se está entregando no es tal. El paso "Esto es lo que va a
 * recibir" arma el paquete completo —perfil, respuestas, mensaje, currículum,
 * enlaces— y recién ahí aparece "Enviar". Es también la última chance de
 * corregir: una vez enviada, la base CONGELA respuestas, mensaje, currículum y
 * enlaces (trigger de 0047). No hay "editar" después, así que hay "revisar"
 * antes.
 *
 * Las preguntas son OBLIGATORIAS (misma regla que valida el server en
 * validateJobAnswers): se chequea en el cliente para no gastarle un viaje a
 * alguien en datos móviles, y el server vuelve a validar igual.
 */
export function JobApplySheet({ jobId, questions, isLoggedIn, profile }: JobApplySheetProps) {
  const router = useRouter();
  const { toast } = useToast();
  const groupId = useId();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>("form");
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [message, setMessage] = useState("");
  const [cv, setCv] = useState<AttachedCv | null>(null);
  const [links, setLinks] = useState<string[]>([]);
  const [shareProfile, setShareProfile] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linksError, setLinksError] = useState<string | null>(null);

  const loginHref = `/entrar?next=${encodeURIComponent(`/empleos/${jobId}`)}`;

  function setAnswer(questionId: string, value: AnswerValue) {
    setAnswers((current) => ({ ...current, [questionId]: value }));
    setError(null);
  }

  function close() {
    if (submitting) return;
    setOpen(false);
    // Al cerrar después de enviar, la página vuelve a leer el estado y pinta la
    // tarjeta "Ya te postulaste" en lugar del CTA.
    if (panel === "done") router.refresh();
  }

  const cleanLinks = normalizePortfolioLinks(links);

  function goToReview() {
    const missing = questions.some((question) => answers[question.id] === undefined);
    if (missing) {
      setError(C.errors.unanswered);
      return;
    }
    if (!cleanLinks.ok) {
      setLinksError(
        cleanLinks.code === "too-many" ? C.portfolio.errorTooMany : C.portfolio.errorInvalid,
      );
      return;
    }
    setError(null);
    setLinksError(null);
    setPanel("review");
  }

  async function handleSubmit() {
    if (!cleanLinks.ok) {
      setPanel("form");
      setLinksError(C.portfolio.errorInvalid);
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
        cvPath: cv?.path ?? null,
        portfolioLinks: cleanLinks.links,
        shareProfile,
      });

      if (!result.ok) {
        if (result.code === "unauthenticated") {
          router.push(loginHref);
          return;
        }
        // Los errores de contenido mandan de vuelta al formulario: el mensaje
        // no sirve de nada al lado de un botón "Enviar" que no se puede tocar.
        if (result.code === "cv" || result.code === "portfolio" || result.code === "invalid") {
          setPanel("form");
        }
        setError(result.message ?? ERROR_BY_CODE[result.code] ?? C.errors.generic);
        return;
      }

      setPanel("done");
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
              href={loginHref}
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
        title={panel === "done" ? undefined : panel === "review" ? C.review.title : C.sheetTitle}
        ariaLabel={C.sheetTitle}
      >
        {panel === "done" ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle size={52} weight="fill" aria-hidden="true" className="text-success" />
            <h3 className="font-display text-lg font-bold text-foreground">{C.successTitle}</h3>
            <p className="max-w-[40ch] text-sm text-foreground-secondary">{C.successBody}</p>
            <Button variant="primary" className="mt-2 w-full" onClick={close}>
              {C.successClose}
            </Button>
            <Link
              href="/empleos/mis-aplicaciones"
              className={cn(buttonVariants({ variant: "ghost", size: "md" }), "w-full")}
            >
              {C.successMyApplications}
            </Link>
          </div>
        ) : panel === "review" ? (
          <ReviewPanel
            profile={shareProfile ? profile : null}
            questions={questions}
            answers={answers}
            message={message.trim()}
            cv={cv}
            links={cleanLinks.ok ? cleanLinks.links : []}
            error={error}
            submitting={submitting}
            onBack={() => setPanel("form")}
            onSubmit={handleSubmit}
          />
        ) : (
          <div className="flex flex-col gap-6 pb-2">
            <p className="text-sm text-foreground-secondary">{C.intro}</p>

            {/* ---- 1. Perfil autocompletado + consentimiento ---------------- */}
            {profile && (
              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                  {C.profile.heading}
                </h3>
                <p className="text-sm text-foreground-secondary">
                  {shareProfile ? C.profile.shared : C.profile.hidden}
                </p>
                {shareProfile ? (
                  <ApplicantProfileCard profile={profile} />
                ) : (
                  <p className="rounded-lg border border-dashed border-border bg-surface-subtle px-3 py-3 text-sm text-foreground-muted">
                    {C.profile.hiddenHint}
                  </p>
                )}
                <label className="mt-1 flex min-h-11 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={shareProfile}
                    onChange={(event) => setShareProfile(event.target.checked)}
                    disabled={submitting}
                    className="size-5 shrink-0 accent-[var(--accent-empleos)]"
                  />
                  <span className="text-sm text-foreground">
                    {C.profile.toggleLabel}
                    <span className="block text-xs text-foreground-muted">
                      {C.profile.toggleHelp}
                    </span>
                  </span>
                </label>
              </section>
            )}

            {/* ---- 2. Preguntas del aviso ----------------------------------- */}
            {questions.length > 0 && (
              <section className="flex flex-col gap-5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                  {C.questionsHeading}
                </h3>
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
                        <div
                          role="group"
                          aria-labelledby={labelId}
                          className="flex flex-wrap gap-2"
                        >
                          {/* key con índice: dos opciones pueden tener el mismo texto. */}
                          {(question.options ?? []).map((option, optionIndex) => (
                            <OptionButton
                              key={`${optionIndex}-${option}`}
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
              </section>
            )}

            {/* ---- 3. Mensaje de presentación ------------------------------- */}
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
                disabled={submitting}
                onChange={(event) => setMessage(event.target.value)}
              />
            </Field>

            {/* ---- 4. Currículum -------------------------------------------- */}
            <CvUploadField
              value={cv}
              onChange={setCv}
              disabled={submitting}
              onUnauthenticated={() => router.push(loginHref)}
            />

            {/* ---- 5. Enlaces de portafolio --------------------------------- */}
            <PortfolioLinksField
              value={links}
              onChange={(next) => {
                setLinks(next);
                setLinksError(null);
              }}
              disabled={submitting}
              error={linksError}
            />

            {error && (
              <p role="alert" className="text-sm font-medium text-danger">
                {error}
              </p>
            )}

            <Button variant="primary" size="lg" className="w-full" onClick={goToReview}>
              {C.review.cta}
            </Button>
          </div>
        )}
      </BottomSheet>
    </>
  );
}

// ---------------------------------------------------------------------------
// Paso de revisión: el paquete completo, tal como lo va a recibir el otro lado
// ---------------------------------------------------------------------------

function ReviewPanel({
  profile,
  questions,
  answers,
  message,
  cv,
  links,
  error,
  submitting,
  onBack,
  onSubmit,
}: {
  profile: ApplicantProfilePreview | null;
  questions: JobQuestion[];
  answers: Record<string, AnswerValue>;
  message: string;
  cv: AttachedCv | null;
  links: string[];
  error: string | null;
  submitting: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const R = C.review;
  return (
    <div className="flex flex-col gap-5 pb-2">
      <ReviewBlock title={R.profileTitle}>
        {profile ? (
          <ApplicantProfileCard profile={profile} />
        ) : (
          <p className="text-sm text-foreground-muted">{R.profileHidden}</p>
        )}
      </ReviewBlock>

      {questions.length > 0 && (
        <ReviewBlock title={R.answersTitle}>
          <dl className="flex flex-col gap-2">
            {questions.map((question, index) => {
              const value = answers[question.id];
              return (
                <div key={`${index}-${question.id}`} className="flex flex-col gap-0.5">
                  <dt className="text-sm text-foreground-muted">{question.label}</dt>
                  <dd className="text-sm font-semibold text-foreground">
                    {typeof value === "boolean" ? (value ? C.yes : C.no) : (value ?? "—")}
                  </dd>
                </div>
              );
            })}
          </dl>
        </ReviewBlock>
      )}

      <ReviewBlock title={R.messageTitle}>
        {message ? (
          <p className="whitespace-pre-line text-sm text-foreground-secondary">{message}</p>
        ) : (
          <p className="text-sm text-foreground-muted">{R.messageEmpty}</p>
        )}
      </ReviewBlock>

      <ReviewBlock title={R.cvTitle}>
        {cv ? (
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <FilePdf
              size={18}
              weight="fill"
              aria-hidden="true"
              className="shrink-0 text-[var(--accent-empleos)]"
            />
            <span className="truncate">{cv.fileName}</span>
          </p>
        ) : (
          <p className="text-sm text-foreground-muted">{R.cvEmpty}</p>
        )}
      </ReviewBlock>

      <ReviewBlock title={R.portfolioTitle}>
        {links.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {links.map((link, index) => (
              <li
                key={`${index}-${link}`}
                className="flex items-center gap-2 text-sm text-foreground-secondary"
              >
                <LinkSimple size={15} aria-hidden="true" className="shrink-0" />
                <span className="truncate">{portfolioLinkLabel(link)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-foreground-muted">{R.portfolioEmpty}</p>
        )}
      </ReviewBlock>

      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          loading={submitting}
          onClick={onSubmit}
        >
          <PaperPlaneTilt size={18} weight="fill" aria-hidden="true" />
          {submitting ? C.submitting : C.submit}
        </Button>
        <Button variant="ghost" size="md" className="w-full" disabled={submitting} onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          {R.back}
        </Button>
      </div>
    </div>
  );
}

function ReviewBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
        {title}
      </h3>
      {children}
    </section>
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
