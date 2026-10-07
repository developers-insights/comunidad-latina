import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, ChatCircle, Star } from "@phosphor-icons/react/dist/ssr";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MessageCta } from "@/components/auth/message-cta";
import { Avatar } from "@/components/ui";
import {
  COPY,
  ContractBreakdownCard,
  ContractStatusBadge,
  ContractStepper,
  ReviewForm,
  formatCents,
  roleOf,
} from "@/components/creators";
import { asContractStatus } from "@/components/creators/contract-machine";
import { ContractDocumentSheet, type SignatureView } from "@/components/creators/contract-document-sheet";
import { ContractLiveRefresh } from "@/components/creators/contract-live-refresh";
import {
  CampaignMetrics,
  ContractHistory,
  ProposalCard,
  ReleaseSummary,
  StateNotice,
  WorkspaceTiles,
  type HistoryEntry,
  type ReleaseState,
} from "@/components/creators/contract-sections";
import { FLOW_COPY } from "@/components/creators/flow-copy";
import { PaymentPanel } from "@/components/creators/payment-panel";
import { PayoutCta } from "@/components/creators/payout-cta";
import { ProposalActions } from "@/components/creators/proposal-actions";
import { DeliveryFiles, ReviewPanel, type DeliveryView } from "@/components/creators/review-panel";
import { SigningPanel } from "@/components/creators/signing-panel";
import { WorkPanel } from "@/components/creators/work-panel";
import { cancellationClauses } from "@/lib/creators/contract-terms";
import { PARTY_CONTRACT_COLUMNS, type PartyContract } from "@/lib/creators/contract-access";
import { displayNameFromPath } from "@/lib/creators/delivery-files";
import { payoutReadiness } from "@/lib/creators/gig-payments";
import { formatJobCode } from "@/lib/creators/job-code";
import { createClient, getAuthUserId } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn, formatDate } from "@/lib/utils";

export const metadata = { title: "Colaboración" };

type DetailContract = PartyContract & {
  code_legacy: string | null;
  created_at: string;
  approved_at: string | null;
  released_at: string | null;
  approved_via: string | null;
  stripe_receipt_url: string | null;
  stripe_transfer_id: string | null;
};

const DETAIL_COLUMNS = `${PARTY_CONTRACT_COLUMNS}, code_legacy, created_at, approved_at, released_at, approved_via, stripe_receipt_url, stripe_transfer_id`;

interface EventRow {
  id: string;
  kind: string;
  actor_id: string | null;
  note: string | null;
  created_at: string;
}

