"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CalendarDots,
  CheckCircle,
  MapPin,
  Toolbox,
} from "@phosphor-icons/react/dist/ssr";
import {
  BezelCard,
  Button,
  Field,
  Input,
  ProgressDots,
  Select,
  Textarea,
  buttonVariants,
} from "@/components/ui";
import { Celebration, Reveal, useCelebration } from "@/components/motion";
import { COPY } from "@/components/empleos/copy";
import { JOB_PAY_PERIODS, type JobPayPeriod } from "@/components/empleos/helpers";
import {
  WORK_MODES,
  WORK_MODE_HELP,
  WORK_MODE_LABEL,
  requiresArea,
  type WorkMode,
} from "@/lib/creators/work-mode";
import {
  MAX_SALARY,
  MAX_SCHEDULE_LENGTH,
  WORK_DAYS,
  type WorkDay,
} from "@/lib/empleos/detalles";
import { etiquetaDeDias, etiquetaDePrecioDesde } from "@/lib/empleos/servicios";
import { cn } from "@/lib/utils";
import { ToggleChips, toggleInList } from "./publish-form";
import { createServiceDraft, finalizeService } from "./actions";

/**
 * Wizard de SERVICIO — 3 pasos, contra los 4 del empleo.
 *
 *   1. Qué sabés hacer (título + descripción)
 *   2. Dónde y cuándo (modalidad, zona, días, horario, precio de referencia)
 *   3. Revisar y publicar
 *
 * LA DIFERENCIA DE LARGO ES EL PUNTO, no una simplificación por vaguería. Un
 * servicio no tiene salario obligatorio, ni jornada, ni preguntas al postulante,
 * ni fotos del lugar: pedir esos campos "por simetría" sería hacerle llenar una
 * búsqueda de empleo a alguien que sólo quiere avisar que corta el pasto. El
 * cliente describió el caso completo en una frase ("soy jardinero, disponible
 * sábados y domingos"), y el formulario tiene que caber en esa frase.
 *
 * Mismo flujo de guardado que el empleo, porque lo dicta la RLS de `listings`
 * (0004: un aviso de usuario no nace `published`): createServiceDraft →
 * finalizeService. Sin paso intermedio de fotos: no hay fotos.
 *
 * NO HAY VALIDACIÓN DE IDENTIDAD ACÁ. El porqué —y qué habría que tocar si la
 * decisión de producto cambia— está en el docblock de `createServiceDraft`.
 */

const C = COPY.servicePublish;
const TOTAL_STEPS = 3;

const ACCENT = "var(--accent-empleos)";
const ACCENT_TINT = `color-mix(in oklab, ${ACCENT} 12%, transparent)`;
const ACCENT_EDGE = `color-mix(in oklab, ${ACCENT} 42%, transparent)`;

/** Cintillo + título del paso. Gemelo del de empleos, con su propio total. */
function StepHeader({
  step,
  title,
  intro,
  icon,
}: {
  step: number;
  title: string;
  intro?: string;
  icon: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-2">
      <span
        className="inline-flex w-max items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground-secondary"
        style={{ backgroundColor: ACCENT_TINT }}
      >
        <span aria-hidden="true" className="[&>svg]:size-3.5" style={{ color: ACCENT }}>
          {icon}
        </span>
        {C.stepEyebrow(step, TOTAL_STEPS)}
      </span>
      <h2 className="font-display text-xl font-bold tracking-tight text-foreground">{title}</h2>
      {intro && <p className="text-sm text-foreground-secondary">{intro}</p>}
    </header>
  );
}

/** Una fila de la revisión final: rótulo arriba, valor abajo. */
function ReviewRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 whitespace-pre-line text-sm leading-relaxed",
          value ? "text-foreground" : "text-foreground-muted",
        )}
      >
        {value ?? C.steps.review.emptyValue}
      </dd>
    </div>
  );
}

