"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDots, CheckCircle, Toolbox } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, Button, ProgressDots, buttonVariants } from "@/components/ui";
import { Celebration, Reveal, useCelebration } from "@/components/motion";
import { COPY } from "@/components/empleos/copy";
import { WORK_MODE_LABEL, requiresArea } from "@/lib/creators/work-mode";
import { etiquetaDeDias, etiquetaDePrecioDesde } from "@/lib/empleos/servicios";
import { cn } from "@/lib/utils";
import {
  SERVICIO_VACIO,
  ServiceWhatFields,
  ServiceWhenFields,
  precioDeServicio,
  validarPasoDeServicio,
  type ServiceFormValues,
} from "./service-fields";
import { OfrecerImpulso } from "@/components/boosts/ofrecer-impulso";
import { createServiceDraft, finalizeService } from "./actions";
import {
  ListingVideoField,
  useVideoDeAviso,
} from "@/components/listings/listing-video-field";
import type { WizardHandleRef } from "./wizard-handle";

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

export function ServicePublishForm({
  currency,
  wizardRef,
}: {
  currency: string;
  /** Ver `wizard-handle.ts`: por acá el wizard le presta su "un paso atrás". */
  wizardRef?: WizardHandleRef;
}) {
  const { celebrating, celebrate } = useCelebration();

  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{
    status: "published" | "pending_review";
    listingId: string;
  } | null>(null);
  /** El borrador se crea una sola vez: un reintento no duplica avisos. */
  const [draftId, setDraftId] = useState<string | null>(null);
  const videoDelAviso = useVideoDeAviso();

  const [values, setValues] = useState<ServiceFormValues>(SERVICIO_VACIO);
  const patch = (changes: Partial<ServiceFormValues>) =>
    setValues((current) => ({ ...current, ...changes }));
  const { title, description, workMode, areaLabel, days, schedule, price, payPeriod } = values;

  const needsArea = requiresArea(workMode);
  const priceInfo = precioDeServicio(values);
  const priceAmount = priceInfo.amount;
  const priceValid = priceInfo.valid;
  const pricePreview =
    priceValid && !priceInfo.tooBig
      ? etiquetaDePrecioDesde(priceAmount, currency, payPeriod)
      : null;

  function validateStep(current: number): string | null {
    return current === 0 || current === 1 ? validarPasoDeServicio(values, current) : null;
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

  /**
   * El puente con el "Volver" de la barra de arriba: le presta el MISMO
   * `goBack` que usa el "Atrás" del pie, así el control que la app enseñó en
   * todas las demás pantallas retrocede un paso en vez de tirar el borrador.
   *
   * Sin `deps` a propósito: las dos funciones leen el paso y los campos de este
   * render, y una lista de dependencias acá sería una copia del formulario
   * entero que se va a desactualizar el día que alguien agregue un campo.
   */
  useEffect(() => {
    if (!wizardRef) return;
    wizardRef.current = {
      retroceder: () => {
        if (done || step === 0) return false;
        goBack();
        return true;
      },
      hayDatos: () => Boolean(!done && (title.trim() || description.trim() || price.trim())),
    };
    return () => {
      wizardRef.current = null;
    };
  });

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

      const videoSubido = await videoDelAviso.subir();
      if (!videoSubido.ok) {
        setError(videoSubido.error);
        setSubmitting(false);
        return;
      }

      const finalized = await finalizeService({ listingId, video: videoSubido.input });
      if (!finalized.ok) {
        setError(finalized.error);
        setSubmitting(false);
        return;
      }
      if (finalized.status === "published") celebrate();
      setDone({ status: finalized.status, listingId });
    } catch {
      setError(C.errors.generic);
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setValues(SERVICIO_VACIO);
    setDraftId(null);
    setDone(null);
    setError(null);
    setStep(0);
  }

  // -------------------------------------------------------------------------
  // Confirmación
  // -------------------------------------------------------------------------
  if (done) {
    const published = done.status === "published";
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

        {/* Sin `thumbnailUrl`: un servicio no tiene fotos (ver la cabecera de
            este archivo), así que la vista previa muestra la tarjeta sin
            imagen — que es exactamente como va a salir. */}
        <OfrecerImpulso
          className="mt-4"
          listingId={done.listingId}
          status={done.status}
          titulo={title.trim() || C.successPublishedTitle}
        />
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
            <ServiceWhatFields values={values} onChange={patch}>
              <ListingVideoField
                value={videoDelAviso.video}
                onChange={videoDelAviso.setVideo}
                tier="free"
                disabled={submitting}
                progress={videoDelAviso.progress}
              />
            </ServiceWhatFields>
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
            <ServiceWhenFields values={values} onChange={patch} currency={currency} />
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
