"use client";

import { useState, useTransition } from "react";
import {
  ArrowDown,
  ChatCircleText,
  Copy,
  Lightbulb,
  MagicWand,
  TextAa,
} from "@phosphor-icons/react/dist/ssr";
import {
  BezelCard,
  Button,
  Field,
  Input,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from "@/components/ui";
import {
  suggestForBusiness,
  type CopilotoSuggestions,
  type SuggestResult,
} from "./actions";

/**
 * UI del Copiloto (client): dos columnas — input a la izquierda, sugerencias
 * a la derecha (apiladas en mobile). "Usar este" copia la sugerencia al form
 * de edición (la columna izquierda ES el borrador del aviso); "Copiar" la
 * lleva al portapapeles para pegarla donde haga falta.
 */

const COPY = {
  prefillLabel: "Empezar desde uno de tus avisos",
  prefillPlaceholder: "Escribir desde cero",
  tituloLabel: "Título de tu negocio",
  tituloPlaceholder: "Ej: Envíos y remesas La Confianza",
  descripcionLabel: "Descripción",
  descripcionPlaceholder:
    "Contá qué ofrecés, desde cuándo, en qué zona atendés y qué te hace distinto. Cuanto más concreto, mejores sugerencias.",
  descripcionHelp: "Sin teléfonos ni direcciones exactas — el contacto lo protege la plataforma.",
  cta: "Pedir sugerencias",
  ctaLoading: "Pensando con vos…",
  resultadosTitulo: "Sugerencias del Copiloto",
  titulosSeccion: "3 títulos alternativos",
  descripcionSeccion: "Descripción mejorada",
  ideasSeccion: "3 ideas de post para el feed",
  usarTitulo: "Usar este",
  usarDescripcion: "Usar esta",
  copiar: "Copiar",
  copiado: "Copiado — pegalo donde lo necesites.",
  aplicadoTitulo: "Listo, quedó en el borrador",
  aplicadoBody: "Revisalo y ajustalo a tu gusto antes de publicar.",
  disclaimer:
    "Sugerencias generadas con IA — revisalas antes de publicar; vos conocés tu negocio mejor que nadie.",
  vacioTitulo: "Tus sugerencias van a aparecer acá",
  vacioBody:
    "Completá el título y la descripción de tu negocio y pedile ideas al Copiloto.",
  errorCopy: "No se pudo copiar — seleccioná el texto y copialo a mano.",
} as const;

export interface PrefillListing {
  id: string;
  title: string;
  description: string;
}

export function CopilotoForm({ listings }: { listings: PrefillListing[] }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(listings[0]?.title ?? "");
  const [description, setDescription] = useState(listings[0]?.description ?? "");
  const [selectedId, setSelectedId] = useState(listings[0]?.id ?? "");
  const [suggestions, setSuggestions] = useState<CopilotoSuggestions | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = title.trim().length >= 4 && description.trim().length >= 20;

  function handlePrefill(id: string) {
    setSelectedId(id);
    const listing = listings.find((item) => item.id === id);
    if (listing) {
      setTitle(listing.title);
      setDescription(listing.description);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || pending) return;
    setError(null);
    startTransition(async () => {
      const result: SuggestResult = await suggestForBusiness({ title, description });
      if (result.ok) {
        setSuggestions(result.suggestions);
      } else {
        setError(result.error);
      }
    });
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: COPY.copiado, variant: "success" });
    } catch {
      toast({ title: COPY.errorCopy, variant: "warning" });
    }
  }

  function applyTitle(value: string) {
    setTitle(value);
    toast({ title: COPY.aplicadoTitulo, description: COPY.aplicadoBody, variant: "success" });
  }

  function applyDescription(value: string) {
    setDescription(value);
    toast({ title: COPY.aplicadoTitulo, description: COPY.aplicadoBody, variant: "success" });
  }

  return (
    <div className="mt-6 grid gap-5 lg:grid-cols-2 lg:items-start">
      {/* Columna izquierda: el borrador del negocio */}
      <BezelCard coreClassName="p-5">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {listings.length > 0 && (
            <Field htmlFor="copiloto-prefill" label={COPY.prefillLabel} optional>
              <Select
                id="copiloto-prefill"
                value={selectedId}
                onChange={(event) => handlePrefill(event.target.value)}
              >
                <option value="">{COPY.prefillPlaceholder}</option>
                {listings.map((listing) => (
                  <option key={listing.id} value={listing.id}>
                    {listing.title}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field htmlFor="copiloto-title" label={COPY.tituloLabel}>
            <Input
              id="copiloto-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={COPY.tituloPlaceholder}
              maxLength={120}
              required
            />
          </Field>

          <Field
            htmlFor="copiloto-description"
            label={COPY.descripcionLabel}
            help={COPY.descripcionHelp}
          >
            <Textarea
              id="copiloto-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={COPY.descripcionPlaceholder}
              rows={8}
              maxLength={2000}
              aria-describedby="copiloto-description-help"
              required
            />
          </Field>

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <Button type="submit" loading={pending} disabled={!canSubmit} className="self-start">
            <MagicWand size={18} aria-hidden="true" />
            {pending ? COPY.ctaLoading : COPY.cta}
          </Button>
        </form>
      </BezelCard>

      {/* Columna derecha: sugerencias */}
      <section aria-label={COPY.resultadosTitulo} aria-busy={pending}>
        {pending ? (
          <SuggestionsSkeleton />
        ) : suggestions ? (
          <div className="flex flex-col gap-4">
            <SuggestionGroup
              icon={<TextAa size={18} aria-hidden="true" />}
              title={COPY.titulosSeccion}
            >
              {suggestions.titles.map((suggestedTitle, index) => (
                <SuggestionCard
                  key={`title-${index}`}
                  text={suggestedTitle}
                  actionLabel={COPY.usarTitulo}
                  onUse={() => applyTitle(suggestedTitle)}
                  onCopy={() => copyText(suggestedTitle)}
                />
              ))}
            </SuggestionGroup>

            <SuggestionGroup
              icon={<ChatCircleText size={18} aria-hidden="true" />}
              title={COPY.descripcionSeccion}
            >
              <SuggestionCard
                text={suggestions.description}
                actionLabel={COPY.usarDescripcion}
                onUse={() => applyDescription(suggestions.description)}
                onCopy={() => copyText(suggestions.description)}
              />
            </SuggestionGroup>

            <SuggestionGroup
              icon={<Lightbulb size={18} aria-hidden="true" />}
              title={COPY.ideasSeccion}
            >
              {suggestions.postIdeas.map((idea, index) => (
                <SuggestionCard
                  key={`idea-${index}`}
                  text={idea}
                  onCopy={() => copyText(idea)}
                />
              ))}
            </SuggestionGroup>

            <p className="text-xs text-foreground-muted">{COPY.disclaimer}</p>
          </div>
        ) : (
          <BezelCard coreClassName="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <span
              aria-hidden="true"
              className="flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand"
            >
              <Lightbulb size={24} weight="light" />
            </span>
            <p className="font-display text-base font-semibold text-foreground">
              {COPY.vacioTitulo}
            </p>
            <p className="max-w-[36ch] text-sm text-foreground-secondary">{COPY.vacioBody}</p>
            <ArrowDown
              size={18}
              aria-hidden="true"
              className="mt-1 text-foreground-muted lg:hidden"
            />
          </BezelCard>
        )}
      </section>
    </div>
  );
}

function SuggestionGroup({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-foreground">
        <span aria-hidden="true" className="text-brand">
          {icon}
        </span>
        {title}
      </h2>
      <div className="mt-2 flex flex-col gap-2.5">{children}</div>
    </div>
  );
}

function SuggestionCard({
  text,
  actionLabel,
  onUse,
  onCopy,
}: {
  text: string;
  actionLabel?: string;
  onUse?: () => void;
  onCopy: () => void;
}) {
  return (
    <BezelCard coreClassName="flex flex-col gap-3 p-4">
      <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{text}</p>
      <div className="flex flex-wrap items-center gap-2">
        {onUse && actionLabel && (
          <Button variant="secondary" size="sm" onClick={onUse}>
            {actionLabel}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onCopy}>
          <Copy size={16} aria-hidden="true" />
          {COPY.copiar}
        </Button>
      </div>
    </BezelCard>
  );
}

/** Silueta de las sugerencias mientras el modelo piensa (§5.2). */
function SuggestionsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <Skeleton className="h-5 w-44" />
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-36 w-full rounded-xl" />
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-16 w-full rounded-xl" />
    </div>
  );
}
