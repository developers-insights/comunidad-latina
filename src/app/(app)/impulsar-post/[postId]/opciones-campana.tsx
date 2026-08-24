"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Megaphone, Star, Users, WhatsappLogo } from "@phosphor-icons/react/dist/ssr";
import {
  Badge,
  BezelCard,
  BottomSheet,
  Button,
  Field,
  Input,
  ProximamentePremium,
  useToast,
} from "@/components/ui";
import { formatCents, type ResolvedPrice } from "@/lib/pricing";
import type { PostPromoId, PostPromoPackage } from "@/lib/stripe";
import { cn } from "@/lib/utils";
import { crearCampanaPost } from "./actions";

/** Copy local del módulo — no toca src/lib/i18n (compartido). */
const COPY = {
  audienceTitle: "¿A quién querés llegar?",
  audienceAll: "Toda la comunidad",
  audienceAllHint: "Tu publicación aparece en el feed de todos.",
  audienceZones: "Zonas específicas",
  audienceZonesHint: "Solo en el feed de la gente de las zonas que elijas.",
  // Botón de WhatsApp de la campaña (post_promotions.cta_whatsapp): el número
  // se publica SOLO mientras la campaña corre, y solo si el anunciante lo carga.
  whatsappTitle: "¿Querés que te escriban por WhatsApp?",
  whatsappLabel: "WhatsApp para el botón de contacto",
  whatsappPlaceholder: "+1 305 555 0134",
  whatsappHelp:
    "Se muestra como un botón de WhatsApp en tu publicación mientras la campaña está activa. Si lo dejás vacío, tu número no se publica.",
  whatsappError:
    "Revisá el número: escribilo completo con código de país, por ejemplo +1 305 555 0134.",
  zonesPick: "Elegí las zonas",
  zonesEmpty: "Todavía no hay zonas para segmentar — tu campaña llega a toda la comunidad.",
  needZone: "Elegí al menos una zona, o promocioná a toda la comunidad.",
  pagoUnico: "pago único",
  recomendado: "El más elegido",
  ariaProximamente: "Las campañas, muy pronto",
  proximamenteFeature: "las campañas de publicaciones",
  demoSeal: "Modo demostración",
  demoHint: "Se activa al instante, sin cobro — para probar cómo funciona.",
  promoteWith: (nombre: string) => `Promocionar por ${nombre}`,
  activateDemo: (nombre: string) => `Activar ${nombre} (demo)`,
  demoDone: "¡Campaña activa! Tu publicación ya llega a toda la comunidad.",
  errorGenerico:
    "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo en un momento.",
} as const;

type Scope = "all" | "zones";

/**
 * Normaliza el teléfono a "+dígitos" (espejo EXACTO de la regla del server en
 * actions.ts): acá es para avisar al toque, allá es la validación que manda.
 */
function telefonoLimpio(raw: string): string {
  const digitos = raw.replace(/\D/g, "");
  return raw.trim().startsWith("+") ? `+${digitos}` : digitos;
}

const WHATSAPP_RE = /^\+?\d{8,15}$/;

