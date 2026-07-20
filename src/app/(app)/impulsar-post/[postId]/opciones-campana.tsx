"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Megaphone, Star, Users } from "@phosphor-icons/react/dist/ssr";
import { Badge, BezelCard, Button, useToast } from "@/components/ui";
import type { PostPromoId, PostPromoPackage } from "@/lib/stripe";
import { cn, formatMoney } from "@/lib/utils";
import { crearCampanaPost } from "./actions";

/** Copy local del módulo — no toca src/lib/i18n (compartido). */
const COPY = {
  audienceTitle: "¿A quién querés llegar?",
  audienceAll: "Toda la comunidad",
  audienceAllHint: "Tu publicación aparece en el feed de todos.",
  audienceZones: "Zonas específicas",
  audienceZonesHint: "Solo en el feed de la gente de las zonas que elijas.",
  zonesPick: "Elegí las zonas",
  zonesEmpty: "Todavía no hay zonas para segmentar — tu campaña llega a toda la comunidad.",
  needZone: "Elegí al menos una zona, o promocioná a toda la comunidad.",
  pagoUnico: "pago único",
  recomendado: "El más elegido",
  demoSeal: "Modo demostración",
  demoHint: "Se activa al instante, sin cobro — para probar cómo funciona.",
  promoteWith: (nombre: string) => `Promocionar por ${nombre}`,
  activateDemo: (nombre: string) => `Activar ${nombre} (demo)`,
  demoDone: "¡Campaña activa! Tu publicación ya llega a toda la comunidad.",
  errorGenerico:
    "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo en un momento.",
} as const;

type Scope = "all" | "zones";

export function OpcionesCampana({
  postId,
  paquetes,
  zones,
  stripeConfigured,
}: {
  postId: string;
  paquetes: PostPromoPackage[];
  zones: string[];
  stripeConfigured: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [scope, setScope] = useState<Scope>("all");
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [loadingPaquete, setLoadingPaquete] = useState<PostPromoId | null>(null);

  const hasZones = zones.length > 0;

  function toggleZone(zone: string) {
    setSelectedZones((current) =>
      current.includes(zone)
        ? current.filter((z) => z !== zone)
        : [...current, zone],
    );
  }

  async function elegir(paquete: PostPromoId) {
    if (loadingPaquete) return;

    const audience =
      scope === "zones" && hasZones
        ? { scope: "zones" as const, zones: selectedZones }
        : { scope: "all" as const };

    if (audience.scope === "zones" && audience.zones.length === 0) {
      toast({ title: COPY.needZone, variant: "warning" });
      return;
    }

    setLoadingPaquete(paquete);
    try {
      const result = await crearCampanaPost({ postId, paquete, audience });
      if (result.status === "redirect") {
        window.location.assign(result.url);
        return; // mantiene el spinner hasta que navega
      }
      if (result.status === "demo_activada") {
        toast({ title: COPY.demoDone, variant: "success" });
        router.refresh(); // la página pasa a mostrar el estado "campaña activa"
        return;
      }
      if (result.status === "sin_sesion") {
        window.location.assign(`/entrar?next=/impulsar-post/${postId}`);
        return;
      }
      toast({ title: result.message, variant: "danger" });
    } catch {
      toast({ title: COPY.errorGenerico, variant: "danger" });
    }
    setLoadingPaquete(null);
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Audiencia */}
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-bold text-foreground">
          {COPY.audienceTitle}
        </h2>

        <div
          role="radiogroup"
          aria-label={COPY.audienceTitle}
          className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
        >
          <AudienceOption
            active={scope === "all"}
            icon={<Users size={20} weight="fill" aria-hidden="true" />}
            title={COPY.audienceAll}
            hint={COPY.audienceAllHint}
            onClick={() => setScope("all")}
          />
          <AudienceOption
            active={scope === "zones"}
            disabled={!hasZones}
            icon={<Megaphone size={20} weight="fill" aria-hidden="true" />}
            title={COPY.audienceZones}
            hint={hasZones ? COPY.audienceZonesHint : COPY.zonesEmpty}
            onClick={() => hasZones && setScope("zones")}
          />
        </div>

        {scope === "zones" && hasZones && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-foreground-secondary">
              {COPY.zonesPick}
            </p>
            <div className="flex flex-wrap gap-2">
              {zones.map((zone) => {
                const active = selectedZones.includes(zone);
                return (
                  <button
                    key={zone}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleZone(zone)}
                    className={cn(
                      "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium",
                      "transition-[transform,background-color,border-color] duration-(--duration-fast) ease-(--ease-spring)",
                      "active:scale-[0.96] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                      active
                        ? "border-brand bg-brand-tint text-brand-ink"
                        : "border-border-subtle bg-surface text-foreground-secondary hover:bg-surface-subtle",
                    )}
                  >
                    {active && <Check size={14} weight="bold" aria-hidden="true" />}
                    {zone}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Paquetes */}
      <section className="flex flex-col gap-4">
        {!stripeConfigured && (
          <div className="flex items-center gap-2 rounded-lg bg-surface-subtle px-3.5 py-2.5">
            <Badge variant="warning" className="shrink-0">
              {COPY.demoSeal}
            </Badge>
            <p className="text-xs text-foreground-secondary">{COPY.demoHint}</p>
          </div>
        )}

        {paquetes.map((paquete) => (
          <BezelCard
            key={paquete.id}
            variant={paquete.recomendado ? "featured" : "default"}
            coreClassName="flex flex-col gap-4 p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-bold text-foreground">
                  {paquete.nombre}
                </h3>
                <p className="mt-0.5 text-sm text-foreground-secondary">
                  {paquete.descripcion}
                </p>
              </div>
              {paquete.recomendado && (
                <Badge variant="brand" className="shrink-0">
                  <Star size={12} weight="fill" aria-hidden="true" />
                  {COPY.recomendado}
                </Badge>
              )}
            </div>

            <p className="flex items-baseline gap-1.5">
              <span className="numeric font-display text-3xl font-bold text-foreground">
                {formatMoney(paquete.precioUsd)}
              </span>
              <span className="text-sm text-foreground-secondary">{COPY.pagoUnico}</span>
            </p>

            <Button
              variant={paquete.recomendado ? "primary" : "outline"}
              size="lg"
              className="w-full"
              loading={loadingPaquete === paquete.id}
              onClick={() => elegir(paquete.id)}
            >
              <Megaphone size={18} weight="fill" aria-hidden="true" />
              {stripeConfigured
                ? COPY.promoteWith(paquete.nombre)
                : COPY.activateDemo(paquete.nombre)}
            </Button>
          </BezelCard>
        ))}
      </section>
    </div>
  );
}

function AudienceOption({
  active,
  disabled,
  icon,
  title,
  hint,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border p-3.5 text-left",
        "transition-[transform,background-color,border-color] duration-(--duration-fast) ease-(--ease-spring)",
        "active:scale-[0.99] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        active
          ? "border-brand bg-brand-tint"
          : "border-border-subtle bg-surface hover:bg-surface-subtle",
      )}
    >
      <span className={cn("mt-0.5 shrink-0", active ? "text-brand" : "text-foreground-secondary")}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className={cn("block text-sm font-semibold", active ? "text-brand-ink" : "text-foreground")}>
          {title}
        </span>
        <span className="mt-0.5 block text-xs text-foreground-secondary">{hint}</span>
      </span>
    </button>
  );
}
