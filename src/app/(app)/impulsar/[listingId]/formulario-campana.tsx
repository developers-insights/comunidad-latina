"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Info, PaperPlaneTilt, Target } from "@phosphor-icons/react/dist/ssr";
import {
  Badge,
  BezelCard,
  Button,
  Field,
  Input,
  useToast,
} from "@/components/ui";
import { MONETIZATION_COPY } from "@/lib/monetization";
import { saveCampaignAction } from "@/lib/monetization/actions";
import { cn } from "@/lib/utils";

const M = MONETIZATION_COPY;

export interface CampaignDraft {
  id: string;
  status: string;
  objective: string;
  budgetCents: number;
  durationDays: number;
  countries: string[];
  cities: string[];
  languages: string[];
  interests: string[];
  ageMin: number | null;
  ageMax: number | null;
  reviewNote: string | null;
}

export interface FormularioCampanaProps {
  listingId: string;
  /** Campaña existente (cualquier estado). Editable sólo mientras sea borrador. */
  campaign: CampaignDraft | null;
}

type Objective = (typeof M.campaign.objectives)[number]["value"];

/**
 * Armado de una CAMPAÑA — el segundo de los dos caminos de "Promocionar".
 *
 * LA DECISIÓN DE COPY MÁS IMPORTANTE DE ESTE MÓDULO está arriba de todo el
 * formulario, no escondida al pie: la campaña guarda país, ciudad, edad, idioma
 * e intereses, y HOY esos datos no eligen a quién se le muestra el anuncio (el
 * motor de entrega está fuera de alcance por decisión del contrato). Cobrar por
 * "segmentación" sin motor de segmentación sería vender humo; decirlo antes de
 * que la persona cargue un presupuesto es lo único decente. El aviso va con
 * `Info`, no con `Warning`: es una aclaración, no una alarma.
 *
 * Una campaña que ya salió del borrador se muestra en SÓLO LECTURA: la 0048
 * congela presupuesto, moneda y duración con un trigger, así que un formulario
 * editable prometería un guardado que la base va a rechazar.
 */
