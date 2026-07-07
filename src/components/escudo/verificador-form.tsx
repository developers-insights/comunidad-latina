"use client";

import { useActionState } from "react";
import { MagnifyingGlass, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import {
  Banner,
  BezelCard,
  Button,
  Field,
  Input,
  Select,
} from "@/components/ui";
import { VerificationCard } from "@/components/trust";
import {
  verificarLicenciaAction,
  type VerificarState,
} from "@/app/(app)/escudo/verificar/actions";

/**
 * Form del verificador de profesionales. El resultado es SIEMPRE el dato
 * literal del registro (verde/rojo grande, §3.3) o un estado honesto de
 * "todavía no tenemos ese registro conectado". Copy legal §11 fijo en
 * <VerificationCard /> — acá no se redacta ningún aval.
 */

const COPY = {
  kindLabel: "¿Qué profesional querés verificar?",
  kindNotario: "Notario público",
  kindAbogado: "Abogado / abogada",
  licenseLabel: "Número de matrícula o licencia",
  licenseHelp:
    "Tal como figura en el documento o aviso que te dieron. Sin espacios ni guiones.",
  licensePlaceholder: "Ej.: 01PE6412345",
  stateLabel: "Estado",
  stateValue: "Nueva York (NY)",
  stateHelp: "Por ahora verificamos registros de Nueva York.",
  submit: "Consultar el registro",
  expiredTitle: "Licencia vencida",
  mismatchTitle: "Los datos no coinciden",
  unknownTitle: "Todavía no tenemos este registro conectado",
  unknownBody:
    "No podemos consultarlo en vivo por ahora, así que no te vamos a inventar un resultado. Guardamos tu consulta para priorizar la conexión de este registro.",
  unknownAdvice:
    "Mientras tanto: pedile a la persona el documento oficial y buscá el número directamente en el sitio del registro del estado.",
} as const;

function ResultadoExpirado({
  license,
  registry,
  date,
}: {
  license: string;
  registry: string;
  date: string;
}) {
  return (
    <BezelCard
      variant="warning"
      coreClassName="flex flex-col items-center gap-3 px-6 py-8 text-center"
      role="status"
    >
      <WarningCircle
        size={48}
        weight="fill"
        aria-hidden="true"
        className="text-warning"
      />
      <p className="font-display text-xl font-bold text-foreground">
        {COPY.expiredTitle}
      </p>
      <p className="max-w-[44ch] text-sm text-foreground-secondary">
        La matrícula #{license} figura vencida según {registry} al {date}. No
        es una acreditación vigente — no le envíes dinero ni tus documentos.
      </p>
    </BezelCard>
  );
}

function ResultadoMismatch({
  license,
  registry,
  date,
}: {
  license: string;
  registry: string;
  date: string;
}) {
  return (
    <BezelCard
      variant="warning"
      coreClassName="flex flex-col items-center gap-3 px-6 py-8 text-center"
      role="status"
    >
      <WarningCircle
        size={48}
        weight="fill"
        aria-hidden="true"
        className="text-warning"
      />
      <p className="font-display text-xl font-bold text-foreground">
        {COPY.mismatchTitle}
      </p>
      <p className="max-w-[44ch] text-sm text-foreground-secondary">
        Lo que consultamos de la matrícula #{license} no coincide con lo que
        figura en {registry} al {date}. Revisá el número — y si te lo dio un
        profesional, pedile ver el documento oficial antes de avanzar.
      </p>
    </BezelCard>
  );
}

function ResultadoDesconocido() {
  return (
    <BezelCard
      coreClassName="flex flex-col gap-2 px-6 py-6"
      role="status"
    >
      <p className="font-display text-base font-semibold text-foreground">
        {COPY.unknownTitle}
      </p>
      <p className="text-sm text-foreground-secondary">{COPY.unknownBody}</p>
      <p className="text-sm text-foreground-secondary">{COPY.unknownAdvice}</p>
    </BezelCard>
  );
}

function Resultado({ state }: { state: VerificarState }) {
  switch (state.status) {
    case "found_active":
      return (
        <VerificationCard
          status="found_active"
          descriptor={`Matrícula #${state.license} — registro activo`}
          registry={state.registry}
          date={state.date}
        />
      );
    case "not_found":
      return (
        <VerificationCard
          status="not_found"
          descriptor={`Matrícula #${state.license}`}
          registry={state.registry}
          date={state.date}
        />
      );
    case "expired":
      return (
        <ResultadoExpirado
          license={state.license}
          registry={state.registry}
          date={state.date}
        />
      );
    case "mismatch":
      return (
        <ResultadoMismatch
          license={state.license}
          registry={state.registry}
          date={state.date}
        />
      );
    case "unknown":
      return <ResultadoDesconocido />;
    case "error":
      return <Banner variant="warning">{state.message}</Banner>;
    default:
      return null;
  }
}

const INITIAL_STATE: VerificarState = { status: "idle" };

export function VerificadorForm() {
  const [state, formAction, pending] = useActionState(
    verificarLicenciaAction,
    INITIAL_STATE,
  );

  const licenseError =
    state.status === "invalid" ? state.message : undefined;

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4">
        <Field htmlFor="verificar-kind" label={COPY.kindLabel}>
          <Select id="verificar-kind" name="kind" defaultValue="notario">
            <option value="notario">{COPY.kindNotario}</option>
            <option value="abogado">{COPY.kindAbogado}</option>
          </Select>
        </Field>

        <Field
          htmlFor="verificar-license"
          label={COPY.licenseLabel}
          help={COPY.licenseHelp}
          error={licenseError}
        >
          <Input
            id="verificar-license"
            name="license"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder={COPY.licensePlaceholder}
            required
            aria-invalid={licenseError ? true : undefined}
            aria-describedby={
              licenseError ? "verificar-license-error" : "verificar-license-help"
            }
            className="tabular-nums"
          />
        </Field>

        {/* Estado fijo NY en v1 — visible y honesto, no editable */}
        <Field
          htmlFor="verificar-state"
          label={COPY.stateLabel}
          help={COPY.stateHelp}
        >
          <Input
            id="verificar-state"
            name="state"
            value={COPY.stateValue}
            disabled
            readOnly
            aria-describedby="verificar-state-help"
          />
        </Field>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={pending}
          className="w-full"
        >
          {!pending && <MagnifyingGlass size={18} aria-hidden="true" />}
          {COPY.submit}
        </Button>
      </form>

      <div aria-live="polite">
        {!pending && <Resultado state={state} />}
      </div>
    </div>
  );
}