export default async function ContractDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();

  const [tenant, typed] = await Promise.all([getTenant(), createClient()]);
  const supabase = typed as unknown as SupabaseClient;
  const userId = await getAuthUserId();
  if (!userId) redirect(`/entrar?next=${encodeURIComponent(`/creadores/colaboraciones/${id}`)}`);

  const { data: raw } = await supabase.from("gig_contracts").select(DETAIL_COLUMNS).eq("id", id).maybeSingle();
  const contract = raw as DetailContract | null;
  if (!contract || contract.tenant_id !== tenant.id) notFound();
  const status = asContractStatus(contract.status);
  if (!status) notFound();

  const role = roleOf(userId, contract);
  if (role === "other") notFound();
  const counterpartId = role === "client" ? contract.creator_id : contract.client_id;

  const [profilesRes, reviewsRes, signaturesRes, eventsRes, milestonesRes, deliverablesRes, revisionsRes, conversationRes, accountRes] =
    await Promise.all([
      supabase.from("profiles").select("id, display_name, avatar_url").in("id", [contract.client_id, contract.creator_id]),
      supabase.from("gig_reviews").select("id, reviewer_id, rating, body").eq("contract_id", id),
      supabase
        .from("gig_contract_signatures")
        .select("signer_role, legal_name, signature_png, terms_hash, signed_at")
        .eq("contract_id", id)
        .order("signed_at", { ascending: true }),
      supabase
        .from("gig_contract_events")
        .select("id, kind, actor_id, note, created_at")
        .eq("contract_id", id)
        .order("created_at", { ascending: true })
        .limit(200),
      supabase.from("gig_contract_milestones").select("id, title, done_at").eq("contract_id", id).order("position"),
      supabase
        .from("job_deliverables")
        .select("version, files, note, created_at")
        .eq("contract_id", id)
        .order("version", { ascending: false }),
      supabase.from("job_revisions").select("id", { count: "exact", head: true }).eq("contract_id", id),
      supabase
        .from("conversations")
        .select("id")
        .or(`created_by.eq.${counterpartId},counterpart_id.eq.${counterpartId}`)
        .neq("status", "blocked")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      role === "creator" && status === "approved"
        ? supabase
            .from("connected_accounts")
            .select("stripe_account_id, capabilities")
            .eq("owner_type", "creator")
            .eq("owner_ref", userId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const profiles = (profilesRes.data ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[];
  const nameOf = (profileId: string | null) =>
    profiles.find((p) => p.id === profileId)?.display_name ?? "Miembro de la comunidad";
  const counterpart = profiles.find((p) => p.id === counterpartId) ?? null;
  const counterpartName = nameOf(counterpartId);
  const counterpartHref = role === "client" ? `/creadores/perfil/${counterpartId}` : `/perfil/${counterpartId}`;

  const when = (iso: string | null) =>
    iso ? formatDate(iso, { locale: tenant.locale, style: "medium", withTime: true }) : null;
  const money = (cents: number | null) => formatCents(cents ?? 0, contract.currency);
  const fee = contract.platform_fee_cents ?? Math.trunc((contract.amount_cents * contract.fee_pct) / 100);
  const net = contract.creator_net_cents ?? contract.amount_cents - fee;
  const demo = contract.payment_mode !== "stripe";

  const signatureRows = (signaturesRes.data ?? []) as {
    signer_role: "client" | "creator";
    legal_name: string;
    signature_png: string;
    terms_hash: string;
    signed_at: string;
  }[];
  const currentSignatures = signatureRows.filter((s) => s.terms_hash === contract.terms_hash);
  const signatureViews: SignatureView[] = currentSignatures.map((s) => ({
    role: s.signer_role,
    legalName: s.legal_name,
    signedAtLabel: when(s.signed_at) ?? "",
    signaturePng: s.signature_png,
    termsHash: s.terms_hash,
  }));

  const events = (eventsRes.data ?? []) as EventRow[];
  const history: HistoryEntry[] = [...events].reverse().map((e) => ({
    id: e.id,
    kind: e.kind,
    actorLabel: e.actor_id === null ? FLOW_COPY.history.system : e.actor_id === userId ? FLOW_COPY.history.you : nameOf(e.actor_id),
    note: e.note,
    atLabel: when(e.created_at) ?? "",
  }));

  const lastRequest = [...events].reverse().find((e) => e.kind === "terms_changes_requested") ?? null;
  const lastEdit = [...events].reverse().find((e) => e.kind === "terms_edited" || e.kind === "accepted") ?? null;
  const lastChangeRequest =
    lastRequest?.note && (!lastEdit || lastEdit.created_at < lastRequest.created_at)
      ? { note: lastRequest.note, byYou: lastRequest.actor_id === userId }
      : null;
  const lastRevision = [...events].reverse().find((e) => e.kind === "revision_requested")?.note ?? null;

  const milestones = ((milestonesRes.data ?? []) as { id: string; title: string; done_at: string | null }[]).map((m) => ({
    id: m.id,
    title: m.title,
    done: m.done_at !== null,
  }));
  const deliveries: DeliveryView[] = (
    (deliverablesRes.data ?? []) as { version: number; files: string[]; note: string | null; created_at: string }[]
  ).map((d) => ({
    version: d.version,
    note: d.note,
    createdAtLabel: when(d.created_at) ?? "",
    files: d.files.map((path) => ({ path, name: displayNameFromPath(path) })),
  }));
  const filesCount = deliveries.reduce((sum, d) => sum + d.files.length, 0);
  const revisionsUsed = revisionsRes.count ?? 0;
  const conversationId = (conversationRes.data as { id: string } | null)?.id ?? null;

  const contractSheet = contract.contract_text ? (
    <ContractDocumentSheet
      text={contract.contract_text}
      signatures={signatureViews}
      triggerLabel={FLOW_COPY.work.see}
      version={FLOW_COPY.signing.version(contract.terms_version, contract.template_version ?? "—")}
    />
  ) : (
    <span className="text-xs text-foreground-muted">—</span>
  );

  const chat = conversationId ? (
    <Link
      href={`/mensajes/${conversationId}`}
      className="inline-flex items-center gap-1 text-sm font-semibold text-brand-ink"
    >
      <ChatCircle size={15} aria-hidden="true" />
      {FLOW_COPY.work.openChat}
    </Link>
  ) : (
    <MessageCta firstName={counterpartName.split(/\s+/)[0] ?? counterpartName} profileId={counterpartId} />
  );

  const workspace = (
    <WorkspaceTiles
      chat={chat}
      filesCount={filesCount}
      contractSheet={contractSheet}
      paymentLabel={money(contract.amount_cents)}
      paymentStateLabel={demo ? FLOW_COPY.work.paymentDemo : FLOW_COPY.work.paymentConfirmed}
    />
  );

  const breakdown = (
    <ContractBreakdownCard
      amountCents={contract.amount_cents}
      platformFeeCents={fee}
      creatorNetCents={net}
      feePct={contract.fee_pct}
      currency={contract.currency}
      demo={demo}
      showStripeFee
      title={FLOW_COPY.payment.protected}
      netLabel={role === "creator" ? FLOW_COPY.payment.youGet : FLOW_COPY.payment.creatorGets}
      note={demo ? undefined : FLOW_COPY.payment.explainer}
    />
  );

  const reviews = (reviewsRes.data ?? []) as { id: string; reviewer_id: string; rating: number; body: string | null }[];
  const myReview = reviews.find((r) => r.reviewer_id === userId) ?? null;
  const theirReview = reviews.find((r) => r.reviewer_id === counterpartId) ?? null;

  function releaseState(): ReleaseState {
    if (status === "released") return { kind: "released", demo: !contract!.stripe_transfer_id };
    if (!contract!.payout_error) return { kind: "pending" };
    if (role === "creator") {
      const readiness = payoutReadiness(
        accountRes.data as { stripe_account_id: string | null; capabilities: unknown } | null,
      );
      return readiness === "ready" ? { kind: "failed" } : { kind: "blocked", role: "creator" };
    }
    return contract!.payout_error.startsWith("Stripe rechazó") ? { kind: "failed" } : { kind: "blocked", role: "client" };
  }

  const pagoParam = typeof sp.pago === "string" ? sp.pago : null;
  const returnState = pagoParam === "exito" || pagoParam === "cancelado" ? pagoParam : null;

  return (
    <div className="flex flex-col gap-5 pb-6">
      <ContractLiveRefresh contractId={contract.id} />

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="numeric text-sm font-semibold text-foreground-muted">
            {formatJobCode({ code: contract.code, code_legacy: contract.code_legacy })}
          </span>
          <ContractStatusBadge status={status} />
          <span className="ml-auto text-xs font-medium text-foreground-muted">
            {role === "client" ? COPY.contract.role.client : COPY.contract.role.creator}
          </span>
        </div>
        <h1 className="font-display text-2xl font-bold leading-tight tracking-tight text-foreground">{contract.title}</h1>
      </header>

      <Link
        href={counterpartHref}
        className="group flex items-center gap-3 rounded-2xl bg-surface p-3 ring-1 ring-border-subtle transition-[box-shadow,transform] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_10px_28px_-16px_rgba(0,0,0,0.22)]"
      >
        <Avatar size="md" src={counterpart?.avatar_url ?? null} name={counterpartName} />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-foreground-muted">
            {role === "client" ? COPY.contract.counterpartCreator : COPY.contract.counterpartClient}
          </p>
          <p className="truncate font-semibold text-foreground">{counterpartName}</p>
        </div>
        <ArrowRight
          size={16}
          aria-hidden="true"
          className="shrink-0 text-foreground-muted transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5"
        />
      </Link>

      <div className="rounded-2xl bg-surface p-4 ring-1 ring-border-subtle">
        <ContractStepper status={status} />
      </div>

      {status === "proposed" && (
        <>
          <ProposalCard
            title={contract.title}
            scope={contract.scope}
            deliveryDays={contract.delivery_days}
            revisionsIncluded={contract.revisions_included}
            usageRights={contract.usage_rights}
            amountLabel={money(contract.amount_cents)}
            message={contract.proposal_message}
            lastChangeRequest={lastChangeRequest}
          />
          <ProposalActions
            contractId={contract.id}
            role={role}
            terms={{
              title: contract.title,
              scope: contract.scope,
              deliveryDays: contract.delivery_days,
              amountCents: contract.amount_cents,
              revisionsIncluded: contract.revisions_included,
              usageRights: contract.usage_rights,
              proposalMessage: contract.proposal_message,
            }}
          />
        </>
      )}

      {status === "accepted" &&
        (contract.contract_text && contract.terms_hash ? (
          <SigningPanel
            contractId={contract.id}
            termsHash={contract.terms_hash}
            contractText={contract.contract_text}
            versionLabel={FLOW_COPY.signing.version(contract.terms_version, contract.template_version ?? "—")}
            parties={(["client", "creator"] as const).map((partyRole) => ({
              role: partyRole,
              name: nameOf(partyRole === "client" ? contract.client_id : contract.creator_id),
              signed: currentSignatures.some((s) => s.signer_role === partyRole),
              isYou: partyRole === role,
            }))}
            summary={[
              { label: FLOW_COPY.signing.service, value: contract.title },
              { label: FLOW_COPY.signing.delivery, value: FLOW_COPY.proposal.deliveryValue(contract.delivery_days) },
              { label: FLOW_COPY.signing.revisions, value: FLOW_COPY.proposal.revisionsValue(contract.revisions_included) },
              { label: FLOW_COPY.signing.usage, value: contract.usage_rights },
              { label: FLOW_COPY.signing.amount, value: money(contract.amount_cents) },
            ]}
            cancellation={cancellationClauses()}
            signatures={signatureViews}
            youSigned={currentSignatures.some((s) => s.signer_role === role)}
          />
        ) : (
          <StateNotice tone="warning" title={FLOW_COPY.signing.title} body={FLOW_COPY.generic} />
        ))}

      {status === "signed" && (
        <PaymentPanel
          contractId={contract.id}
          role={role}
          amountLabel={money(contract.amount_cents)}
          breakdown={breakdown}
          checkoutOpen={Boolean(contract.stripe_checkout_session_id)}
          returnState={returnState}
        />
      )}

      {(status === "funded" || status === "changes_requested") && (
        <WorkPanel
          contractId={contract.id}
          role={role}
          status={status}
          milestones={milestones}
          workspace={workspace}
          revisionNote={status === "changes_requested" ? lastRevision : null}
        />
      )}

      {status === "delivered" && (
        <>
          <ReviewPanel
            contractId={contract.id}
            role={role}
            delivery={deliveries[0] ?? null}
            deadlineIso={contract.review_deadline_at}
            deadlineLabel={when(contract.review_deadline_at)}
            revisionsIncluded={contract.revisions_included}
            revisionsUsed={revisionsUsed}
            netAmountLabel={money(net)}
          />
          {workspace}
        </>
      )}

      {status === "disputed" && (
        <>
          <StateNotice tone="warning" title={FLOW_COPY.disputed.title} body={FLOW_COPY.disputed.body} />
          {deliveries[0] && <DeliveryFiles contractId={contract.id} delivery={deliveries[0]} />}
          {workspace}
        </>
      )}

      {status === "canceled" && (
        <StateNotice
          tone="neutral"
          title={FLOW_COPY.canceled.title}
          body={
            contract.stripe_refund_id
              ? FLOW_COPY.canceled.refunded
              : contract.stripe_payment_intent_id
                ? FLOW_COPY.canceled.refundPending
                : FLOW_COPY.canceled.noMoney
          }
        />
      )}

      {status === "rejected" && <StateNotice tone="danger" title={FLOW_COPY.rejected.title} body={FLOW_COPY.rejected.body} />}

      {(status === "approved" || status === "released") && (
        <>
          <ReleaseSummary
            state={releaseState()}
            netLabel={money(net)}
            feeLabel={money(fee)}
            communityName={tenant.name}
            approvedAtLabel={when(contract.approved_at)}
            releasedAtLabel={when(contract.released_at)}
            approvedAuto={contract.approved_via === "auto"}
            receiptUrl={role === "client" ? contract.stripe_receipt_url : null}
            payoutCta={<PayoutCta label={FLOW_COPY.release.blockedCreatorCta} className="w-full" />}
            contractSheet={
              contract.contract_text ? (
                <ContractDocumentSheet
                  text={contract.contract_text}
                  signatures={signatureViews}
                  triggerLabel={FLOW_COPY.release.contractHistory}
                  version={FLOW_COPY.signing.version(contract.terms_version, contract.template_version ?? "—")}
                />
              ) : null
            }
          />
          {deliveries.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="font-display text-base font-bold text-foreground">{FLOW_COPY.review.files}</h2>
              <DeliveryFiles contractId={contract.id} delivery={deliveries[0]} />
            </section>
          )}

          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="font-display text-lg font-bold text-foreground">{COPY.reviews.title}</h2>
              <p className="text-sm text-foreground-secondary">{COPY.reviews.intro}</p>
            </div>
            {myReview ? (
              <ReviewCard heading={COPY.reviews.yourReview} rating={myReview.rating} body={myReview.body} />
            ) : (
              <ReviewForm contractId={contract.id} rateeName={counterpartName} />
            )}
            {theirReview ? (
              <ReviewCard heading={COPY.reviews.theirReview} rating={theirReview.rating} body={theirReview.body} />
            ) : (
              <p className="rounded-2xl border border-dashed border-border bg-surface-subtle px-4 py-4 text-center text-sm text-foreground-muted">
                {COPY.reviews.waitingOther}
              </p>
            )}
          </section>

          <CampaignMetrics />
        </>
      )}

      <ContractHistory entries={history} />
    </div>
  );
}

function ReviewCard({ heading, rating, body }: { heading: string; rating: number; body: string | null }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-surface p-4 ring-1 ring-border-subtle">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{heading}</p>
        <span aria-label={COPY.reviews.starLabel(rating)} className="flex">
          {Array.from({ length: 5 }, (_, i) => (
            <Star
              key={i}
              size={15}
              weight={i < rating ? "fill" : "regular"}
              aria-hidden="true"
              className={cn(i < rating ? "text-warning" : "text-border")}
            />
          ))}
        </span>
      </div>
      {body && <p className="whitespace-pre-line text-sm text-foreground-secondary">{body}</p>}
    </div>
  );
}
