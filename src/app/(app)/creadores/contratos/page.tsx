import { Suspense } from "react";
import Link from "next/link";
import { CaretRight, SignIn } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import {
  COPY,
  ContractStatusBadge,
  ContractsListSkeleton,
  CreatorsNav,
  formatCents,
  type ContractStatus,
} from "@/components/creators";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";

export const metadata = { title: "Mis contratos" };

export default function ContratosPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ContractsContent />
    </Suspense>
  );
}

interface ContractRow {
  id: string;
  code: string;
  title: string;
  status: ContractStatus;
  amountCents: number;
  currency: string;
  counterpartName: string;
}

async function ContractsContent() {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <>
        <Header />
        <CreatorsNav active="contracts" />
        <EmptyState
          icon={<SignIn />}
          title={COPY.profile.needLoginTitle}
          message={COPY.contractsList.subtitle}
          action={
            <Link
              href={`/entrar?next=${encodeURIComponent("/creadores/contratos")}`}
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              {COPY.profile.needLoginCta}
            </Link>
          }
        />
      </>
    );
  }

  const { data: contracts } = await supabase
    .from("gig_contracts")
    .select("id, code, title, status, amount_cents, currency, client_id, creator_id")
    .eq("tenant_id", tenant.id)
    .or(`client_id.eq.${user.id},creator_id.eq.${user.id}`)
    .order("created_at", { ascending: false });

  const rows = contracts ?? [];
  const counterpartIds = [
    ...new Set(rows.map((row) => (row.client_id === user.id ? row.creator_id : row.client_id))),
  ];
  const { data: profiles } = counterpartIds.length
    ? await supabase.from("profiles").select("id, display_name").in("id", counterpartIds)
    : { data: [] as { id: string; display_name: string }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  const asClient: ContractRow[] = [];
  const asCreator: ContractRow[] = [];
  for (const row of rows) {
    const iAmClient = row.client_id === user.id;
    const counterpartId = iAmClient ? row.creator_id : row.client_id;
    const entry: ContractRow = {
      id: row.id,
      code: row.code,
      title: row.title,
      status: row.status as ContractStatus,
      amountCents: row.amount_cents,
      currency: row.currency,
      counterpartName: nameById.get(counterpartId) ?? "Miembro de la comunidad",
    };
    (iAmClient ? asClient : asCreator).push(entry);
  }

  return (
    <>
      <Header />
      <CreatorsNav active="contracts" />

      {rows.length === 0 ? (
        <EmptyState
          illustration="/images/empty-state-search.png"
          title={COPY.contractsList.emptyTitle}
          message={COPY.contractsList.emptyMessage}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link href="/creadores" className={buttonVariants({ variant: "primary", size: "md" })}>
                {COPY.contractsList.exploreGigs}
              </Link>
              <Link href="/creadores/buscar" className={buttonVariants({ variant: "outline", size: "md" })}>
                {COPY.contractsList.exploreCreators}
              </Link>
            </div>
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {asClient.length > 0 && <ContractGroup title={COPY.contractsList.asClient} rows={asClient} />}
          {asCreator.length > 0 && <ContractGroup title={COPY.contractsList.asCreator} rows={asCreator} />}
        </div>
      )}
    </>
  );
}

function Header() {
  return (
    <header className="mb-4">
      <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
        {COPY.contractsList.title}
      </h1>
      <p className="mt-0.5 text-sm text-foreground-secondary">{COPY.contractsList.subtitle}</p>
    </header>
  );
}

function ContractGroup({ title, rows }: { title: string; rows: ContractRow[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">{title}</h2>
      <ul className="flex flex-col gap-2.5">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/creadores/contratos/${row.id}`}
              className={cn(
                "flex items-center gap-3 rounded-lg border border-border-subtle bg-surface p-4",
                "transition-colors hover:border-border-strong",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="numeric text-xs font-semibold text-foreground-muted">{row.code}</span>
                  <ContractStatusBadge status={row.status} />
                </div>
                <p className="mt-1 truncate font-semibold text-foreground">{row.title}</p>
                <p className="mt-0.5 truncate text-sm text-foreground-secondary">
                  {row.counterpartName} ·{" "}
                  <span className="numeric font-medium text-foreground">
                    {formatCents(row.amountCents, row.currency)}
                  </span>
                </p>
              </div>
              <CaretRight size={18} aria-hidden="true" className="shrink-0 text-foreground-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PageSkeleton() {
  return (
    <div aria-busy="true">
      <Header />
      <CreatorsNav active="contracts" />
      <div className="mt-5">
        <ContractsListSkeleton />
      </div>
    </div>
  );
}
