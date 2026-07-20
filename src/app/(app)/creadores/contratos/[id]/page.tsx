import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, Star } from "@phosphor-icons/react/dist/ssr";
import { z } from "zod";
import { Avatar } from "@/components/ui";
import {
  COPY,
  ContractActions,
  ContractBreakdownCard,
  ContractStatusBadge,
  ContractStepper,
  ReviewForm,
  roleOf,
  type ContractRole,
  type ContractStatus,
} from "@/components/creators";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Contrato" };

function statusHint(role: ContractRole, status: ContractStatus): string {
  const H = COPY.statusHint;
  if (status === "canceled") return H.canceled;
  if (status === "disputed") return H.disputed;
  const isClient = role === "client";
  switch (status) {
    case "proposed":
      return isClient ? H.proposedClient : H.proposedCreator;
    case "funded":
      return isClient ? H.fundedClient : H.fundedCreator;
    case "delivered":
      return isClient ? H.deliveredClient : H.deliveredCreator;
    case "released":
      return isClient ? H.releasedClient : H.releasedCreator;
  }
}

export default async function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/entrar?next=${encodeURIComponent(`/creadores/contratos/${id}`)}`);

  const { data: contract } = await supabase
    .from("gig_contracts")
    .select(
      "id, tenant_id, code, gig_id, client_id, creator_id, title, scope, delivery_days, amount_cents, currency, fee_pct, platform_fee_cents, creator_net_cents, status, payment_mode, funded_at, delivered_at, released_at, canceled_at, created_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (!contract || contract.tenant_id !== tenant.id) notFound();

  const role = roleOf(user.id, contract);
  if (role === "other") notFound();

  const status = contract.status as ContractStatus;
  const counterpartId = role === "client" ? contract.creator_id : contract.client_id;
  const counterpartHref =
    role === "client" ? `/creadores/perfil/${counterpartId}` : `/perfil/${counterpartId}`;

  const [{ data: counterpart }, { data: reviews }] = await Promise.all([
    supabase.from("profiles").select("id, display_name, avatar_url").eq("id", counterpartId).maybeSingle(),
    supabase
      .from("gig_reviews")
      .select("id, reviewer_id, ratee_id, rating, body, created_at")
      .eq("contract_id", id),
  ]);

  const counterpartName = counterpart?.display_name ?? "Miembro de la comunidad";
  const myReview = (reviews ?? []).find((r) => r.reviewer_id === user.id) ?? null;
  const theirReview = (reviews ?? []).find((r) => r.reviewer_id === counterpartId) ?? null;

  type TimelineEntry = { label: string; at: string };
  const timeline = (
    [
      { label: COPY.contract.timeline.created, at: contract.created_at },
      contract.funded_at ? { label: COPY.contract.timeline.funded, at: contract.funded_at } : null,
      contract.delivered_at ? { label: COPY.contract.timeline.delivered, at: contract.delivered_at } : null,
      contract.released_at ? { label: COPY.contract.timeline.released, at: contract.released_at } : null,
      contract.canceled_at ? { label: COPY.contract.timeline.canceled, at: contract.canceled_at } : null,
    ] as (TimelineEntry | null)[]
  ).filter((entry): entry is TimelineEntry => entry !== null);

  return (
    <div className="flex flex-col gap-5 pb-4">
      <Link
        href="/creadores/contratos"
        className="flex min-h-11 w-fit items-center gap-1.5 text-sm font-medium text-foreground-secondary transition-colors hover:text-foreground"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {COPY.contract.detailBack}
      </Link>

      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="numeric text-sm font-semibold text-foreground-muted">{contract.code}</span>
          <ContractStatusBadge status={status} />
          <span className="ml-auto text-xs font-medium text-foreground-muted">
            {role === "client" ? COPY.contract.role.client : COPY.contract.role.creator}
          </span>
        </div>
        <h1 className="font-display text-2xl font-bold leading-tight tracking-tight text-foreground">
          {contract.title}
        </h1>
      </header>

      {/* Contraparte */}
      <Link
        href={counterpartHref}
        className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface p-3 transition-colors hover:border-border-strong"
      >
        <Avatar size="md" src={counterpart?.avatar_url ?? null} name={counterpartName} />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-foreground-muted">
            {role === "client" ? COPY.contract.counterpartCreator : COPY.contract.counterpartClient}
          </p>
          <p className="truncate font-semibold text-foreground">{counterpartName}</p>
        </div>
        <ArrowRight size={16} aria-hidden="true" className="shrink-0 text-foreground-muted" />
      </Link>

      {/* Stepper */}
      <div className="rounded-lg border border-border-subtle bg-surface p-4">
        <ContractStepper status={status} />
      </div>

      {/* Qué sigue, según rol y estado */}
      <p className="rounded-lg bg-surface-subtle px-4 py-3 text-sm leading-relaxed text-foreground-secondary">
        {statusHint(role, status)}
      </p>

      {/* Desglose del pago en garantía */}
      <ContractBreakdownCard
        amountCents={contract.amount_cents}
        platformFeeCents={contract.platform_fee_cents}
        creatorNetCents={contract.creator_net_cents}
        feePct={contract.fee_pct}
        currency={contract.currency}
      />

      {/* Qué se entrega */}
      <section className="flex flex-col gap-1.5">
        <h2 className="font-display text-base font-bold text-foreground">{COPY.contract.scopeTitle}</h2>
        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground-secondary">{contract.scope}</p>
      </section>

      {/* Acciones de transición (según rol + estado) */}
      <ContractActions contractId={contract.id} role={role} status={status} />

      {/* Historial de fechas */}
      <section className="flex flex-col gap-2">
        <h2 className="font-display text-base font-bold text-foreground">{COPY.contract.timelineTitle}</h2>
        <ol className="flex flex-col gap-0">
          {timeline.map((entry, index) => (
            <li key={entry.label} className="flex items-start gap-3">
              <div className="flex flex-col items-center self-stretch">
                <span aria-hidden="true" className="mt-1 size-2.5 shrink-0 rounded-full bg-[var(--accent-creadores)]" />
                {index < timeline.length - 1 && <span aria-hidden="true" className="w-px flex-1 bg-border" />}
              </div>
              <div className="pb-4">
                <p className="text-sm font-medium text-foreground">{entry.label}</p>
                <p className="numeric text-xs text-foreground-muted">
                  {formatDate(entry.at, { locale: tenant.locale, style: "medium", withTime: true })}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Reseñas mutuas — solo al liberar el pago */}
      {status === "released" && (
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
            <p className="rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-4 text-center text-sm text-foreground-muted">
              {COPY.reviews.waitingOther}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function ReviewCard({ heading, rating, body }: { heading: string; rating: number; body: string | null }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{heading}</p>
        <span aria-hidden="true" className="flex">
          {Array.from({ length: 5 }, (_, i) => (
            <Star
              key={i}
              size={15}
              weight={i < rating ? "fill" : "regular"}
              className={i < rating ? "text-warning" : "text-border"}
            />
          ))}
        </span>
      </div>
      {body && <p className="whitespace-pre-line text-sm text-foreground-secondary">{body}</p>}
    </div>
  );
}
