import { ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { BezelCard } from "@/components/ui";
import { cn } from "@/lib/utils";
import { contractBreakdown } from "./money";
import { DemoSeal } from "./demo-seal";
import { COPY } from "./copy";

export interface ContractBreakdownProps {
  amountCents: number;
  platformFeeCents: number | null;
  creatorNetCents: number | null;
  feePct: number;
  currency?: string;
}

/**
 * Desglose SIEMPRE visible del pago en garantía (monto / comisión 20% / neto del
 * creador) con los valores GENERADOS por la DB. BezelCard "featured" (tinte de
 * marca) + sello de modo demostración. La pieza de confianza de la pantalla.
 */
export function ContractBreakdown(props: ContractBreakdownProps) {
  const b = contractBreakdown(props);

  return (
    <BezelCard variant="featured" coreClassName="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck size={20} weight="fill" aria-hidden="true" className="text-brand" />
        <h3 className="font-display text-base font-bold text-foreground">
          {COPY.contract.breakdownTitle}
        </h3>
        <DemoSeal className="ml-auto" />
      </div>

      <dl className="flex flex-col gap-2.5">
        <Row label={COPY.contract.breakdownAmount} value={b.amountLabel} />
        <Row label={COPY.contract.breakdownFee(b.feePct)} value={`− ${b.feeLabel}`} muted />
        <div className="mt-1 border-t border-border-subtle pt-3">
          <Row label={COPY.contract.breakdownNet} value={b.netLabel} strong />
        </div>
      </dl>

      <p className="text-xs leading-relaxed text-foreground-muted">{COPY.contract.demoNote}</p>
    </BezelCard>
  );
}

function Row({
  label,
  value,
  muted = false,
  strong = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={cn("text-sm", strong ? "font-semibold text-foreground" : "text-foreground-secondary")}>
        {label}
      </dt>
      <dd
        className={cn(
          "numeric shrink-0 tabular-nums",
          strong
            ? "font-display text-xl font-bold text-brand"
            : muted
              ? "text-sm font-medium text-foreground-secondary"
              : "text-base font-semibold text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
