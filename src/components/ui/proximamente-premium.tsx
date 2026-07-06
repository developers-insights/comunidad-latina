import { Sparkle } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { BezelCard } from "./bezel-card";

/**
 * Degradación elegante (§5.6 del plan): cuando un servicio no está
 * configurado (Stripe, etc.), la acción muestra esto — NUNCA un error
 * técnico crudo. Siempre un estado premium.
 */
export interface ProximamentePremiumProps {
  /** Nombre de la feature en minúscula, ej. "los pagos", "las reservas". */
  feature: string;
  /** Ícono Phosphor alternativo al Sparkle default. */
  icon?: React.ReactNode;
  className?: string;
}

export function ProximamentePremium({
  feature,
  icon,
  className,
}: ProximamentePremiumProps) {
  return (
    <BezelCard
      variant="featured"
      className={cn("w-full", className)}
      coreClassName="flex flex-col items-center gap-3 px-6 py-8 text-center"
    >
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand [&>svg]:size-6"
      >
        {icon ?? <Sparkle size={24} weight="light" />}
      </span>
      <p className="font-display text-lg font-semibold text-foreground">
        Muy pronto
      </p>
      <p className="max-w-[38ch] text-sm text-foreground-secondary">
        Estamos terminando de configurar {feature}. Va a estar disponible muy
        pronto.
      </p>
    </BezelCard>
  );
}