export function OpcionesCampana({
  postId,
  paquetes,
  precios,
  zones,
  stripeConfigured,
  demoPermitido,
}: {
  postId: string;
  paquetes: PostPromoPackage[];
  /**
   * Precio vigente de cada paquete en esta comunidad — la misma lectura que
   * después usa `crearCampanaPost`, tanto para cobrar como para dejar asentado
   * el monto de una campaña en modo demostración.
   */
  precios: Partial<Record<PostPromoId, ResolvedPrice>>;
  zones: string[];
  stripeConfigured: boolean;
  /**
   * ¿El modo demostración está habilitado? Sin Stripe Y sin deploy de por medio.
   *
   * NO alcanza con `!stripeConfigured`: producción sin `STRIPE_SECRET_KEY` no
   * puede regalar campañas, tiene que decir "muy pronto" como los otros seis
   * productos. Ver `isPagosDemoPermitido` en `lib/config/services.ts`.
   */
  demoPermitido: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [scope, setScope] = useState<Scope>("all");
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [whatsapp, setWhatsapp] = useState("");
  const [whatsappError, setWhatsappError] = useState<string | null>(null);
  const [loadingPaquete, setLoadingPaquete] = useState<PostPromoId | null>(null);
  const [proximamenteOpen, setProximamenteOpen] = useState(false);

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

    // WhatsApp es opcional; si escribieron algo, tiene que servir como número.
    const ctaWhatsapp = telefonoLimpio(whatsapp);
    if (ctaWhatsapp !== "" && !WHATSAPP_RE.test(ctaWhatsapp)) {
      setWhatsappError(COPY.whatsappError);
      return;
    }
    setWhatsappError(null);

    setLoadingPaquete(paquete);
    try {
      const result = await crearCampanaPost({
        postId,
        paquete,
        audience,
        ctaWhatsapp: ctaWhatsapp || null,
      });
      if (result.status === "redirect") {
        window.location.assign(result.url);
        return; // mantiene el spinner hasta que navega
      }
      if (result.status === "demo_activada") {
        toast({ title: COPY.demoDone, variant: "success" });
        router.refresh(); // la página pasa a mostrar el estado "campaña activa"
        return;
      }
      if (result.status === "no_configurado") {
        // Estado premium, NUNCA un error técnico (§5.6) — igual que los otros
        // seis productos.
        setProximamenteOpen(true);
        setLoadingPaquete(null);
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

      {/* Botón de WhatsApp — opcional, vive solo mientras dura la campaña */}
      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-foreground">
          <WhatsappLogo size={20} weight="fill" aria-hidden="true" className="text-brand" />
          {COPY.whatsappTitle}
        </h2>
        <Field
          htmlFor="cta-whatsapp"
          label={COPY.whatsappLabel}
          help={COPY.whatsappHelp}
          error={whatsappError ?? undefined}
          optional
        >
          <Input
            id="cta-whatsapp"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={40}
            value={whatsapp}
            placeholder={COPY.whatsappPlaceholder}
            aria-invalid={whatsappError ? true : undefined}
            aria-describedby={
              whatsappError ? "cta-whatsapp-error" : "cta-whatsapp-help"
            }
            onChange={(event) => {
              setWhatsapp(event.target.value);
              if (whatsappError) setWhatsappError(null);
            }}
          />
        </Field>
      </section>

      {/* Paquetes */}
      <section className="flex flex-col gap-4">
        {demoPermitido && (
          <div className="flex items-center gap-2 rounded-lg bg-surface-subtle px-3.5 py-2.5">
            <Badge variant="warning" className="shrink-0">
              {COPY.demoSeal}
            </Badge>
            <p className="text-xs text-foreground-secondary">{COPY.demoHint}</p>
          </div>
        )}

        {paquetes.map((paquete) => {
          const precio = precios[paquete.id] ?? null;
          return (
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

            {precio && (
              <p className="flex items-baseline gap-1.5">
                <span className="numeric font-display text-3xl font-bold text-foreground">
                  {formatCents(precio.amountCents, precio.currency)}
                </span>
                {/* "pago único" nunca se separa del número: es lo que impide
                    leer un total como si fuera una tarifa por período. */}
                <span className="text-sm text-foreground-secondary">{COPY.pagoUnico}</span>
              </p>
            )}

            <Button
              variant={paquete.recomendado ? "primary" : "outline"}
              size="lg"
              className="w-full"
              loading={loadingPaquete === paquete.id}
              onClick={() => elegir(paquete.id)}
            >
              <Megaphone size={18} weight="fill" aria-hidden="true" />
              {demoPermitido
                ? COPY.activateDemo(paquete.nombre)
                : COPY.promoteWith(paquete.nombre)}
            </Button>
          </BezelCard>
          );
        })}
      </section>

      {/* Stripe sin configurar en un entorno publicado → estado premium. */}
      <BottomSheet
        open={proximamenteOpen}
        onClose={() => setProximamenteOpen(false)}
        ariaLabel={COPY.ariaProximamente}
      >
        <ProximamentePremium feature={COPY.proximamenteFeature} />
      </BottomSheet>
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
