import type { ReactNode } from "react";
import {
  ArrowsClockwise,
  Bank,
  ChartLineUp,
  CheckCircle,
  ChatCircle,
  CircleNotch,
  FileText,
  Folder,
  Prohibit,
  Receipt,
  ShieldCheck,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import { BezelCard, EmptyState } from "@/components/ui";
import { cn } from "@/lib/utils";
import { EVENT_COPY, FLOW_COPY } from "./flow-copy";

export function ProposalCard({
  title,
  scope,
  deliveryDays,
  revisionsIncluded,
  usageRights,
  amountLabel,
  message,
  lastChangeRequest,
}: {
  title: string;
  scope: string;
  deliveryDays: number;
  revisionsIncluded: number;
  usageRights: string;
  amountLabel: string;
  message: string | null;
  lastChangeRequest: { note: string; byYou: boolean } | null;
}) {
  const P = FLOW_COPY.proposal;
  return (
    <BezelCard coreClassName="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <FileText size={20} weight="duotone" aria-hidden="true" className="text-[var(--accent-creadores)]" />
        <h2 className="font-display text-lg font-bold text-foreground">{P.title}</h2>
      </div>
      <p className="font-display text-xl font-bold leading-snug text-foreground">{title}</p>
      <dl className="grid gap-3">
        <Item label={P.deliverables} value={scope} multiline />
        <div className="grid grid-cols-2 gap-3">
          <Item label={P.delivery} value={P.deliveryValue(deliveryDays)} />
          <Item label={P.revisions} value={P.revisionsValue(revisionsIncluded)} />
          <Item label={P.usageRights} value={usageRights} />
          <Item label={P.amount} value={amountLabel} emphasis />
        </div>
      </dl>
      {message && (
        <blockquote className="rounded-2xl bg-surface-subtle px-4 py-3">
          <p className="text-xs font-medium text-foreground-muted">{P.messageFrom}</p>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground">{message}</p>
        </blockquote>
      )}
      {lastChangeRequest && (
        <div className="flex items-start gap-2 rounded-2xl bg-warning-bg px-4 py-3">
          <ArrowsClockwise size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-warning-ink" />
          <div>
            <p className="text-xs font-semibold text-warning-ink">{P.lastChangeRequest}</p>
            <p className="mt-0.5 whitespace-pre-line text-sm leading-relaxed text-foreground">{lastChangeRequest.note}</p>
          </div>
        </div>
      )}
    </BezelCard>
  );
}

function Item({
  label,
  value,
  multiline = false,
  emphasis = false,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-surface-subtle px-3.5 py-2.5">
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-foreground-muted">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 text-sm text-foreground",
          multiline && "whitespace-pre-line leading-relaxed",
          emphasis && "numeric font-display text-lg font-bold text-brand-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export function WorkspaceTiles({
  chat,
  filesCount,
  contractSheet,
  paymentLabel,
  paymentStateLabel,
}: {
  chat: ReactNode;
  filesCount: number;
  contractSheet: ReactNode;
  paymentLabel: string;
  paymentStateLabel: string;
}) {
  const W = FLOW_COPY.work;
  return (
    <BezelCard coreClassName="flex flex-col gap-3 p-5">
      <h3 className="font-display text-base font-bold text-foreground">{W.workspace}</h3>
      <div className="grid grid-cols-2 gap-2">
        <Tile icon={<ChatCircle size={20} weight="duotone" aria-hidden="true" />} label={W.messages}>
          {chat}
        </Tile>
        <Tile icon={<Folder size={20} weight="duotone" aria-hidden="true" />} label={W.files}>
          <span className="numeric font-display text-xl font-bold text-foreground">{filesCount}</span>
        </Tile>
        <Tile icon={<FileText size={20} weight="duotone" aria-hidden="true" />} label={W.contract}>
          {contractSheet}
        </Tile>
        <Tile icon={<ShieldCheck size={20} weight="duotone" aria-hidden="true" />} label={W.payment}>
          <span className="numeric text-sm font-bold text-foreground">{paymentLabel}</span>
          <span className="text-xs text-success-ink">{paymentStateLabel}</span>
        </Tile>
      </div>
    </BezelCard>
  );
}

function Tile({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-28 flex-col justify-between gap-2 rounded-2xl bg-surface-subtle p-3">
      <div className="flex items-center gap-2 text-foreground-secondary">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="flex flex-col items-start gap-0.5">{children}</div>
    </div>
  );
}

export type ReleaseState =
  | { kind: "released"; demo: boolean }
  | { kind: "blocked"; role: "client" | "creator" }
  | { kind: "failed" }
  | { kind: "pending" };

export function ReleaseSummary({
  state,
  netLabel,
  feeLabel,
  communityName,
  approvedAtLabel,
  releasedAtLabel,
  approvedAuto,
  receiptUrl,
  payoutCta,
  contractSheet,
}: {
  state: ReleaseState;
  netLabel: string;
  feeLabel: string;
  communityName: string;
  approvedAtLabel: string | null;
  releasedAtLabel: string | null;
  approvedAuto: boolean;
  receiptUrl: string | null;
  payoutCta: ReactNode;
  contractSheet: ReactNode;
}) {
  const R = FLOW_COPY.release;
  const released = state.kind === "released";
  return (
    <BezelCard variant={released ? "success" : "default"} coreClassName="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        {released ? (
          <CheckCircle size={22} weight="fill" aria-hidden="true" className="text-success" />
        ) : (
          <Bank size={22} weight="duotone" aria-hidden="true" className="text-foreground-secondary" />
        )}
        <h2 className="font-display text-lg font-bold text-foreground">{released ? R.title : R.approvedTitle}</h2>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-surface-subtle px-3.5 py-3">
          <p className="text-xs text-foreground-muted">{R.toCreator}</p>
          <p className="numeric font-display text-xl font-bold text-foreground">{netLabel}</p>
        </div>
        <div className="rounded-2xl bg-surface-subtle px-3.5 py-3">
          <p className="text-xs text-foreground-muted">{R.toPlatform(communityName)}</p>
          <p className="numeric font-display text-xl font-bold text-foreground-secondary">{feeLabel}</p>
        </div>
      </div>

      <ol className="flex flex-col">
        <TimelineStep done label={R.timelineApproved} detail={approvedAtLabel} />
        <TimelineStep done={released} label={R.timelineReleased} detail={releasedAtLabel} />
        {!(released && state.demo) && (
          <TimelineStep
            done={false}
            processing={released}
            label={R.timelineBank}
            detail={released ? `${R.bankProcessing} · ${R.bankHint}` : null}
            last
          />
        )}
      </ol>

      {approvedAuto && <p className="text-xs text-foreground-muted">{R.approvedAuto}</p>}
      {state.kind === "released" && state.demo && <p className="text-xs text-foreground-muted">{R.demo}</p>}
      {state.kind === "blocked" && (
        <div className="flex flex-col gap-3 rounded-2xl bg-warning-bg px-4 py-3">
          <p className="text-sm leading-relaxed text-foreground">
            {state.role === "creator" ? R.blockedCreator : R.blockedClient}
          </p>
          {state.role === "creator" && payoutCta}
        </div>
      )}
      {state.kind === "failed" && <p className="rounded-2xl bg-warning-bg px-4 py-3 text-sm text-foreground">{R.failed}</p>}

      <div className="flex flex-wrap gap-2">
        {receiptUrl && (
          <a
            href={receiptUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-subtle"
          >
            <Receipt size={16} aria-hidden="true" />
            {R.receipt}
          </a>
        )}
        {contractSheet}
      </div>
    </BezelCard>
  );
}

