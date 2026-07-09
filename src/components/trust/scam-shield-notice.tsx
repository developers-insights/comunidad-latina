import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Emblem } from "@/components/ui/emblem";

/**
 * Aviso amarillo del Escudo Anti-Estafa (§4.d): posición y estilo FIJOS
 * en todos los verticales — el usuario aprende a reconocerlo. Solo cambia
 * el copy según el contexto.
 */
export type ScamShieldVariant = "rental" | "job" | "services" | "marketplace";

const COPY: Record<ScamShieldVariant, { lead: string; body: string }> = {
  rental: {
    lead: "Antes de pagar cualquier cosa:",
    body: "nunca envíes depósito ni seña sin ver el lugar en persona o por videollamada.",
  },
  job: {
    lead: "Antes de aceptar un trabajo:",
    body: "ningún empleo serio te pide dinero por adelantado. Si te piden pagar para empezar, desconfiá.",
  },
  services: {
    lead: "Antes de contratar un servicio:",
    body: "acordá el precio por escrito y pagá cuando el trabajo esté hecho. Desconfiá de quien te apura.",
  },
  marketplace: {
    lead: "Antes de comprar:",
    body: "revisá el producto en persona antes de pagar. Nunca transfieras plata a alguien que no conocés.",
  },
};

export interface ScamShieldNoticeProps {
  variant: ScamShieldVariant;
  /** Destino de "Aprender a identificar estafas". */
  learnHref?: string;
  className?: string;
}

export function ScamShieldNotice({
  variant,
  learnHref = "/escudo",
  className,
}: ScamShieldNoticeProps) {
  const copy = COPY[variant];

  return (
    <div
      role="note"
      aria-label="Aviso de seguridad"
      className={cn(
        "flex items-start gap-3 rounded-lg bg-warning-bg p-4",
        className,
      )}
    >
      {/* El emblema es la firma visual del moat: el usuario aprende a
          reconocerlo. Lazy: este aviso vive dentro del detalle de un listing,
          nunca sobre el pliegue, y el público está en datos móviles (§3.4). */}
      <Emblem name="escudo-alerta" size={40} className="-mt-0.5 shrink-0" />
      <div className="min-w-0 text-sm text-foreground">
        <p>
          <strong className="font-semibold">{copy.lead}</strong> {copy.body}
        </p>
        <a
          href={learnHref}
          className="mt-2 inline-flex items-center gap-1 font-semibold text-warning-ink underline-offset-4 hover:underline"
        >
          Aprendé a cuidarte
          <ArrowRight size={14} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
