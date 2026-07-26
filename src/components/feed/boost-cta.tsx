"use client";

import Link from "next/link";
import { ArrowRight, WhatsappLogo } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import { entityAccentVar, entityHref, whatsappHref } from "./helpers";

export interface BoostCtaProps {
  /** Vertical de la entidad (property | event | business | professional | job). */
  kind: string;
  entityId: string;
  /** Post de origen — destino de reserva si el vertical no tiene página propia. */
  postId: string;
  /**
   * Teléfono que el anunciante cargó al comprar la campaña
   * (post_promotions.cta_whatsapp). Cuando viene, se suma un botón de WhatsApp
   * al lado del CTA de la entidad. Ausente → la barra queda como siempre.
   */
  ctaWhatsapp?: string | null;
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
 * cae al detalle del post en vez de inventar una ruta.
 *
 * WhatsApp: los listings NO exponen teléfono (el contacto va por RPC protegido),
 * pero una CAMPAÑA es distinta — el anunciante decide publicar su número al
 * comprarla, y solo mientras dura. Por eso el botón vive acá y no en el detalle
 * de la entidad, y convive con el CTA de siempre en lugar de reemplazarlo.
 */
export function BoostCta({
  kind,
  entityId,
  postId,
  ctaWhatsapp = null,
  className,
}: BoostCtaProps) {
  const href = entityHref(kind, entityId) ?? `/feed/${postId}`;
  const label = COPY.post.boostCta[kind] ?? COPY.post.boostCtaFallback;
  const accent = entityAccentVar(kind);
  const waHref = whatsappHref(ctaWhatsapp);

  const ctaStyle = {
    borderColor: `color-mix(in oklab, ${accent} 45%, transparent)`,
    backgroundColor: `color-mix(in oklab, ${accent} 12%, transparent)`,
  };
  const ctaClass = cn(
    "flex min-h-11 items-center justify-center gap-1.5 rounded-full border px-4 text-sm font-semibold text-foreground",
    "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.98]",
    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
  );

  return (
    <div
      className={cn(
        "absolute inset-x-0 bottom-0 flex items-center gap-2 border-t border-border/50 bg-surface/90 px-3 py-2.5 backdrop-blur-md",
        className,
      )}
    >
      <Link href={href} style={ctaStyle} className={cn(ctaClass, "min-w-0 flex-1")}>
        {label}
        <ArrowRight size={16} aria-hidden="true" style={{ color: accent }} />
      </Link>

      {waHref && (
        <a
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
          // La foto de la card escucha toques (visor / doble-tap me gusta): el
          // CTA es suyo y no debe disparar nada de eso.
          onClick={(event) => event.stopPropagation()}
          style={ctaStyle}
          className={cn(ctaClass, "shrink-0")}
        >
          <WhatsappLogo size={16} weight="fill" aria-hidden="true" style={{ color: accent }} />
          {COPY.post.boostCtaWhatsapp}
        </a>
      )}
    </div>
  );
}
