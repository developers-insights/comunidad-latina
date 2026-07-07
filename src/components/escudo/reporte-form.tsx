"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  ChatCircle,
  CheckCircle,
  Storefront,
  UserCircle,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
  Banner,
  BezelCard,
  Button,
  Field,
  Input,
  Textarea,
} from "@/components/ui";
import { REPORT_REASONS } from "./report-reasons";
import {
  reportarEstafaAction,
  type ReporteState,
} from "@/app/(app)/escudo/reportar/actions";

/**
 * Flujo de reporte de estafa (§3.3): qué reportás → cuál es → qué pasó →
 * detalles. Un solo form, sin wizard: en mobile 375px entra completo y
 * el usuario ve todo lo que va a enviar antes de tocar el único CTA.
 */

export interface ConversationOption {
  conversationId: string;
  /** Nombre visible de la otra persona. */
  label: string;
  /** Contexto: título del aviso o fecha de la conversación. */
  sublabel: string;
  /**
   * Último mensaje de la contraparte (target real del reporte kind=message).
   * Si la contraparte nunca escribió, no hay qué reportar como mensaje.
   */
  messageId: string | null;
}

const COPY = {
  kindLegend: "¿Qué querés reportar?",
  kinds: {
    listing: { label: "Un aviso", hint: "Propiedad, trabajo, evento o negocio" },
    profile: { label: "Un perfil", hint: "Una persona o cuenta" },
    message: { label: "Un mensaje", hint: "De tus conversaciones" },
  },
  linkLabelListing: "Pegá el link del aviso",
  linkLabelProfile: "Pegá el link del perfil",
  linkHelp:
    "Abrí la publicación en la app, tocá compartir y copiá el link completo.",
  linkPlaceholder: "https://…",
  conversationLegend: "Elegí la conversación",
  conversationEmptyTitle: "Todavía no tenés conversaciones para reportar",
  conversationEmptyBody:
    "Acá aparecen tus conversaciones recientes. Si el problema es un aviso o un perfil, reportalo con su link.",
  conversationNoMessage: "Esta persona todavía no te escribió",
  reasonLegend: "¿Qué pasó?",
  detailsLabel: "Contanos más",
  detailsHelp:
    "Lo que recuerdes ayuda: qué te pidieron, cuándo, cómo te contactaron.",
  detailsPlaceholder: "Ej.: Me pidió un depósito por Zelle antes de mostrarme el cuarto…",
  submit: "Enviar reporte",
  privacy:
    "Tu reporte es confidencial: solo lo ve el equipo de moderación, nunca la persona reportada.",
  successTitle: "Gracias por cuidar a tu comunidad",
  successBody:
    "Nuestro equipo lo revisa. Si detectamos riesgo para otras personas, actuamos rápido — y tu nombre nunca se comparte.",
  successBack: "Volver al Escudo",
} as const;

type TargetKind = "listing" | "profile" | "message";

const KIND_ICONS: Record<TargetKind, Icon> = {
  listing: Storefront,
  profile: UserCircle,
  message: ChatCircle,
};

const optionCardClass = cn(
  "flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3",
  "transition-[border-color,background-color] duration-(--duration-fast) ease-(--ease-out-premium)",
  "hover:border-neutral-300 dark:hover:border-neutral-600",
  "has-[:checked]:border-brand has-[:checked]:bg-brand-50",
  "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-[var(--color-brand-200)]",
);

function ReporteExitoso() {
  return (
    <BezelCard
      variant="success"
      coreClassName="flex flex-col items-center gap-3 px-6 py-8 text-center"
      role="status"
    >
      <CheckCircle
        size={48}
        weight="fill"
        aria-hidden="true"
        className="text-success"
      />
      <p className="font-display text-xl font-bold text-foreground">
        {COPY.successTitle}
      </p>
      <p className="max-w-[44ch] text-sm text-foreground-secondary">
        {COPY.successBody}
      </p>
      <Link
        href="/escudo"
        className="mt-2 inline-flex h-11 items-center rounded-md bg-surface-subtle px-5 text-sm font-semibold text-foreground transition-colors duration-(--duration-fast) hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-brand-200)] dark:hover:bg-neutral-700/60"
      >
        {COPY.successBack}
      </Link>
    </BezelCard>
  );
}

const INITIAL_STATE: ReporteState = { status: "idle" };

