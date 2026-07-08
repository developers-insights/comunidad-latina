"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  Briefcase,
  Check,
  House,
  ShieldCheck,
  UsersThree,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { completeOnboardingAction } from "@/app/(auth)/actions";
import { COUNTRY_OPTIONS } from "@/components/auth/countries";
import { RegisterForm } from "@/components/auth/register-form";
import { FormError } from "@/components/auth/form-error";
import { ZoneInput } from "@/components/onboarding/zone-input";
import { Button, ProgressDots, useToast } from "@/components/ui";
import { Celebration, useCelebration } from "@/components/motion";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

const COPY = {
  back: "Volver al paso anterior",
  explore: "Explorar sin cuenta",
  step1Title: "¿De dónde sos vos o tu familia?",
  step2Title: "¿Qué necesitás resolver hoy?",
  step2Subtitle: "Elegí todo lo que quieras.",
  step2Cta: "Continuar",
  step2Disabled: "Elegí al menos una opción",
  step3Title: "Guardá tu lugar en la comunidad",
  step3Subtitle:
    "Con tu cuenta podés contactar, publicar y avisar si algo huele a estafa.",
  step4Title: "¿Por qué zona estás?",
  step4Subtitle:
    "Solo el barrio — nunca te vamos a pedir tu dirección exacta.",
  step4Label: "Tu barrio o zona",
  step4Cta: "Ver mi comunidad",
  step4Error: "Contanos tu zona para mostrarte lo que hay cerca.",
  toastTitle: "Así se ve tu comunidad en",
  welcomeAlt: "",
} as const;

interface NeedOption {
  id: "vivienda" | "trabajo" | "gente" | "estafas" | "tramites";
  label: string;
  Icon: Icon;
}

const NEED_OPTIONS: readonly NeedOption[] = [
  { id: "vivienda", label: "Buscar dónde vivir", Icon: House },
  { id: "trabajo", label: "Buscar trabajo", Icon: Briefcase },
  { id: "gente", label: "Conocer gente de mi país", Icon: UsersThree },
  { id: "estafas", label: "Protegerme de estafas", Icon: ShieldCheck },
  { id: "tramites", label: "Aprender trámites de acá", Icon: BookOpen },
];

const TOTAL_STEPS = 5;

