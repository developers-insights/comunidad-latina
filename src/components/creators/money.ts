import { formatMoney } from "@/lib/utils";

/**
 * Formateo de plata del Creator Marketplace. Los contratos guardan montos en
 * CENTAVOS (amount_cents), así que todo pasa por acá para no equivocar la
 * escala. Módulo puro y testeable.
 */

/** Centavos → USD legible. `$1,000` para montos enteros, `$66.67` si hay cents. */
export function formatCents(cents: number, currency = "USD"): string {
  return formatMoney(cents / 100, { currency: currency.toUpperCase() });
}

export interface ContractBreakdown {
  /** Monto acordado. */
  amountLabel: string;
  /** Fee de la plataforma (fee_pct % del monto). */
  feeLabel: string;
  /** Lo que recibe el creador (monto − fee). */
  netLabel: string;
  feePct: number;
}

/**
 * Desglose SIEMPRE visible del contrato (monto / fee 20% / neto del creador).
 * REGLA (feedback cliente): se leen los valores GENERADOS por la DB
 * (platform_fee_cents, creator_net_cents) — no se recalculan. El fallback solo
 * cubre el caso imposible de un valor null (la columna es STORED generated),
 * para nunca romper el formateo.
 *
 * Ejemplo del cliente: $1000 → $200 de fee (20%) + $800 para el creador.
 */
export function contractBreakdown(input: {
  amountCents: number;
  platformFeeCents: number | null;
  creatorNetCents: number | null;
  feePct: number;
  currency?: string;
}): ContractBreakdown {
  const currency = (input.currency ?? "usd").toUpperCase();
  const fee =
    input.platformFeeCents ?? Math.trunc((input.amountCents * input.feePct) / 100);
  const net = input.creatorNetCents ?? input.amountCents - fee;
  return {
    amountLabel: formatCents(input.amountCents, currency),
    feeLabel: formatCents(fee, currency),
    netLabel: formatCents(net, currency),
    feePct: input.feePct,
  };
}

/** Dólares → centavos enteros (para prellenar el monto de un contrato). */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}
