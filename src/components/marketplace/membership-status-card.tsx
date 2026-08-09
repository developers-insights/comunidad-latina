import { CheckCircle, EyeSlash, Storefront } from "@phosphor-icons/react/dist/ssr";
import { Badge, BezelCard } from "@/components/ui";
import { DEFAULT_LOCALE, formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import {
  membershipPresentation,
  type MembershipRow,
  type MembershipTone,
} from "./membership";

/**
 * ESTADO Y VENCIMIENTO DE LA MEMBRESÍA, para el dueño de la tienda (spec §7).
 *
 * Muestra tres cosas y en este orden, porque es el orden en que la persona las
 * pregunta: **¿mi tienda se ve?** → **¿en qué estado está?** → **¿hasta cuándo
 * está paga?**. El estado de facturación solo, sin la primera línea, obliga a
 * traducir "past_due" a "¿me están mostrando o no?", que es lo único que
 * importa de verdad.
 *
 * Server Component: sólo pinta datos que la página ya resolvió con la RLS del
 * dueño (`store_memberships_select` deja ver la propia). Las acciones —activar,
 * gestionar, cancelar— viven en `<MembershipActions>`, que sí es cliente.
 */

const TONE_BADGE: Record<MembershipTone, "success" | "warning" | "danger" | "neutral"> = {
  success: "success",
  warning: "warning",
  danger: "danger",
  neutral: "neutral",
};

export interface MembershipStatusCardProps {
  storeName: string;
  membership: MembershipRow | null;
  /** `listings.store_active` — lo que la comunidad realmente ve. */
  storeActive: boolean;
  locale?: string;
  /**
   * Zona de quien mira. `current_period_end` es un `timestamptz`: una renovación
   * a las 21:00 en Los Ángeles se anunciaba para el día siguiente con la zona
   * fija de la comunidad, y esa fecha es la que la persona compara con su
   * resumen de tarjeta.
   */
  timeZone?: string;
  className?: string;
  /** Botonera (client component) — la arma la página. */
  children?: React.ReactNode;
}

export function MembershipStatusCard({
  storeName,
  membership,
  storeActive,
  locale = DEFAULT_LOCALE,
  timeZone,
  className,
  children,
}: MembershipStatusCardProps) {
  const view = membershipPresentation(membership, storeActive);
  const periodEnd = membership?.currentPeriodEnd ?? null;

  // Qué se dice de la fecha depende del estado: la MISMA fecha es "se renueva"
  // si está activa, "vence" si está por caer, y "venció" si ya pasó. Decir
  // "se renueva el 30/8" en una membresía cancelada sería una mentira cortés.
  const dateLine = (() => {
    if (!periodEnd) return null;
    const label = formatDate(periodEnd, { locale, style: "long", timeZone });
    if (!label) return null;
    if (view.view === "active") return COPY.membership.renewsOn(label);
    if (view.view === "past_due") return COPY.membership.endsOn(label);
    return COPY.membership.endedOn(label);
  })();

  return (
    <BezelCard
      variant={view.storeVisible ? "success" : "default"}
      coreClassName={cn("flex flex-col gap-4 p-5", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-foreground-secondary"
          >
            <Storefront size={20} />
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-base font-bold text-foreground">
              {storeName}
            </p>
            {/* Ícono + texto, nunca sólo color: la visibilidad es la
                información de riesgo de esta tarjeta (§3.2). */}
            <p
              className={cn(
                "mt-0.5 flex items-center gap-1.5 text-sm font-medium",
                view.storeVisible ? "text-success-ink" : "text-foreground-secondary",
              )}
            >
              {view.storeVisible ? (
                <CheckCircle size={15} weight="fill" aria-hidden="true" />
              ) : (
                <EyeSlash size={15} weight="fill" aria-hidden="true" />
              )}
              {view.storeVisible ? COPY.membership.visibleNow : COPY.membership.hiddenNow}
            </p>
          </div>
        </div>

        <Badge variant={TONE_BADGE[view.tone]} className="shrink-0">
          {view.label}
        </Badge>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-sm leading-relaxed text-foreground-secondary">{view.detail}</p>
        {dateLine && (
          <p className="numeric text-sm font-medium text-foreground">{dateLine}</p>
        )}
      </div>

      {children}
    </BezelCard>
  );
}