export function OnboardingWizard({ isLoggedIn }: { isLoggedIn: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const { celebrating, celebrate } = useCelebration();
  const reduceMotion = usePrefersReducedMotion();

  const [step, setStep] = useState(1);
  const [registered, setRegistered] = useState(isLoggedIn);
  const [country, setCountry] = useState<string | null>(null);
  const [needs, setNeeds] = useState<NeedOption["id"][]>([]);
  const [area, setArea] = useState("");
  const [areaError, setAreaError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function goBack() {
    setFormError(null);
    // El paso 3 (registro) se saltea en ambas direcciones si ya hay cuenta.
    if (step === 4 && registered) setStep(2);
    else setStep(Math.max(1, step - 1));
  }

  function selectCountry(code: string) {
    setCountry(code);
    setStep(2);
  }

  function toggleNeed(id: NeedOption["id"]) {
    setNeeds((current) =>
      current.includes(id)
        ? current.filter((n) => n !== id)
        : [...current, id],
    );
  }

  function continueFromNeeds() {
    if (needs.length === 0) return;
    setStep(registered ? 4 : 3);
  }

  function finish() {
    const zone = area.trim();
    if (zone.length < 2) {
      setAreaError(COPY.step4Error);
      return;
    }
    setAreaError(null);
    setFormError(null);

    startTransition(async () => {
      if (country) {
        const result = await completeOnboardingAction({
          country,
          needs,
          area: zone,
        });
        if (!result.ok && result.formError) {
          // Sin sesión u otro problema: no bloqueamos el aterrizaje,
          // pero sí avisamos si fue un error real de guardado.
          console.warn("[onboarding] no se pudo guardar el perfil");
        }
      }
      // Paso 5 — recompensa: una celebración breve y elegante, después
      // aterrizamos en la comunidad ya filtrada. Con reduced-motion el destello
      // es un fade corto, así que esperamos menos antes de navegar.
      celebrate();
      toast({ title: `${COPY.toastTitle} ${zone}`, variant: "success" });
      const href = `/propiedades?zona=${encodeURIComponent(zone)}`;
      window.setTimeout(
        () => {
          router.push(href);
          router.refresh();
        },
        reduceMotion ? 350 : 900,
      );
    });
  }

  return (
    <div className="flex min-h-[70dvh] flex-col gap-6">
      <Celebration active={celebrating} message="¡Bienvenido a tu comunidad!" />
      {/* Barra superior: atrás siempre presente (menos en el paso 1) */}
      <div className="flex h-11 items-center">
        {step > 1 && (
          <button
            type="button"
            onClick={goBack}
            aria-label={COPY.back}
            className="touch-hitbox -ml-2 flex size-11 items-center justify-center rounded-full text-foreground-secondary transition-colors duration-(--duration-fast) hover:bg-surface-subtle hover:text-foreground"
          >
            <ArrowLeft size={22} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-6">
        {step === 1 && (
          <StepCountry selected={country} onSelect={selectCountry} />
        )}

        {step === 2 && (
          <section className="flex flex-col gap-5" aria-labelledby="ob-step2">
            <header className="flex flex-col gap-1">
              <h1
                id="ob-step2"
                className="font-display text-2xl font-bold text-foreground"
              >
                {COPY.step2Title}
              </h1>
              <p className="text-sm text-foreground-secondary">
                {COPY.step2Subtitle}
              </p>
            </header>
            <div className="flex flex-col gap-2.5">
              {NEED_OPTIONS.map((need) => {
                const selected = needs.includes(need.id);
                return (
                  <button
                    key={need.id}
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    onClick={() => toggleNeed(need.id)}
                    className={cn(
                      "flex min-h-14 items-center gap-3.5 rounded-lg border px-4 py-3 text-left",
                      "transition-[border-color,background-color,transform] duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.98]",
                      selected
                        ? "border-brand bg-brand-tint"
                        : "border-border bg-surface hover:border-border-strong",
                    )}
                  >
                    <need.Icon
                      size={24}
                      aria-hidden="true"
                      className={selected ? "text-brand-ink" : "text-foreground-secondary"}
                    />
                    <span className="flex-1 text-base font-medium text-foreground">
                      {need.label}
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors duration-(--duration-fast)",
                        selected
                          ? "border-brand bg-brand text-brand-foreground"
                          : "border-border bg-surface",
                      )}
                    >
                      {selected && <Check size={14} weight="bold" />}
                    </span>
                  </button>
                );
              })}
            </div>
            <Button
              size="lg"
              className="w-full"
              disabled={needs.length === 0}
              onClick={continueFromNeeds}
            >
              {needs.length === 0
                ? COPY.step2Disabled
                : `${COPY.step2Cta} (${needs.length})`}
            </Button>
          </section>
        )}

        {step === 3 && (
          <section className="flex flex-col gap-5" aria-labelledby="ob-step3">
            <header className="flex flex-col gap-1">
              <h1
                id="ob-step3"
                className="font-display text-2xl font-bold text-foreground"
              >
                {COPY.step3Title}
              </h1>
              <p className="text-sm text-foreground-secondary">
                {COPY.step3Subtitle}
              </p>
            </header>
            <RegisterForm
              loginNext="/bienvenida"
              onSuccess={() => {
                setRegistered(true);
                setStep(4);
                router.refresh();
              }}
            />
          </section>
        )}

        {step === 4 && (
          <section className="flex flex-col gap-5" aria-labelledby="ob-step4">
            <header className="flex flex-col gap-1">
              <h1
                id="ob-step4"
                className="font-display text-2xl font-bold text-foreground"
              >
                {COPY.step4Title}
              </h1>
              <p className="text-sm text-foreground-secondary">
                {COPY.step4Subtitle}
              </p>
            </header>
            <FormError>{formError}</FormError>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="ob-zone"
                className="text-sm font-medium text-foreground"
              >
                {COPY.step4Label}
              </label>
              <ZoneInput
                id="ob-zone"
                value={area}
                onChange={(next) => {
                  setArea(next);
                  if (areaError) setAreaError(null);
                }}
                aria-invalid={areaError ? true : undefined}
                aria-describedby={areaError ? "ob-zone-error" : undefined}
              />
              {areaError && (
                <p id="ob-zone-error" role="alert" className="text-sm text-danger">
                  {areaError}
                </p>
              )}
            </div>
            <Button size="lg" className="w-full" loading={pending} onClick={finish}>
              {COPY.step4Cta}
            </Button>
          </section>
        )}
      </div>

      {/* Progreso + escape route, siempre visibles */}
      <footer className="flex flex-col items-center gap-4 pb-2">
        <ProgressDots total={TOTAL_STEPS} current={step} />
        <Link
          href="/propiedades"
          className="rounded-sm text-sm font-medium text-foreground-secondary underline-offset-4 transition-colors duration-(--duration-fast) hover:text-foreground hover:underline"
        >
          {COPY.explore}
        </Link>
      </footer>
    </div>
  );
}

function StepCountry({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (code: string) => void;
}) {
  return (
    <section className="flex flex-col gap-5" aria-labelledby="ob-step1">
      {/* Solo en pantallas altas: en 375×667 la grilla debe verse sin scroll (§3.1) */}
      {/* Este asset es OPACO y claro, y aun así se queda: acá sí lee como panel.
          object-cover recorta una banda central donde el dibujo toca los cuatro
          bordes (stdev 55.6, tono dominante 9% de la banda), así que el
          rectángulo es la ILUSTRACIÓN, no su fondo — como una foto. Es el caso
          contrario al de empty-state-search.png, que era 86% de un beige plano:
          ahí el rectángulo era el fondo y en dark flotaba como un bloque claro.
          Un panel a sangre con esquinas redondeadas puede ser claro en dark;
          una placa de fondo plano, no. No lo recortes ni le pongas borde. */}
      <div className="relative hidden h-32 w-full overflow-hidden rounded-lg [@media(min-height:760px)]:block">
        <Image
          src="/images/onboarding-welcome.png"
          alt={COPY.welcomeAlt}
          fill
          priority
          sizes="(max-width: 640px) 100vw, 384px"
          className="object-cover"
        />
      </div>
      <h1
        id="ob-step1"
        className="font-display text-2xl font-bold text-foreground"
      >
        {COPY.step1Title}
      </h1>
      <div className="grid grid-cols-3 gap-2.5" role="group" aria-labelledby="ob-step1">
        {COUNTRY_OPTIONS.map((option) => {
          const isSelected = selected === option.code;
          return (
            <button
              key={option.code}
              type="button"
              onClick={() => onSelect(option.code)}
              aria-pressed={isSelected}
              className={cn(
                "flex min-h-[100px] flex-col items-center justify-center gap-1.5 rounded-lg border px-2 py-4",
                "transition-[border-color,background-color,transform] duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.97]",
                isSelected
                  ? "border-brand bg-brand-tint"
                  : "border-border bg-surface hover:border-border-strong",
              )}
            >
              {/* Código país estilizado — nunca emoji de bandera como único indicador */}
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-11 items-center justify-center rounded-full font-display text-base font-bold",
                  isSelected
                    ? "bg-brand text-brand-foreground"
                    : "bg-surface-subtle text-foreground-secondary",
                )}
              >
                {option.short}
              </span>
              <span className="text-center text-xs font-medium leading-tight text-foreground">
                {option.name}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
