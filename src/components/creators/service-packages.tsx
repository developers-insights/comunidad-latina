import Link from "next/link";
import { Check, Clock } from "@phosphor-icons/react/dist/ssr";
import { buttonVariants } from "@/components/ui";
import { cn } from "@/lib/utils";
import { buildPackageScope, type ServicePackage } from "@/lib/creators/service-packages";
import { ContractForm } from "./contract-form";
import { formatCents } from "./money";
import { COPY } from "./copy";

/**
 * =============================================================================
 * PAQUETES DE SERVICIO — vista pública del perfil del creador (0102)
 * =============================================================================
 *
 * Server component: sólo el botón de contratar es una isla de cliente
 * (`ContractForm`, que ya existía). El resto es texto y no tiene por qué costar
 * JavaScript.
 *
 * LENGUAJE VISUAL. Se reusa el de las secciones que ya viven en esta página
 * —encabezado `font-display text-base font-bold`, tarjeta
 * `rounded-lg border border-border-subtle bg-surface`— para que "Paquetes" se
 * lea como un hermano de "Lo que hago", "Portfolio" y "Reseñas" y no como algo
 * pegado después. Lo único que se permite destacar es el PRECIO: es el dato por
 * el que alguien entra a esta sección.
 *
 * LO QUE ACÁ NO SE MUESTRA: cuánto le queda al creador después de la comisión.
 * Ese número es suyo y se lo mostramos a él en su editor. Al visitante le
 * corresponde el precio que va a pagar, y nada más — publicar el margen ajeno
 * sería filtrar el negocio de otro.
 *
 * CONTRATAR NO INVENTA UN CAMINO NUEVO. El botón abre el MISMO `ContractForm`
 * que el CTA "Proponer un trabajo" de esta página, con título, alcance y monto
 * ya cargados desde el paquete. De ahí en adelante es el flujo de siempre:
 * propuesta → aceptación → pago en garantía. No hay un checkout paralelo, y por
 * eso la comisión, el escrow y las reseñas siguen funcionando sin tocarlos.
 */

export interface ServicePackagesProps {
  packages: ServicePackage[];
  creatorId: string;
  creatorName: string;
  /** Sin sesión no se puede contratar: el CTA lleva a entrar y vuelve acá. */
  isAuthenticated: boolean;
  className?: string;
}

/** El ancla que usa el chip de "Lo que hago" para bajar hasta esta sección. */
export const SERVICE_PACKAGES_ANCHOR = "paquetes";

export function ServicePackages({
  packages,
  creatorId,
  creatorName,
  isAuthenticated,
  className,
}: ServicePackagesProps) {
  if (packages.length === 0) return null;

  return (
    <section id={SERVICE_PACKAGES_ANCHOR} className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-col gap-0.5">
        <h2 className="font-display text-base font-bold text-foreground">{COPY.packages.title}</h2>
        <p className="text-sm text-foreground-muted">{COPY.packages.subtitle}</p>
      </div>

      <ul className="flex flex-col gap-3">
        {packages.map((pkg) => (
          <li key={pkg.id} className="rounded-lg border border-border-subtle bg-surface p-4">
            {/*
              Cabecera. En 375px el título necesita `min-w-0` para poder cortar
              y el precio `shrink-0` para no partirse en dos líneas: sin eso,
              "$1,200" se rompe en "$1," / "200", que es un precio distinto.
            */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-base font-bold leading-snug text-foreground">
                  {pkg.title}
                </h3>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-foreground-muted">
                  <Clock size={13} aria-hidden="true" />
                  {COPY.packages.deliveryDays(pkg.deliveryDays)}
                </p>
              </div>
              <p className="numeric shrink-0 font-display text-xl font-bold tabular-nums text-brand">
                {formatCents(pkg.priceCents, pkg.currency)}
              </p>
            </div>

            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-foreground-secondary">
              {pkg.description}
            </p>

            {pkg.includes.length > 0 && (
              <div className="mt-3 border-t border-border-subtle pt-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                  {COPY.packages.includesTitle}
                </h4>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {pkg.includes.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-foreground-secondary">
                      <Check
                        size={15}
                        weight="bold"
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-success"
                      />
                      <span className="min-w-0">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4">
              {isAuthenticated ? (
                <ContractForm
                  creatorId={creatorId}
                  creatorName={creatorName}
                  defaultTitle={pkg.title}
                  defaultScope={buildPackageScope(pkg)}
                  defaultAmountCents={pkg.priceCents}
                  defaultDeliveryDays={pkg.deliveryDays}
                  triggerLabel={COPY.packages.hireCta}
                  triggerVariant="secondary"
                  triggerClassName="w-full"
                />
              ) : (
                <Link
                  href={`/entrar?next=${encodeURIComponent(`/creadores/perfil/${creatorId}`)}`}
                  className={cn(buttonVariants({ variant: "secondary", size: "md" }), "w-full")}
                >
                  {COPY.packages.needLoginCta}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>

      <p className="text-xs leading-relaxed text-foreground-muted">{COPY.packages.hireHint}</p>
    </section>
  );
}
