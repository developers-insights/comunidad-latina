import type { SupabaseClient } from "@supabase/supabase-js";
import type { VerificacionTier } from "./catalogo";

/**
 * =============================================================================
 * CONTRATOS DEL CHECK AZUL (migración 0101)
 * =============================================================================
 *
 * Transcripción literal de la migración. Cuando el SQL y esto se contradigan,
 * manda el SQL — que no se contradigan es responsabilidad de quien toque
 * cualquiera de los dos.
 *
 * `src/lib/types/database.types.ts` está generado a la altura de la 0076, así
 * que `verification_subscriptions`, `verification_boost_grants` y las columnas
 * nuevas (`profiles.verified_badge`, `boosts.origin`) todavía no existen para
 * TypeScript. Se usa el MISMO escape acotado que ya usan reseñas y el módulo
 * Comunidad: un cast en una función de nombre feo, con las interfaces de fila
 * escritas a mano al lado de cada uso. Misma fecha de vencimiento: cuando se
 * regeneren los tipos, esto se borra y las interfaces se reemplazan por
 * `Tables<"verification_subscriptions">`.
 */

/** Los 4 estados que persiste la fila. Espeja el CHECK de 0101. */
export const VERIFICACION_STATUSES = [
  "active",
  "past_due",
  "canceled",
  "expired",
] as const;
export type VerificacionStatus = (typeof VERIFICACION_STATUSES)[number];

/** `kind` de la metadata de Stripe. Es lo que distingue estos eventos. */
export const VERIFICACION_KIND = "verificacion";

/** Fila de `verification_subscriptions`, tal como vuelve del select. */
export interface VerificacionSubscriptionRow {
  id: string;
  tenant_id: string;
  profile_id: string;
  subject_type: VerificacionTier;
  status: VerificacionStatus;
  price_cents: number;
  currency: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  started_at: string | null;
  canceled_at: string | null;
}

/** Estados de un crédito de impulso. Espeja el CHECK de 0101. */
export const GRANT_STATUSES = ["pendiente", "usado", "vencido"] as const;
export type GrantStatus = (typeof GRANT_STATUSES)[number];

/** Fila de `verification_boost_grants`. */
export interface VerificacionGrantRow {
  id: string;
  tenant_id: string;
  subscription_id: string;
  profile_id: string;
  period_start: string;
  duration_days: number;
  status: GrantStatus;
  boost_id: string | null;
  expires_at: string;
  granted_at: string;
  redeemed_at: string | null;
}

/**
 * ¿Un crédito se puede canjear AHORA?
 *
 * Función pura y única fuente de esta regla: la usan la server action de canje,
 * la pantalla que decide si mostrar el botón y sus tests. Tener la condición
 * escrita en tres lugares es cómo se termina con un botón que se ve pero no
 * funciona.
 *
 * `expires_at` se compara contra el reloj de QUIEN PREGUNTA y no contra el de la
 * base: es una lectura optimista para la UI. La palabra final la tiene el
 * `update ... where status = 'pendiente'` de la action, que es atómico.
 */
export function grantEsCanjeable(
  grant: Pick<VerificacionGrantRow, "status" | "expires_at">,
  ahora: Date = new Date(),
): boolean {
  if (grant.status !== "pendiente") return false;
  const vence = Date.parse(grant.expires_at);
  if (!Number.isFinite(vence)) return false;
  return vence > ahora.getTime();
}

/**
 * ¿Esta cuenta lleva el check azul puesto?
 *
 * La insignia se pinta SÓLO con `status === 'active'`. `past_due` NO la pinta:
 * es una cobranza que todavía se reintenta, y mientras tanto la insignia dice
 * "esta cuenta paga" — que en ese momento no es cierto. Es la diferencia con la
 * membresía de tienda, donde `past_due` mantiene la vidriera prendida a
 * propósito: apagar una tienda por un rebote de tarjeta le corta las ventas a
 * alguien, mientras que sostener una insignia impaga le miente a la comunidad.
 * El período de gracia acá lo da el cron de 0101 (dos días), no el estado.
 */
export function llevaCheckAzul(
  row: Pick<VerificacionSubscriptionRow, "status"> | null | undefined,
): boolean {
  return row?.status === "active";
}

// ===========================================================================
// El escape de tipado
// ===========================================================================

/**
 * Cast acotado para las cosas de la 0101 que el archivo de tipos generado
 * todavía no conoce.
 *
 * Nombre feo a propósito, misma convención que `supabaseSinTiparComunidad`:
 * tiene que ser imposible usarlo sin darse cuenta de que ahí se pierde el
 * tipado. Cada uso va pegado a la interfaz de fila que corresponde, así el
 * tipado se pierde en el borde y se recupera en la línea siguiente.
 */
export function supabaseSinTiparVerificacion(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}