function TimelineStep({
  done,
  processing = false,
  label,
  detail,
  last = false,
}: {
  done: boolean;
  processing?: boolean;
  label: string;
  detail: string | null;
  last?: boolean;
}) {
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-full",
            done ? "bg-success-bg text-success-ink" : "bg-surface-subtle text-foreground-muted ring-1 ring-border",
          )}
        >
          {done ? (
            <CheckCircle size={14} weight="bold" aria-hidden="true" />
          ) : processing ? (
            <CircleNotch size={13} aria-hidden="true" className="animate-spin [animation-duration:2.4s]" />
          ) : null}
        </span>
        {!last && <span aria-hidden="true" className="w-px flex-1 bg-border" />}
      </div>
      <div className="pb-4">
        <p className={cn("text-sm font-medium", done ? "text-foreground" : "text-foreground-secondary")}>{label}</p>
        {detail && <p className="text-xs text-foreground-muted">{detail}</p>}
      </div>
    </li>
  );
}

export interface HistoryEntry {
  id: string;
  kind: string;
  actorLabel: string;
  note: string | null;
  atLabel: string;
}

export function ContractHistory({ entries }: { entries: HistoryEntry[] }) {
  const H = FLOW_COPY.history;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display text-base font-bold text-foreground">{H.title}</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-foreground-muted">{H.empty}</p>
      ) : (
        <ol className="flex flex-col">
          {entries.map((entry, index) => (
            <li key={entry.id} className="flex items-start gap-3">
              <div className="flex flex-col items-center self-stretch">
                <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-[var(--accent-creadores)]" />
                {index < entries.length - 1 && <span aria-hidden="true" className="w-px flex-1 bg-border" />}
              </div>
              <div className="min-w-0 pb-4">
                <p className="text-sm font-medium text-foreground">{EVENT_COPY[entry.kind] ?? entry.kind}</p>
                <p className="text-xs text-foreground-muted">
                  {entry.actorLabel} · <span className="numeric">{entry.atLabel}</span>
                </p>
                {entry.note && (
                  <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs leading-relaxed text-foreground-secondary">
                    {entry.note}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function CampaignMetrics() {
  const M = FLOW_COPY.metrics;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display text-base font-bold text-foreground">{M.title}</h2>
      <EmptyState
        icon={<ChartLineUp />}
        title={M.emptyTitle}
        message={M.emptyBody}
        className="rounded-2xl bg-surface-subtle"
      />
      <p className="text-xs text-foreground-muted">{M.note}</p>
    </section>
  );
}

export function StateNotice({
  tone,
  title,
  body,
}: {
  tone: "warning" | "neutral" | "danger";
  title: string;
  body: string;
}) {
  const Icon = tone === "warning" ? Warning : Prohibit;
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-2xl px-4 py-3.5",
        tone === "warning" ? "bg-warning-bg" : tone === "danger" ? "bg-danger-bg" : "bg-surface-subtle",
      )}
    >
      <Icon
        size={20}
        weight="fill"
        aria-hidden="true"
        className={cn(
          "mt-0.5 shrink-0",
          tone === "warning" ? "text-warning-ink" : tone === "danger" ? "text-danger-ink" : "text-foreground-muted",
        )}
      />
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-foreground-secondary">{body}</p>
      </div>
    </div>
  );
}
