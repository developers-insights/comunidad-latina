"use client";

import { useState, useTransition } from "react";
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
import { RegisterForm } from "@/components/auth/register-form";
import { CheckEmail } from "@/components/auth/check-email";
import { FormError } from "@/components/auth/form-error";
import { ZoneInput } from "@/components/onboarding/zone-input";
import { Button, ProgressDots, useToast } from "@/components/ui";
import { Celebration, useCelebration } from "@/components/motion";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

const COPY = {
  back: "Volver al paso anterior",
  explore: "Explorar sin cuenta",
  needsTitle: "¿Qué necesitás resolver hoy?",
  needsSubtitle: "Elegí todo lo que quieras.",
  needsCta: "Continuar",
  needsDisabled: "Elegí al menos una opción",
  zoneTitle: "¿Por qué zona estás?",
  zoneSubtitle: "Solo el barrio — nunca te vamos a pedir tu dirección exacta.",
  zoneLabel: "Tu barrio o zona",
  /** Con sesión, la zona es el último paso y ya aterriza en la comunidad. */
  zoneCtaLoggedIn: "Ver mi comunidad",
  zoneCta: "Continuar",
  zoneError: "Contanos tu zona para mostrarte lo que hay cerca.",
  accountTitle: "Guardá tu lugar en la comunidad",
  accountSubtitle:
    "Con tu cuenta podés contactar, publicar y avisar si algo no te cierra.",
  toastTitle: "Así se ve tu comunidad en",
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
  { id: "estafas", label: "Seguridad y confianza", Icon: ShieldCheck },
  { id: "tramites", label: "Aprender trámites de acá", Icon: BookOpen },
];

const TOTAL_STEPS = 4;

/**
 * Orden de los pasos: necesidades → zona → cuenta → "revisá tu correo".
 *
 * La cuenta va ÚLTIMA a propósito. Desde que el registro exige confirmar el
 * correo no hay sesión al terminar de registrarse, así que cualquier pregunta
 * posterior quedaría colgada esperando un clic en un mail. Preguntando antes,
 * `registerAction` guarda perfil + necesidades + zona de una sola vez y no
 * queda nada a medias. Con sesión ya abierta el wizard corta en la zona (paso
 * 2) y guarda por el camino normal, con RLS.
 */
export function OnboardingWizard({ isLoggedIn }: { isLoggedIn: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const { celebrating, celebrate } = useCelebration();
  const reduceMotion = usePrefersReducedMotion();

  const [step, setStep] = useState(1);
  const [needs, setNeeds] = useState<NeedOption["id"][]>([]);
  const [area, setArea] = useState("");
  const [areaError, setAreaError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function goBack() {
    setFormError(null);
    setStep(Math.max(1, step - 1));
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
    setStep(2);
  }

  /** Zona válida → o cierra el onboarding (con sesión) o pasa a crear la cuenta. */
  function continueFromZone() {
    const zone = area.trim();
    if (zone.length < 2) {
      setAreaError(COPY.zoneError);
      return;
    }
    setAreaError(null);
    setFormError(null);
    if (isLoggedIn) finish();
    else setStep(3);
  }

  /** Solo para quien YA tiene sesión: guarda por RLS y aterriza. */
  function finish() {
    const zone = area.trim();

    startTransition(async () => {
      const result = await completeOnboardingAction({ needs, area: zone });
      if (!result.ok && result.formError) {
        // Sin sesión u otro problema: no bloqueamos el aterrizaje,
        // pero sí avisamos si fue un error real de guardado.
        console.warn("[onboarding] no se pudo guardar el perfil");
      }
      // Paso 4 — recompensa: una celebración breve y elegante, después
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
      {/* Barra superior: atrás siempre presente (menos en el paso 1 y en el
          cierre — con la cuenta ya creada, volver atrás no lleva a nada). */}
      <div className="flex h-11 items-center">
        {step > 1 && step < 4 && (
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
          <section className="flex flex-col gap-5" aria-labelledby="ob-needs">
            <header className="flex flex-col gap-1">
              <h1
                id="ob-needs"
                className="font-display text-2xl font-bold text-foreground"
              >
                {COPY.needsTitle}
              </h1>
              <p className="text-sm text-foreground-secondary">
                {COPY.needsSubtitle}
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
                ? COPY.needsDisabled
                : `${COPY.needsCta} (${needs.length})`}
            </Button>
          </section>
        )}

        {step === 2 && (
          <section className="flex flex-col gap-5" aria-labelledby="ob-zone-title">
            <header className="flex flex-col gap-1">
              <h1
                id="ob-zone-title"
                className="font-display text-2xl font-bold text-foreground"
              >
                {COPY.zoneTitle}
              </h1>
              <p className="text-sm text-foreground-secondary">
                {COPY.zoneSubtitle}
              </p>
            </header>
            <FormError>{formError}</FormError>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="ob-zone"
                className="text-sm font-medium text-foreground"
              >
                {COPY.zoneLabel}
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
            <Button
              size="lg"
              className="w-full"
              loading={pending}
              onClick={continueFromZone}
            >
              {isLoggedIn ? COPY.zoneCtaLoggedIn : COPY.zoneCta}
            </Button>
          </section>
        )}

        {step === 3 && (
          <section className="flex flex-col gap-5" aria-labelledby="ob-account">
            <header className="flex flex-col gap-1">
              <h1
                id="ob-account"
                className="font-display text-2xl font-bold text-foreground"
              >
                {COPY.accountTitle}
              </h1>
              <p className="text-sm text-foreground-secondary">
                {COPY.accountSubtitle}
              </p>
            </header>
            <RegisterForm
              loginNext="/bienvenida"
              needs={needs}
              area={area.trim()}
              // Al confirmar el correo aterriza donde habría aterrizado ahora
              // mismo si no hiciera falta confirmar: su comunidad, ya filtrada.
              next={`/propiedades?zona=${encodeURIComponent(area.trim())}`}
              onSuccess={(email) => {
                setRegisteredEmail(email);
                setStep(4);
              }}
            />
          </section>
        )}

        {step === 4 && registeredEmail !== null && (
          <CheckEmail email={registeredEmail} />
        )}
      </div>

      {/* Progreso + escape route. En el cierre ("revisá tu correo") la salida
          ya no es "explorar sin cuenta": la cuenta existe, falta confirmarla. */}
      <footer className="flex flex-col items-center gap-4 pb-2">
        <ProgressDots total={TOTAL_STEPS} current={step} />
        {step < 4 && (
          <Link
            href="/propiedades"
            className="rounded-sm text-sm font-medium text-foreground-secondary underline-offset-4 transition-colors duration-(--duration-fast) hover:text-foreground hover:underline"
          >
            {COPY.explore}
          </Link>
        )}
      </footer>
    </div>
  );
}