export function FormularioCampana({ listingId, campaign }: FormularioCampanaProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  const isDraft = !campaign || campaign.status === "draft" || campaign.status === "rejected";

  const [objective, setObjective] = useState<Objective>(
    (campaign?.objective as Objective) ?? "messages",
  );
  const [budget, setBudget] = useState(
    campaign ? String(Math.round(campaign.budgetCents / 100)) : "",
  );
  const [duration, setDuration] = useState(String(campaign?.durationDays ?? 7));
  const [countries, setCountries] = useState((campaign?.countries ?? []).join(", "));
  const [cities, setCities] = useState((campaign?.cities ?? []).join(", "));
  const [languages, setLanguages] = useState((campaign?.languages ?? []).join(", "));
  const [interests, setInterests] = useState((campaign?.interests ?? []).join(", "));
  const [ageMin, setAgeMin] = useState(campaign?.ageMin ? String(campaign.ageMin) : "");
  const [ageMax, setAgeMax] = useState(campaign?.ageMax ? String(campaign.ageMax) : "");
  const [error, setError] = useState<string | null>(null);

  function submit(forReview: boolean) {
    const budgetUsd = Number(budget);
    if (!Number.isFinite(budgetUsd) || budgetUsd < 1) {
      setError(M.campaign.budgetError);
      return;
    }
    const durationDays = Number(duration);
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 90) {
      setError(M.campaign.durationError);
      return;
    }
    const min = ageMin ? Number(ageMin) : null;
    const max = ageMax ? Number(ageMax) : null;
    if (min !== null && max !== null && min > max) {
      setError(M.campaign.ageError);
      return;
    }
    setError(null);

    startTransition(async () => {
      const result = await saveCampaignAction({
        listingId,
        objective,
        budgetUsd: Math.round(budgetUsd),
        durationDays,
        countries,
        cities,
        languages,
        interests,
        ageMin: min,
        ageMax: max,
        submitForReview: forReview,
      });

      if (!result.ok) {
        if (result.needsAuth) {
          window.location.assign(`/entrar?next=/impulsar/${listingId}?modo=campana`);
          return;
        }
        setError(result.error);
        return;
      }

      toast(
        result.status === "pending_review"
          ? {
              title: M.campaign.sentTitle,
              description: M.campaign.sentBody,
              variant: "success",
            }
          : {
              title: M.campaign.savedTitle,
              description: M.campaign.savedBody,
              variant: "info",
            },
      );
      router.refresh();
    });
  }

  // -------------------------------------------------------------------------
  // Campaña ya enviada: sólo lectura (la base congela la plata y la duración)
  // -------------------------------------------------------------------------
  if (campaign && !isDraft) {
    return (
      <div className="flex flex-col gap-4">
        <BezelCard variant="featured" coreClassName="flex flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-display text-lg font-bold text-foreground">
              {M.campaign.existingTitle}
            </h2>
            <Badge variant="brand" className="shrink-0">
              {M.campaign.statusLabel[campaign.status] ?? campaign.status}
            </Badge>
          </div>
          <ResumenCampana campaign={campaign} />
        </BezelCard>
        <DeliveryNotice />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <DeliveryNotice />

      {campaign?.status === "rejected" && campaign.reviewNote && (
        <p className="rounded-lg bg-warning-bg px-4 py-3 text-sm text-foreground">
          {M.campaign.rejectedNote(campaign.reviewNote)}
        </p>
      )}

      {/* Objetivo */}
      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-foreground">
          <Target size={20} weight="fill" aria-hidden="true" className="text-brand" />
          {M.campaign.objectiveLabel}
        </h2>
        <div
          role="radiogroup"
          aria-label={M.campaign.objectiveLabel}
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          {M.campaign.objectives.map((option) => {
            const active = objective === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setObjective(option.value)}
                className={cn(
                  "flex min-h-11 flex-col items-start gap-0.5 rounded-lg border p-3.5 text-left",
                  "transition-[transform,background-color,border-color] duration-(--duration-fast) ease-(--ease-spring)",
                  "active:scale-[0.99] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                  active
                    ? "border-brand bg-brand-tint"
                    : "border-border-subtle bg-surface hover:bg-surface-subtle",
                )}
              >
                <span
                  className={cn(
                    "text-sm font-semibold",
                    active ? "text-brand-ink" : "text-foreground",
                  )}
                >
                  {option.label}
                </span>
                <span className="text-xs text-foreground-secondary">{option.hint}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Presupuesto y duración */}
      <section className="grid grid-cols-2 gap-3">
        <Field
          htmlFor="camp-budget"
          label={M.campaign.budgetLabel}
          help={M.campaign.budgetHelp}
        >
          <Input
            id="camp-budget"
            type="number"
            inputMode="decimal"
            min={1}
            value={budget}
            placeholder="50"
            className="numeric"
            onChange={(event) => setBudget(event.target.value)}
          />
        </Field>
        <Field
          htmlFor="camp-duration"
          label={M.campaign.durationLabel}
          help={M.campaign.durationHelp}
        >
          <Input
            id="camp-duration"
            type="number"
            inputMode="numeric"
            min={1}
            max={90}
            value={duration}
            className="numeric"
            onChange={(event) => setDuration(event.target.value)}
          />
        </Field>
      </section>

      {/* Segmentación */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-foreground">
            {M.campaign.audienceTitle}
          </h2>
          <p className="mt-0.5 text-sm text-foreground-secondary">
            {M.campaign.audienceOptional}
          </p>
        </div>

        <Field
          htmlFor="camp-countries"
          label={M.campaign.countriesLabel}
          help={M.campaign.listHelp}
          optional
        >
          <Input
            id="camp-countries"
            value={countries}
            maxLength={2_000}
            placeholder={M.campaign.countriesPlaceholder}
            onChange={(event) => setCountries(event.target.value)}
          />
        </Field>
        <Field
          htmlFor="camp-cities"
          label={M.campaign.citiesLabel}
          help={M.campaign.listHelp}
          optional
        >
          <Input
            id="camp-cities"
            value={cities}
            maxLength={4_000}
            placeholder={M.campaign.citiesPlaceholder}
            onChange={(event) => setCities(event.target.value)}
          />
        </Field>
        <Field
          htmlFor="camp-languages"
          label={M.campaign.languagesLabel}
          help={M.campaign.listHelp}
          optional
        >
          <Input
            id="camp-languages"
            value={languages}
            maxLength={500}
            placeholder={M.campaign.languagesPlaceholder}
            onChange={(event) => setLanguages(event.target.value)}
          />
        </Field>
        <Field
          htmlFor="camp-interests"
          label={M.campaign.interestsLabel}
          help={M.campaign.listHelp}
          optional
        >
          <Input
            id="camp-interests"
            value={interests}
            maxLength={3_000}
            placeholder={M.campaign.interestsPlaceholder}
            onChange={(event) => setInterests(event.target.value)}
          />
        </Field>

        <fieldset>
          <legend className="text-sm font-semibold text-foreground">
            {M.campaign.ageLabel}
          </legend>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Field htmlFor="camp-age-min" label={M.campaign.ageFrom} optional>
              <Input
                id="camp-age-min"
                type="number"
                inputMode="numeric"
                min={13}
                max={99}
                value={ageMin}
                className="numeric"
                onChange={(event) => setAgeMin(event.target.value)}
              />
            </Field>
            <Field htmlFor="camp-age-max" label={M.campaign.ageTo} optional>
              <Input
                id="camp-age-max"
                type="number"
                inputMode="numeric"
                min={13}
                max={99}
                value={ageMax}
                className="numeric"
                onChange={(event) => setAgeMax(event.target.value)}
              />
            </Field>
          </div>
        </fieldset>
      </section>

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
          loading={isPending}
          onClick={() => submit(true)}
        >
          <PaperPlaneTilt size={18} weight="fill" aria-hidden="true" />
          {M.campaign.submit}
        </Button>
        <Button
          variant="outline"
          className="w-full"
          disabled={isPending}
          onClick={() => submit(false)}
        >
          {M.campaign.saveDraft}
        </Button>
        <p className="text-center text-xs leading-relaxed text-foreground-muted">
          {M.campaign.submitHelp}
        </p>
      </div>
    </div>
  );
}

/** El aviso honesto sobre qué hace —y qué no hace— la segmentación hoy. */
function DeliveryNotice() {
  return (
    <div
      role="note"
      aria-label={M.campaign.deliveryNoticeTitle}
      className="flex items-start gap-3 rounded-lg bg-info-bg p-4"
    >
      <Info size={20} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">
          {M.campaign.deliveryNoticeTitle}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">
          {M.campaign.deliveryNoticeBody}
        </p>
      </div>
    </div>
  );
}

function ResumenCampana({ campaign }: { campaign: CampaignDraft }) {
  const rows: Array<[string, string]> = [
    [
      M.campaign.objectiveLabel,
      M.campaign.objectives.find((o) => o.value === campaign.objective)?.label ??
        campaign.objective,
    ],
    [M.campaign.budgetLabel, `USD ${Math.round(campaign.budgetCents / 100)}`],
    [M.campaign.durationLabel, `${campaign.durationDays} días`],
  ];
  if (campaign.countries.length) rows.push([M.campaign.countriesLabel, campaign.countries.join(", ")]);
  if (campaign.cities.length) rows.push([M.campaign.citiesLabel, campaign.cities.join(", ")]);
  if (campaign.languages.length) rows.push([M.campaign.languagesLabel, campaign.languages.join(", ")]);
  if (campaign.interests.length) rows.push([M.campaign.interestsLabel, campaign.interests.join(", ")]);
  if (campaign.ageMin || campaign.ageMax) {
    rows.push([M.campaign.ageLabel, `${campaign.ageMin ?? 13} – ${campaign.ageMax ?? 99}`]);
  }

  return (
    <dl className="flex flex-col gap-2">
      {rows.map(([term, value]) => (
        <div key={term} className="flex items-baseline justify-between gap-4">
          <dt className="shrink-0 text-sm text-foreground-secondary">{term}</dt>
          <dd className="min-w-0 text-right text-sm font-medium text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
