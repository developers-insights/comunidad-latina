import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import { entityAccentVar, entityHref } from "./helpers";

export interface BoostCtaProps {
  /** Vertical de la entidad (property | event | business | professional | job). */
  kind: string;
  entityId: string;
  /** Post de origen — destino de reserva si el vertical no tiene página propia. */
  postId: string;
  className?: string;
}

/**
 * Llamado a la acción de una campaña paga — SOLO en posts promocionados con
 * entidad (regla dura §6; quien renderiza esto ya validó isPromoted && entity).
 *
 * Barra translúcida sobre el borde inferior de la foto, con el MISMO lenguaje de
 * superficie que el CTA de contacto del detalle (bg-surface translúcido + blur):
 * así se lee legible y AA sobre CUALQUIER foto, sin apostar a que la foto sea
 * oscura. El acento del módulo viaja en el borde/tinte y el ícono; el texto queda
 * en `text-foreground` para no arriesgar contraste (mismo criterio que
 * EntityKindChip — el amarillo de negocios no sería AA como texto).
 *
 * El destino sale de `entityHref`. Si el vertical no tiene página propia (empleo),
 * cae al detalle del post en vez de inventar una ruta. No hay teléfono/WhatsApp
 * reales en los listings (el contacto va por RPC protegido), así que NO se
 * ofrecen botones "Llamar"/"WhatsApp": el CTA lleva a la entidad.
 */
export function BoostCta({ kind, entityId, postId, className }: BoostCtaProps) {
  const href = entityHref(kind, entityId) ?? `/feed/${postId}`;
  const label = COPY.post.boostCta[kind] ?? COPY.post.boostCtaFallback;
  const accent = entityAccentVar(kind);

  return (
    <div
      className={cn(
        "absolute inset-x-0 bottom-0 border-t border-border/50 bg-surface/90 px-3 py-2.5 backdrop-blur-md",
        className,
      )}
    >
      <Link
        href={href}
        style={{
          borderColor: `color-mix(in oklab, ${accent} 45%, transparent)`,
          backgroundColor: `color-mix(in oklab, ${accent} 12%, transparent)`,
        }}
        className={cn(
          "flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full border px-4 text-sm font-semibold text-foreground",
          "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.98]",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        {label}
        <ArrowRight size={16} aria-hidden="true" style={{ color: accent }} />
      </Link>
    </div>
  );
}