export function ServicePublishForm({ currency }: { currency: string }) {
  const { celebrating, celebrate } = useCelebration();

  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<"published" | "pending_review" | null>(null);
  /** El borrador se crea una sola vez: un reintento no duplica avisos. */
  const [draftId, setDraftId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  /**
   * Arranca en "presencial" por la misma razón que el empleo: el jardinero, el
   * pintor y la señora que limpia son la enorme mayoría de esta pestaña. Quien
   * arregla computadoras a distancia lo cambia de un toque, y al hacerlo
   * desaparece el pedido de zona.
   */
  const [workMode, setWorkMode] = useState<WorkMode>("presencial");
  const [areaLabel, setAreaLabel] = useState("");
  const [days, setDays] = useState<WorkDay[]>([]);
  const [schedule, setSchedule] = useState("");
  const [price, setPrice] = useState("");
  const [payPeriod, setPayPeriod] = useState<JobPayPeriod>("hour");

  const needsArea = requiresArea(workMode);
  const priceAmount = Number(price.replace(",", "."));
  const priceValid = price.trim().length > 0 && Number.isFinite(priceAmount) && priceAmount > 0;
  const priceTooBig = priceValid && priceAmount > MAX_SALARY;
  const pricePreview = priceValid
    ? etiquetaDePrecioDesde(priceAmount, currency, payPeriod)
    : null;

  function validateStep(current: number): string | null {
    if (current === 0) {
      if (title.trim().length < 8) return C.errors.titleShort;
      if (description.trim().length < 30) return C.errors.descriptionShort;
    }
    if (current === 1) {
      if (needsArea && areaLabel.trim().length < 3) return C.errors.areaShort;
      // Un monto escrito y roto ("abc", "0") es distinto de no poner monto: lo
      // primero se corrige, lo segundo es una elección válida.
      if (price.trim().length > 0 && (!priceValid || priceTooBig)) return C.errors.priceInvalid;
    }
    return null;
  }

  function goNext() {
    const problem = validateStep(step);
    if (problem) return setError(problem);
    setError(null);
    setStep((value) => Math.min(TOTAL_STEPS - 1, value + 1));
  }

  function goBack() {
    setError(null);
    setStep((value) => Math.max(0, value - 1));
  }

  async function handleSubmit() {
    // Revalidamos TODO: se puede volver atrás y vaciar un campo ya aprobado.
    for (let current = 0; current < TOTAL_STEPS; current += 1) {
      const problem = validateStep(current);
      if (problem) {
        setStep(current);
        setError(problem);
        return;
      }
    }
    setError(null);
    setSubmitting(true);
    try {
      let listingId = draftId;
      if (!listingId) {
        const result = await createServiceDraft({
          title: title.trim(),
          description: description.trim(),
          priceAmount: priceValid ? priceAmount : null,
          payPeriod,
          workMode,
          // A distancia no se manda zona: el servidor guarda NULL y el aviso se
          // describe por su modalidad, que es un dato real.
          areaLabel: needsArea ? areaLabel.trim() : null,
          days,
          schedule: schedule.trim() || null,
        });
        if (!result.ok) {
          setError(result.error);
          setSubmitting(false);
          return;
        }
        listingId = result.listingId;
        setDraftId(listingId);
      }

      const finalized = await finalizeService({ listingId });
      if (!finalized.ok) {
        setError(finalized.error);
        setSubmitting(false);
        return;
      }
      if (finalized.status === "published") celebrate();
      setDone(finalized.status);
    } catch {
      setError(C.errors.generic);
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setTitle("");
    setDescription("");
    setWorkMode("presencial");
    setAreaLabel("");
    setDays([]);
    setSchedule("");
    setPrice("");
    setPayPeriod("hour");
    setDraftId(null);
    setDone(null);
    setError(null);
    setStep(0);
  }

  // -------------------------------------------------------------------------
  // Confirmación
  // -------------------------------------------------------------------------
  if (done) {
    const published = done === "published";
    return (
      <>
        {published && <Celebration active={celebrating} message={C.successPublishedTitle} />}
        <BezelCard
          variant={published ? "success" : "default"}
          coreClassName="flex flex-col items-center gap-3 px-6 py-10 text-center"
        >
          <CheckCircle
            size={56}
            weight="fill"
            aria-hidden="true"
            className={published ? "text-success" : "text-brand"}
          />
          <h2 className="font-display text-xl font-bold text-foreground">
            {published ? C.successPublishedTitle : C.successReviewTitle}
          </h2>
          <p className="max-w-[40ch] text-sm text-foreground-secondary">
            {published ? C.successPublishedBody : C.successReviewBody}
          </p>
          <div className="mt-3 flex w-full flex-col gap-2">
            <Link
              href="/empleos?tipo=servicios"
              className={cn(buttonVariants({ variant: "primary", size: "md" }), "w-full")}
            >
              {C.goToServices}
            </Link>
            <Button variant="ghost" className="w-full" onClick={resetForm}>
              {C.publishAnother}
            </Button>
          </div>
        </BezelCard>
      </>
    );
  }

  // -------------------------------------------------------------------------
  // Wizard
  // -------------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-6">
      <ProgressDots total={TOTAL_STEPS} current={step + 1} />

      {/* key={step}: cada paso entra con su propio fade + subida corta. */}
      <Reveal key={step} y={12} className="flex flex-col gap-5">
        {step === 0 && (
          <>
            <StepHeader
              step={1}
              title={C.steps.what.title}
              intro={C.steps.what.intro}
              icon={<Toolbox weight="fill" />}
            />
            <Field
              htmlFor="service-title"
              label={C.steps.what.titleLabel}
              help={C.steps.what.titleHelp}
            >
              <Input
                id="service-title"
                value={title}
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={C.steps.what.titlePlaceholder}
              />
            </Field>
            <Field
              htmlFor="service-description"
              label={C.steps.what.descriptionLabel}
              help={C.steps.what.descriptionHelp}
            >
              <Textarea
                id="service-description"
                value={description}
                rows={6}
                maxLength={4000}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={C.steps.what.descriptionPlaceholder}
              />
            </Field>
          </>
        )}

        {step === 1 && (
          <>
            <StepHeader
              step={2}
              title={C.steps.when.title}
              intro={C.steps.when.intro}
              icon={<CalendarDots weight="fill" />}
            />

            {/* Modalidad primero: DECIDE si abajo se pide zona. */}
            <ToggleChips
              legend={C.steps.when.modeLegend}
              help={WORK_MODE_HELP[workMode] ?? C.steps.when.modeHelp}
              options={WORK_MODES.map((mode) => ({
                value: mode,
                label: WORK_MODE_LABEL[mode],
              }))}
              selected={[workMode]}
              onToggle={(mode) => setWorkMode(mode)}
            />

            {needsArea ? (
              <Field
                htmlFor="service-area"
                label={C.steps.when.areaLabel}
                help={C.steps.when.areaHelp}
              >
                <Input
                  id="service-area"
                  value={areaLabel}
                  maxLength={80}
                  onChange={(event) => setAreaLabel(event.target.value)}
                  placeholder={C.steps.when.areaPlaceholder}
                />
              </Field>
            ) : (
              <div
                className="flex items-start gap-2.5 rounded-md border border-border-subtle bg-surface-subtle px-4 py-3"
                style={{ borderColor: ACCENT_EDGE }}
              >
                <MapPin
                  size={18}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0"
                  style={{ color: ACCENT }}
                />
                <p className="text-sm leading-snug text-foreground-secondary">
                  <span className="block font-semibold text-foreground">
                    {C.steps.when.areaRemoteTitle}
                  </span>
                  {C.steps.when.areaRemoteBody}
                </p>
              </div>
            )}

            <ToggleChips
              legend={C.steps.when.daysLabel}
              help={C.steps.when.daysHelp}
              options={WORK_DAYS.map((day) => ({
                value: day.value,
                label: day.short,
                ariaLabel: day.label,
              }))}
              selected={days}
              onToggle={(day) => setDays((current) => toggleInList(current, day))}
              square
            />

            <Field
              htmlFor="service-schedule"
              label={C.steps.when.scheduleLabel}
              help={C.steps.when.scheduleHelp}
              optional
            >
              <Input
                id="service-schedule"
                value={schedule}
                maxLength={MAX_SCHEDULE_LENGTH}
                onChange={(event) => setSchedule(event.target.value)}
                placeholder={C.steps.when.schedulePlaceholder}
              />
            </Field>

            {/* PRECIO DE REFERENCIA — opcional, y la vista previa lo dice: sin
                monto no queda un hueco, queda "A convenir". */}
            <div className="flex flex-col gap-3 rounded-md border border-border-subtle bg-surface-subtle p-4">
              <div>
                <p className="text-sm font-semibold text-foreground">{C.steps.when.priceTitle}</p>
                <p className="mt-0.5 text-xs leading-snug text-foreground-muted">
                  {C.steps.when.priceHelp}
                </p>
              </div>
              <div className="flex gap-3">
                <Field
                  htmlFor="service-price"
                  label={C.steps.when.amountLabel}
                  help={C.steps.when.amountHelp}
                  className="flex-1"
                  optional
                >
                  <Input
                    id="service-price"
                    value={price}
                    inputMode="decimal"
                    maxLength={9}
                    onChange={(event) => setPrice(event.target.value)}
                    placeholder={C.steps.when.amountPlaceholder}
                  />
                </Field>
                <Field htmlFor="service-period" label={C.steps.when.periodLabel} className="w-40">
                  <Select
                    id="service-period"
                    value={payPeriod}
                    onChange={(event) => setPayPeriod(event.target.value as JobPayPeriod)}
                  >
                    {JOB_PAY_PERIODS.map((period) => (
                      <option key={period} value={period}>
                        {COPY.publish.payPeriodLabel[period]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <p className="text-sm text-foreground-secondary">
                {C.steps.when.previewLabel}{" "}
                <span className="numeric font-display font-bold text-foreground">
                  {pricePreview ?? C.steps.when.previewToAgree}
                </span>
              </p>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <StepHeader
              step={3}
              title={C.steps.review.title}
              intro={C.steps.review.intro}
              icon={<CheckCircle weight="fill" />}
            />
            <BezelCard coreClassName="flex flex-col gap-4 p-4">
              <dl className="flex flex-col gap-4">
                <ReviewRow label={C.steps.review.whatTitle} value={title.trim() || null} />
                <ReviewRow
                  label={C.steps.review.descriptionTitle}
                  value={description.trim() || null}
                />
                <ReviewRow
                  label={C.steps.review.whereTitle}
                  value={needsArea ? areaLabel.trim() || null : WORK_MODE_LABEL[workMode]}
                />
                <ReviewRow
                  label={C.steps.review.whenTitle}
                  value={
                    [etiquetaDeDias(days), schedule.trim() || null]
                      .filter(Boolean)
                      .join(" · ") || null
                  }
                />
                <ReviewRow
                  label={C.steps.review.priceTitle}
                  value={pricePreview ?? C.steps.when.previewToAgree}
                />
              </dl>
              <p className="rounded-md bg-surface-subtle px-3 py-2.5 text-xs leading-relaxed text-foreground-secondary">
                {C.steps.review.contactNote}
              </p>
            </BezelCard>
          </>
        )}
      </Reveal>

      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        {step > 0 && (
          <Button variant="ghost" onClick={goBack} disabled={submitting}>
            {C.nav.back}
          </Button>
        )}
        {step < TOTAL_STEPS - 1 ? (
          <Button variant="primary" className="ml-auto min-w-32" onClick={goNext}>
            {C.nav.next}
          </Button>
        ) : (
          <Button
            variant="primary"
            className="ml-auto min-w-40"
            loading={submitting}
            onClick={handleSubmit}
          >
            {submitting ? C.nav.submitting : C.nav.submit}
          </Button>
        )}
      </div>
    </div>
  );
}
