"use client";

import type { ReactNode } from "react";
import { MapPin } from "@phosphor-icons/react/dist/ssr";
import { Field, Input, Select, Textarea } from "@/components/ui";
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
import { etiquetaDePrecioDesde } from "@/lib/empleos/servicios";
import { ToggleChips, toggleInList } from "./publish-form";

const C = COPY.servicePublish;

const ACCENT = "var(--accent-empleos)";
const ACCENT_EDGE = `color-mix(in oklab, ${ACCENT} 42%, transparent)`;

export interface ServiceFormValues {
  title: string;
  description: string;
  workMode: WorkMode;
  areaLabel: string;
  days: WorkDay[];
  schedule: string;
  price: string;
  payPeriod: JobPayPeriod;
}

export const SERVICIO_VACIO: ServiceFormValues = {
  title: "",
  description: "",
  workMode: "presencial",
  areaLabel: "",
  days: [],
  schedule: "",
  price: "",
  payPeriod: "hour",
};

export function precioDeServicio(values: Pick<ServiceFormValues, "price">) {
  const amount = Number(values.price.replace(",", "."));
  const valid = values.price.trim().length > 0 && Number.isFinite(amount) && amount > 0;
  return { amount, valid, tooBig: valid && amount > MAX_SALARY };
}

/**
 * Las mismas reglas que el servidor (`serviceDraftSchema`), dichas antes de
 * viajar. El servidor sigue siendo quien decide; esto evita el viaje inútil.
 */
export function validarPasoDeServicio(values: ServiceFormValues, step: 0 | 1): string | null {
  if (step === 0) {
    if (values.title.trim().length < 8) return C.errors.titleShort;
    if (values.description.trim().length < 30) return C.errors.descriptionShort;
    return null;
  }
  if (requiresArea(values.workMode) && values.areaLabel.trim().length < 3) {
    return C.errors.areaShort;
  }
  const price = precioDeServicio(values);
  if (values.price.trim().length > 0 && (!price.valid || price.tooBig)) {
    return C.errors.priceInvalid;
  }
  return null;
}

export function ServiceWhatFields({
  values,
  onChange,
  disabled,
  children,
}: {
  values: ServiceFormValues;
  onChange: (patch: Partial<ServiceFormValues>) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <>
      <Field
        htmlFor="service-title"
        label={C.steps.what.titleLabel}
        help={C.steps.what.titleHelp}
      >
        <Input
          id="service-title"
          value={values.title}
          maxLength={120}
          disabled={disabled}
          onChange={(event) => onChange({ title: event.target.value })}
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
          value={values.description}
          rows={6}
          maxLength={4000}
          disabled={disabled}
          onChange={(event) => onChange({ description: event.target.value })}
          placeholder={C.steps.what.descriptionPlaceholder}
        />
      </Field>
      {children}
    </>
  );
}

export function ServiceWhenFields({
  values,
  onChange,
  currency,
  disabled,
}: {
  values: ServiceFormValues;
  onChange: (patch: Partial<ServiceFormValues>) => void;
  currency: string;
  disabled?: boolean;
}) {
  const needsArea = requiresArea(values.workMode);
  const price = precioDeServicio(values);
  const pricePreview =
    price.valid && !price.tooBig
      ? etiquetaDePrecioDesde(price.amount, currency, values.payPeriod)
      : null;

  return (
    <>
      <ToggleChips
        legend={C.steps.when.modeLegend}
        help={WORK_MODE_HELP[values.workMode] ?? C.steps.when.modeHelp}
        options={WORK_MODES.map((mode) => ({ value: mode, label: WORK_MODE_LABEL[mode] }))}
        selected={[values.workMode]}
        onToggle={(mode) => onChange({ workMode: mode })}
      />

      {needsArea ? (
        <Field
          htmlFor="service-area"
          label={C.steps.when.areaLabel}
          help={C.steps.when.areaHelp}
        >
          <Input
            id="service-area"
            value={values.areaLabel}
            maxLength={80}
            disabled={disabled}
            onChange={(event) => onChange({ areaLabel: event.target.value })}
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
        selected={values.days}
        onToggle={(day) => onChange({ days: toggleInList(values.days, day) })}
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
          value={values.schedule}
          maxLength={MAX_SCHEDULE_LENGTH}
          disabled={disabled}
          onChange={(event) => onChange({ schedule: event.target.value })}
          placeholder={C.steps.when.schedulePlaceholder}
        />
      </Field>

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
              value={values.price}
              inputMode="decimal"
              maxLength={9}
              disabled={disabled}
              onChange={(event) => onChange({ price: event.target.value })}
              placeholder={C.steps.when.amountPlaceholder}
            />
          </Field>
          <Field htmlFor="service-period" label={C.steps.when.periodLabel} className="w-40">
            <Select
              id="service-period"
              value={values.payPeriod}
              disabled={disabled}
              onChange={(event) => onChange({ payPeriod: event.target.value as JobPayPeriod })}
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
  );
}
