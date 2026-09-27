import { ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { BezelCard } from "@/components/ui";
import { cn } from "@/lib/utils";
import { contractBreakdown } from "./money";
import { DemoSeal } from "./demo-seal";
import { COPY } from "./copy";
import { FLOW_COPY } from "./flow-copy";

export interface ContractBreakdownProps {
  amountCents: number;
  platformFeeCents: number | null;
  creatorNetCents: number | null;
  feePct: number;
  currency?: string;
  demo?: boolean;
  showStripeFee?: boolean;
  netLabel?: string;
  title?: string;
  note?: string | null;
}

export function ContractBreakdown({
  demo = false,
  showStripeFee = false,
  netLabel,
  title,
  note,
  ...props
}: ContractBreakdownProps) {
  const b = contractBreakdown(props);

  return (
    <BezelCard variant="featured" coreClassName="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck size={20} weight="duotone" aria-hidden="true" className="text-brand" />
        <h3 className="font-display text-base font-bold text-foreground">{title ?? COPY.contract.breakdownTitle}</h3>
        {demo && <DemoSeal className="ml-auto" />}
      </div>

      <dl className="flex flex-col gap-2.5">
        <Row label={COPY.contract.breakdownAmount} value={b.amountLabel} />
        <Row label={COPY.contract.breakdownFee(b.feePct)} value={`− ${b.feeLabel}`} muted />
        {showStripeFee && (
          <Row label={FLOW_COPY.payment.stripeFee} value={FLOW_COPY.payment.stripeFeeValue} muted />
        )}
        <div className="mt-1 border-t border-border-subtle pt-3">
          <Row label={netLabel ?? COPY.contract.breakdownNet} value={b.netLabel} strong />
        </div>
      </dl>

      {note !== null && (
        <p className="text-xs leading-relaxed text-foreground-muted">
          {note ?? (demo ? COPY.contract.demoNote : COPY.contract.protectedNote)}
        </p>
      )}
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
