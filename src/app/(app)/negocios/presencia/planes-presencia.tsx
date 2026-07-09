"use client";

import { useState } from "react";
import { Check, Star } from "@phosphor-icons/react/dist/ssr";
import {
  Badge,
  BezelCard,
  BottomSheet,
  Button,
  ProximamentePremium,
  useToast,
} from "@/components/ui";
import type { Intervalo, PlanId, PlanPresencia } from "@/lib/stripe";
import { cn, formatMoney } from "@/lib/utils";
import { iniciarSuscripcion } from "./actions";

/** Copy local del módulo PAGOS — no toca src/lib/i18n (compartido). */
const COPY = {
  toggleMensual: "Mensual",
  toggleAnual: "Anual",
  ahorroAnual: "2 meses gratis",
  porMes: "por mes",
  facturadoAnual: (total: string) => `Facturado ${total} una vez al año`,
  recomendado: "El más elegido",
  elegir: (nombre: string) => `Elegir ${nombre}`,
  notaHonesta:
    "Pagar no cambia tu Trust Score, no altera los resultados del verificador del centro de seguridad y no garantiza conducta: solo mejora la visibilidad de tu negocio en el directorio. Cancelás cuando quieras.",
  errorGenerico:
    "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo en un momento.",
  proximamenteFeature: "los pagos",
} as const;

/** Precio efectivo por mes (anual prorrateado) — espejo client-safe del helper server. */
function precioPorMes(plan: PlanPresencia, intervalo: Intervalo): number {
  if (intervalo === "mensual") return plan.precioMensualUsd;
  return Math.round((plan.precioAnualUsd / 12) * 100) / 100;
}

export function PlanesPresencia({
  planes,
  stripeConfigured,
}: {
  planes: PlanPresencia[];
  stripeConfigured: boolean;
}) {
  const { toast } = useToast();
  const [intervalo, setIntervalo] = useState<Intervalo>("mensual");
  const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null);
  const [proximamenteOpen, setProximamenteOpen] = useState(false);

  async function elegirPlan(planId: PlanId) {
    if (loadingPlan) return;
    if (!stripeConfigured) {
      // HOY: Stripe no está → feedback premium inmediato (<100ms) y el
      // intento se registra en server (console.info) en paralelo.
      void iniciarSuscripcion({ plan: planId, intervalo });
      setProximamenteOpen(true);
      return;
    }
    setLoadingPlan(planId);
    try {
      const result = await iniciarSuscripcion({ plan: planId, intervalo });
      if (result.status === "redirect") {
        window.location.assign(result.url);
        return; // mantiene el spinner hasta que navega
      }
      if (result.status === "sin_sesion") {
        window.location.assign("/entrar");
        return;
      }
      if (result.status === "no_configurado") {
        // Degradación elegante §5.6: Stripe no está (HOY) → estado premium.
        setProximamenteOpen(true);
      } else {
        toast({ title: result.message, variant: "danger" });
      }
    } catch {
      toast({ title: COPY.errorGenerico, variant: "danger" });
    }
    setLoadingPlan(null);
  }

  return (
    <div className="mt-6">
      {/* Toggle mensual / anual con ahorro visible */}
      <div
        role="group"
        aria-label="Frecuencia de facturación"
        className="mx-auto flex w-fit items-center gap-1 rounded-full bg-surface-subtle p-1"
      >
        {(
          [
            { value: "mensual", label: COPY.toggleMensual },
            { value: "anual", label: COPY.toggleAnual },
          ] as const
        ).map((option) => {
          const active = intervalo === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => setIntervalo(option.value)}
              className={cn(
                "flex h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold",
                "transition-colors duration-(--duration-fast)",
                active
                  ? "bg-surface text-foreground shadow-xs"
                  : "text-foreground-secondary hover:text-foreground",
              )}
            >
              {option.label}
              {option.value === "anual" && (
                <Badge variant="success">{COPY.ahorroAnual}</Badge>
              )}
            </button>
          );
        })}
      </div>

      {/* Comparativa honesta: 3 planes, features acumulativas explícitas */}
      <div className="mt-6 flex flex-col gap-5">
        {planes.map((plan) => {
          const mensualEfectivo = precioPorMes(plan, intervalo);
          return (
            <BezelCard
              key={plan.id}
              variant={plan.recomendado ? "featured" : "default"}
              coreClassName="flex flex-col gap-4 p-6"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl font-bold text-foreground">
                    {plan.nombre}
                  </h2>
                  <p className="mt-0.5 text-sm text-foreground-secondary">
                    {plan.descripcion}
                  </p>
                </div>
                {plan.recomendado && (
                  <Badge variant="brand" className="shrink-0">
                    <Star size={12} weight="fill" aria-hidden="true" />
                    {COPY.recomendado}
                  </Badge>
                )}
              </div>

              <div>
                <p className="flex items-baseline gap-1.5">
                  <span className="numeric font-display text-4xl font-bold text-foreground">
                    {formatMoney(mensualEfectivo)}
                  </span>
                  <span className="text-sm text-foreground-secondary">
                    {COPY.porMes}
                  </span>
                </p>
                {intervalo === "anual" && (
                  <p className="numeric mt-1 text-xs text-foreground-muted">
                    {COPY.facturadoAnual(formatMoney(plan.precioAnualUsd))}
                  </p>
                )}
              </div>

              <ul className="flex flex-col gap-2.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm">
                    <Check
                      size={18}
                      weight="bold"
                      aria-hidden="true"
                      className="mt-0.5 shrink-0 text-success"
                    />
                    <span className="text-foreground">{feature}</span>
                  </li>
                ))}
              </ul>

              <Button
                variant={plan.recomendado ? "primary" : "outline"}
                size="lg"
                className="w-full"
                loading={loadingPlan === plan.id}
                onClick={() => elegirPlan(plan.id)}
              >
                {COPY.elegir(plan.nombre)}
              </Button>
            </BezelCard>
          );
        })}
      </div>

      <p className="mt-6 text-center text-xs leading-relaxed text-foreground-muted">
        {COPY.notaHonesta}
      </p>

      {/* Stripe sin configurar (HOY) → estado premium, nunca un error crudo */}
      <BottomSheet
        open={proximamenteOpen}
        onClose={() => setProximamenteOpen(false)}
        ariaLabel="Pagos disponibles muy pronto"
      >
        <ProximamentePremium feature={COPY.proximamenteFeature} />
      </BottomSheet>
    </div>
  );
}
