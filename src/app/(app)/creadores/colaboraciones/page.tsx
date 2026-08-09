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
import { JobCodeSearch } from "@/components/creators/job-code-search";
import { formatJobCode, matchesJobCode } from "@/lib/creators/job-code";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";

export const metadata = { title: "Mis colaboraciones" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SEARCH_PATH = "/creadores/colaboraciones";

const SEARCH_COPY = {
  resultsTitle: (code: string) => `Resultado para “${code}”`,
  notFoundTitle: "No encontramos ese código",
  notFoundMessage:
    "Revisá que esté completo. Si lo copiaste de un recibo viejo también sirve: buscamos los dos formatos. Ojo que solo ves las colaboraciones en las que participaste.",
  clear: "Ver todas mis colaboraciones",
} as const;

export default function ContratosPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ContractsContent searchParams={searchParams} />
    </Suspense>
  );
}

interface ContractRow {
  id: string;
  code: string;
  codeLegacy: string | null;
  title: string;
  status: ContractStatus;
  amountCents: number;
  currency: string;
  counterpartName: string;
}

async function ContractsContent({ searchParams }: { searchParams: SearchParams }) {
  const [tenant, supabase, sp] = await Promise.all([getTenant(), createClient(), searchParams]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rawCode = typeof sp.codigo === "string" ? sp.codigo : undefined;

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
              href={`/entrar?next=${encodeURIComponent("/creadores/colaboraciones")}`}
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              {COPY.profile.needLoginCta}
            </Link>
          }
        />
      </>
    );
  }

  const searching = Boolean(rawCode?.trim());

  const { data: contracts } = await supabase
    .from("gig_contracts")
    .select("id, code, code_legacy, title, status, amount_cents, currency, client_id, creator_id")
    .eq("tenant_id", tenant.id)
    // El `.or()` de membresía se queda: la RLS deja ver a las partes Y AL STAFF
    // (0024), así que sin este filtro un moderador vería en SU lista las
    // colaboraciones ajenas.
    .or(`client_id.eq.${user.id},creator_id.eq.${user.id}`)
    .order("created_at", { ascending: false });

  /**
   * BÚSQUEDA POR CÓDIGO — mira LAS DOS columnas, siempre.
   *
   * 0065 cambió el formato del Job ID y guardó el anterior en `code_legacy`.
   * Ese código viejo ya está impreso en recibos y citado en correos: si acá se
   * mirara solo `code`, esos contratos serían inencontrables justo por el
   * número que la gente tiene anotado. `matchesJobCode` compara contra las dos
   * columnas y además traduce entre formatos, así que da lo mismo cuál de los
   * dos se pegue en el buscador.
   *
   * SE FILTRA EN MEMORIA y no en la base a propósito: la condición real es
   * "(soy parte) Y (coincide alguno de los dos códigos)", o sea un AND de dos
   * OR. PostgREST no lo expresa con dos `.or()` encadenados —el segundo no se
   * combina como uno espera— y armarlo a mano sería concatenar cuatro `and(…)`
   * anidados por un buscador que corre sobre la lista propia de alguien, que ya
   * se traía entera y sin paginar. Si algún día esta lista se pagina, la
   * búsqueda tiene que bajar a la base con ese `or` anidado, no subir el tope.
   */
  const rows = (contracts ?? []).filter((row) => !searching || matchesJobCode(row, rawCode));
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
      codeLegacy: row.code_legacy,
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

      <JobCodeSearch value={rawCode} action={SEARCH_PATH} />

      {rows.length === 0 ? (
        searching ? (
          // Buscar y no encontrar NO es lo mismo que no tener colaboraciones:
          // el mensaje tiene que hablar del código, no invitar a explorar.
          <EmptyState
            illustration="/images/empty-state-search.png"
            title={SEARCH_COPY.notFoundTitle}
            message={SEARCH_COPY.notFoundMessage}
            action={
              <Link
                href={SEARCH_PATH}
                className={buttonVariants({ variant: "outline", size: "md" })}
              >
                {SEARCH_COPY.clear}
              </Link>
            }
          />
        ) : (
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
        )
      ) : (
        <div className="flex flex-col gap-6">
          {searching && (
            <p className="text-sm text-foreground-secondary" role="status">
              {SEARCH_COPY.resultsTitle(rawCode ?? "")}
            </p>
          )}
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
              href={`/creadores/colaboraciones/${row.id}`}
              className={cn(
                "flex items-center gap-3 rounded-lg border border-border-subtle bg-surface p-4",
                "transition-colors hover:border-border-strong",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {/* El código viejo va al lado del nuevo: quien tiene el
                      recibo impreso necesita reconocer su contrato de un
                      vistazo, sin tener que confiar en que "es el mismo". */}
                  <span className="numeric text-xs font-semibold text-foreground-muted">
                    {formatJobCode({ code: row.code, code_legacy: row.codeLegacy })}
                  </span>
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