export function ReporteForm({
  conversations,
}: {
  conversations: ConversationOption[];
}) {
  const [state, formAction, pending] = useActionState(
    reportarEstafaAction,
    INITIAL_STATE,
  );
  const [kind, setKind] = useState<TargetKind>("listing");
  const [reason, setReason] = useState<string>(REPORT_REASONS[0].value);

  if (state.status === "success") {
    return <ReporteExitoso />;
  }

  const reportableConversations = conversations.filter(
    (option) => option.messageId !== null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {(state.status === "invalid" || state.status === "error") && (
        <Banner variant="warning" role="alert">
          {state.message}
        </Banner>
      )}

      {/* 1. Qué reportás */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-foreground">
          {COPY.kindLegend}
        </legend>
        {(Object.keys(COPY.kinds) as TargetKind[]).map((value) => {
          const IconComponent = KIND_ICONS[value];
          const copy = COPY.kinds[value];
          return (
            <label key={value} className={optionCardClass}>
              <input
                type="radio"
                name="targetKind"
                value={value}
                checked={kind === value}
                onChange={() => setKind(value)}
                className="sr-only"
              />
              <IconComponent
                size={24}
                aria-hidden="true"
                className={cn(
                  "shrink-0",
                  kind === value ? "text-brand-700" : "text-foreground-muted",
                )}
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">
                  {copy.label}
                </span>
                <span className="block text-xs text-foreground-secondary">
                  {copy.hint}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {/* 2. Cuál es */}
      {kind === "message" ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-foreground">
            {COPY.conversationLegend}
          </legend>
          {reportableConversations.length === 0 ? (
            <div className="rounded-lg bg-surface-subtle px-4 py-4 text-sm text-foreground-secondary">
              <p className="font-medium text-foreground">
                {COPY.conversationEmptyTitle}
              </p>
              <p className="mt-1">{COPY.conversationEmptyBody}</p>
            </div>
          ) : (
            reportableConversations.map((option) => (
              <label key={option.conversationId} className={optionCardClass}>
                <input
                  type="radio"
                  name="messageId"
                  value={option.messageId ?? ""}
                  required
                  className="sr-only"
                />
                <ChatCircle
                  size={24}
                  aria-hidden="true"
                  className="shrink-0 text-foreground-muted"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {option.label}
                  </span>
                  <span className="block truncate text-xs text-foreground-secondary">
                    {option.sublabel}
                  </span>
                </span>
              </label>
            ))
          )}
        </fieldset>
      ) : (
        <Field
          htmlFor="reporte-link"
          label={kind === "listing" ? COPY.linkLabelListing : COPY.linkLabelProfile}
          help={COPY.linkHelp}
        >
          <Input
            id="reporte-link"
            name="link"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder={COPY.linkPlaceholder}
            required
            aria-describedby="reporte-link-help"
          />
        </Field>
      )}

      {/* 3. Qué pasó */}
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-foreground">
          {COPY.reasonLegend}
        </legend>
        <div className="flex flex-wrap gap-2">
          {REPORT_REASONS.map((option) => (
            <label
              key={option.key}
              className={cn(
                "inline-flex h-11 cursor-pointer items-center rounded-full border border-border bg-surface px-4 text-sm font-medium text-foreground-secondary",
                "transition-[border-color,background-color,color] duration-(--duration-fast) ease-(--ease-out-premium)",
                "hover:border-neutral-300 dark:hover:border-neutral-600",
                "has-[:checked]:border-brand has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700",
                "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-[var(--color-brand-200)]",
              )}
            >
              <input
                type="radio"
                name="reason"
                value={option.value}
                checked={reason === option.value}
                onChange={() => setReason(option.value)}
                className="sr-only"
              />
              {option.value}
            </label>
          ))}
        </div>
      </fieldset>

      {/* 4. Detalles */}
      <Field
        htmlFor="reporte-details"
        label={COPY.detailsLabel}
        help={COPY.detailsHelp}
        optional={reason !== "Otro"}
      >
        <Textarea
          id="reporte-details"
          name="details"
          maxLength={1000}
          placeholder={COPY.detailsPlaceholder}
          required={reason === "Otro"}
          aria-describedby="reporte-details-help"
        />
      </Field>

      <div className="flex flex-col gap-3">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={pending}
          className="w-full"
        >
          {COPY.submit}
        </Button>
        <p className="text-center text-xs text-foreground-muted">
          {COPY.privacy}
        </p>
      </div>
    </form>
  );
}
