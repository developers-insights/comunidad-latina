import type { IdentidadActiva } from "@/lib/perfil-activo/identidad";
import { PLAN_IDS, type PlanId } from "@/lib/stripe";

export interface CuentaPresencia {
  id: string;
  name: string;
  plan?: string | null;
  plan_status?: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id?: string | null;
}

export const COLUMNAS_CUENTA =
  "id, name, plan, plan_status, stripe_customer_id, stripe_subscription_id";

export type CuentaElegida<C> =
  | { tipo: "cuenta"; cuenta: C }
  | { tipo: "ninguna" }
  | { tipo: "ambigua" };

/**
 * `cuentas` tiene que venir YA filtrada por dueño y comunidad: esta función sólo
 * elige entre las propias. Con la identidad activa en un negocio que no está en
 * la lista (uno que la persona administra pero no es suya) devuelve "ninguna",
 * nunca la de otra persona.
 */
export function elegirCuenta<C extends { id: string }>(
  identidad: IdentidadActiva,
  cuentas: readonly C[],
): CuentaElegida<C> {
  if (identidad.tipo === "negocio") {
    const activa = cuentas.find((cuenta) => cuenta.id === identidad.negocio.businessId);
    return activa ? { tipo: "cuenta", cuenta: activa } : { tipo: "ninguna" };
  }
  if (cuentas.length === 1) return { tipo: "cuenta", cuenta: cuentas[0] };
  return cuentas.length === 0 ? { tipo: "ninguna" } : { tipo: "ambigua" };
}

/**
 * `.deleted` del webhook deja `plan='none'` + `canceled`; `.updated` escribe el
 * status crudo de Stripe, así que `past_due`/`unpaid` siguen siendo un plan
 * vigente (se está reintentando el cobro y hay que poder cambiar la tarjeta).
 */
export function planVigente(cuenta: CuentaPresencia | null | undefined): PlanId | null {
  if (!cuenta?.plan || cuenta.plan_status === "canceled") return null;
  return (PLAN_IDS as readonly string[]).includes(cuenta.plan) ? (cuenta.plan as PlanId) : null;
}
