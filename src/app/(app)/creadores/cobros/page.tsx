import Link from "next/link";
import { Bank, CheckCircle, Clock, ShieldCheck, SignIn, Warning } from "@phosphor-icons/react/dist/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BezelCard, EmptyState, buttonVariants } from "@/components/ui";
import { formatCents } from "@/components/creators";
import { PAYOUT_COPY } from "@/components/creators/flow-copy";
import { PayoutCta } from "@/components/creators/payout-cta";
import { isStripeConfigured } from "@/lib/config/services";
import { payoutReadiness } from "@/lib/creators/gig-payments";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";

export const metadata = { title: "Cobros" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CobrosPage({ searchParams }: { searchParams: SearchParams }) {
  const [tenant, typed, sp] = await Promise.all([getTenant(), createClient(), searchParams]);
  const supabase = typed as unknown as SupabaseClient;
  const {
    data: { user },
  } = await typed.auth.getUser();

  if (!user) {
    return (
      <EmptyState
        icon={<SignIn />}
        title={PAYOUT_COPY.title}
        message={PAYOUT_COPY.needsLogin}
        action={
          <Link
            href={`/entrar?next=${encodeURIComponent("/creadores/cobros")}`}
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            Entrar
          </Link>
        }
        className="py-20"
      />
    );
  }

  const [{ data: creator }, { data: account }, { data: pending }] = await Promise.all([
    supabase.from("creator_profiles").select("profile_id").eq("profile_id", user.id).eq("tenant_id", tenant.id).maybeSingle(),
    supabase
      .from("connected_accounts")
      .select("stripe_account_id, capabilities, details_submitted, requirements_due")
      .eq("owner_type", "creator")
      .eq("owner_ref", user.id)
      .maybeSingle(),
    supabase
      .from("gig_contracts")
      .select("creator_net_cents, currency")
      .eq("creator_id", user.id)
      .eq("status", "approved"),
  ]);

  if (!creator) {
    return (
      <EmptyState
        icon={<Bank />}
        title={PAYOUT_COPY.title}
        message={PAYOUT_COPY.notCreator}
        action={
          <Link href="/creadores/perfil" className={buttonVariants({ variant: "primary", size: "md" })}>
            {PAYOUT_COPY.notCreatorCta}
          </Link>
        }
        className="py-20"
      />
    );
  }

  const acct = account as {
    stripe_account_id: string | null;
    capabilities: unknown;
    details_submitted: boolean;
    requirements_due: unknown;
  } | null;
  const readiness = payoutReadiness(acct);
  const due = Array.isArray(acct?.requirements_due) ? acct!.requirements_due.length : 0;
  const pendingRows = (pending ?? []) as { creator_net_cents: number | null; currency: string }[];
  const pendingCents = pendingRows.reduce((sum, row) => sum + (row.creator_net_cents ?? 0), 0);
  const estado = typeof sp.estado === "string" ? sp.estado : null;

  const status =
    readiness === "ready"
      ? { icon: CheckCircle, tone: "success" as const, title: PAYOUT_COPY.statusReady, body: PAYOUT_COPY.statusReadyBody }
      : readiness === "incomplete"
        ? { icon: Clock, tone: "warning" as const, title: PAYOUT_COPY.statusIncomplete, body: PAYOUT_COPY.statusIncompleteBody }
        : { icon: Bank, tone: "default" as const, title: PAYOUT_COPY.statusMissing, body: PAYOUT_COPY.intro };

  return (
    <div className="flex flex-col gap-5 pb-6">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">{PAYOUT_COPY.title}</h1>
        <p className="mt-1 text-sm text-foreground-secondary">{PAYOUT_COPY.subtitle}</p>
      </header>

      {estado === "vuelta" && (
        <p role="status" className="rounded-2xl bg-info-bg px-4 py-3 text-sm text-info-ink">
          {PAYOUT_COPY.returned}
        </p>
      )}
      {estado === "error" && (
        <p role="alert" className="flex items-center gap-2 rounded-2xl bg-danger-bg px-4 py-3 text-sm text-danger-ink">
          <Warning size={16} weight="fill" aria-hidden="true" />
          {PAYOUT_COPY.error}
        </p>
      )}

      <BezelCard variant={status.tone} coreClassName="flex flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-2xl",
              status.tone === "success" ? "bg-success-bg text-success-ink" : "bg-surface-subtle text-foreground-secondary",
            )}
          >
            <status.icon size={22} weight="duotone" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold leading-snug text-foreground">{status.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">{status.body}</p>
            {readiness === "incomplete" && due > 0 && (
              <p className="mt-1 text-xs font-semibold text-warning-ink">{PAYOUT_COPY.due(due)}</p>
            )}
          </div>
        </div>

        {pendingCents > 0 && readiness !== "ready" && (
          <p className="rounded-2xl bg-warning-bg px-4 py-3 text-sm font-medium text-foreground">
            {PAYOUT_COPY.pending(formatCents(pendingCents, pendingRows[0]?.currency ?? "usd"), pendingRows.length)}
          </p>
        )}

        {!isStripeConfigured ? (
          <p className="text-sm text-foreground-muted">{PAYOUT_COPY.unavailable}</p>
        ) : readiness === "ready" ? (
          acct?.details_submitted && <PayoutCta mode="dashboard" variant="outline" label={PAYOUT_COPY.dashboard} className="w-full" />
        ) : (
          <PayoutCta label={readiness === "incomplete" ? PAYOUT_COPY.resume : PAYOUT_COPY.start} className="w-full" />
        )}
      </BezelCard>

      <ul className="flex flex-col gap-2">
        {PAYOUT_COPY.facts.map((fact) => (
          <li key={fact} className="flex items-start gap-2.5 text-sm leading-relaxed text-foreground-secondary">
            <ShieldCheck size={17} aria-hidden="true" className="mt-0.5 shrink-0 text-foreground-muted" />
            {fact}
          </li>
        ))}
      </ul>
    </div>
  );
}
