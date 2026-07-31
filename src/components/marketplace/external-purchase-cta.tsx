import Link from "next/link";
import {
  ArrowUpRight,
  Info,
  ShieldWarning,
  ShoppingBagOpen,
} from "@phosphor-icons/react/dist/ssr";
import { BezelCard, buttonVariants } from "@/components/ui";
import { safeExternalHref } from "@/lib/url/safe-href";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import { EXTERNAL_CHECKOUT_FACTS } from "./membership";

/**
 * =============================================================================
 * COMPRAR — el checkout ocurre AFUERA (spec §7)
 * =============================================================================
 *
 * Comunidad Latina no procesa el pago, ni el envío, ni las devoluciones, ni las
 * garantías, ni el inventario. Eso no es una limitación temporal: ES el modelo
 * (por eso no hay comisión por venta). Y por eso el aviso va ARRIBA del botón,
 * en el mismo bloque y con el mismo peso visual — no en un asterisco debajo.
 *
 * La regla que aplicamos: si alguien pierde plata en una compra hecha desde
 * acá, la pregunta no puede ser "¿estaba escrito en algún lado?" sino "¿lo
 * leyó antes de tocar?". Un disclaimer que hay que buscar es un disclaimer que
 * no cumple su función.
 *
 * SEGURIDAD DEL DESTINO: la URL la cargó un comercio, no el código. Pasa
 * SIEMPRE por `safeExternalHref`, que clasifica por ORIGEN RESUELTO y no por
 * prefijo de string (`//evil.com` y `/\evil.com` engañan a un `startsWith`) y
 * sólo admite http/https — `javascript:` y `data:` devuelven null.
 *
 * `null` significa "no muestres el botón", NO "mostralo roto": sin destino
 * verificable la persona se queda con el chat interno, que es el canal
 * protegido y siempre está.
 */

export interface ExternalPurchaseCtaProps {
  /** `listings.cta_purchase_url` — cargada por el comercio, nunca por el código. */
  purchaseUrl: string | null | undefined;
  /** Nombre del negocio, para que el botón diga a dónde lleva. */
  storeName: string | null;
  className?: string;
}

export function ExternalPurchaseCta({
  purchaseUrl,
  storeName,
  className,
}: ExternalPurchaseCtaProps) {
  const target = safeExternalHref(purchaseUrl);

  // Sin destino, o con un destino que no es http(s): no hay botón. Preferimos
  // la ausencia antes que un botón que no lleva a ningún lado.
  if (!target || !target.external) return null;

  const seller = storeName ?? COPY.seller.fallbackStoreName;
  // El dominio real, a la vista: es la única forma de que alguien pueda
  // reconocer (o desconfiar de) el sitio antes de salir.
  const host = hostOf(target.href);

  return (
    <BezelCard
      variant="featured"
      coreClassName={cn("flex flex-col gap-4 p-5", className)}
    >
      <div className="flex flex-col gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Info size={17} weight="fill" aria-hidden="true" className="shrink-0 text-info" />
          {COPY.purchase.noticeTitle}
        </p>
        <ul className="flex flex-col gap-1.5 pl-1">
          {EXTERNAL_CHECKOUT_FACTS.map((fact) => (
            <li
              key={fact}
              className="flex gap-2 text-sm leading-relaxed text-foreground-secondary"
            >
              <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-foreground-muted" />
              {fact}
            </li>
          ))}
        </ul>
      </div>

      {/* Regla de oro del repo, con el peso que tiene: es la frase que evita el
          daño más caro y aparece igual en el Escudo y en las Normas. */}
      <p className="flex items-start gap-2 rounded-md border-l-4 border-warning bg-warning-bg px-3 py-2 text-sm font-medium leading-relaxed text-foreground">
        <ShieldWarning size={17} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
        {COPY.purchase.goldenRule}
      </p>

      <div className="flex flex-col gap-2">
        <a
          href={target.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          aria-label={COPY.purchase.ariaCta(seller)}
          className={cn(buttonVariants({ variant: "primary", size: "lg" }), "group w-full")}
        >
          <ShoppingBagOpen size={20} aria-hidden="true" />
          {COPY.purchase.cta}
          {/* Ícono en su propio círculo, flush con el padding del botón: el
              patrón "botón dentro del botón" del design system. El tinte sale
              de `brand-foreground` y no de un blanco literal, así el círculo
              sigue siendo visible cuando el tenant tiene marca clara. */}
          <span
            aria-hidden="true"
            className={cn(
              "ml-auto flex size-7 items-center justify-center rounded-full",
              "bg-brand-foreground/15",
              "transition-transform duration-(--duration-fast) ease-(--ease-out-premium)",
              "group-hover:translate-x-0.5 group-hover:-translate-y-px",
            )}
          >
            <ArrowUpRight size={15} weight="bold" />
          </span>
        </a>

        <p className="text-center text-xs text-foreground-muted">
          {COPY.purchase.externalHint}
          {host && (
            <>
              {" "}
              <span className="font-medium text-foreground-secondary">{host}</span>
            </>
          )}
          {" · "}
          <Link
            href="/legal/marketplace"
            className="font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink"
          >
            {COPY.purchase.policyLink}
          </Link>
        </p>
      </div>
    </BezelCard>
  );
}

/**
 * Host legible del destino. `safeExternalHref` ya garantizó que la URL parsea
 * y que es http(s), así que este `new URL` no puede tirar — el try/catch está
 * por disciplina, no por un caso conocido.
 */
function hostOf(href: string): string | null {
  try {
    return new URL(href).host;
  } catch {
    return null;
  }
}
