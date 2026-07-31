import { Suspense } from "react";
import Link from "next/link";
import {
  CheckCircle,
  Prohibit,
  SignIn,
  Storefront,
} from "@phosphor-icons/react/dist/ssr";
import {
  Banner,
  BezelCard,
  EmptyState,
  Skeleton,
  buttonVariants,
} from "@/components/ui";
import {
  COPY,
  MembershipStatusCard,
  MEMBERSHIP_EXCLUDES,
  MEMBERSHIP_INCLUDES,
  formatMembershipPrice,
  membershipPresentation,
  type MembershipRow,
} from "@/components/marketplace";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { MembershipActions } from "./membership-actions";

/**
 * =============================================================================
 * /marketplace/membresia — alta, estado y baja de la membresía de tienda (§7)
 * =============================================================================
 *
 * Una pantalla, todas las tiendas del usuario. Quien tiene dos negocios paga
 * dos membresías (`store_memberships` es unique por `store_id`), así que verlas
 * juntas es la única forma de entender qué está pagando y qué se está viendo.
 *
 * LECTURA: cliente del usuario. `store_memberships_select` (0048) sólo devuelve
 * las propias, y `listings` filtra por `created_by` — no hace falta el admin
 * client y no se usa (§6: jamás en un request path de usuario).
 *
 * ESCRITURA: ninguna. La fila la mueve el webhook de Stripe con service_role.
 */

const C = COPY.membership;

export const metadata = { title: "Membresía de tienda" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MembresiaPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const estado = (Array.isArray(sp.estado) ? sp.estado[0] : sp.estado) ?? "";

  return (
    <>
      <Header />
      {/* Vuelta del Checkout. `exito` no promete que ya esté activa: el webhook
          puede tardar unos segundos y decir "listo" antes de tiempo obliga a la
          persona a recargar sin saber por qué. */}
      {estado === "exito" && (
        <Banner variant="info" className="mt-4 rounded-lg">
          <strong className="font-semibold">{C.successTitle}</strong> {C.successMessage}
        </Banner>
      )}
      {estado === "cancelado" && (
        <Banner variant="info" className="mt-4 rounded-lg">
          <strong className="font-semibold">{C.canceledTitle}</strong> {C.canceledMessage}
        </Banner>
      )}

      <Suspense fallback={<StoresSkeleton />}>
        <MembresiaContent />
      </Suspense>
    </>
  );
}

// ---------------------------------------------------------------------------
// Contenido (streamed)
// ---------------------------------------------------------------------------

async function MembresiaContent() {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // El plan se muestra IGUAL sin sesión: alguien que está evaluando si le
    // conviene tiene que poder ver el precio y —sobre todo— que no cobramos
    // comisión, sin tener que crear una cuenta primero para enterarse.
    return (
      <>
        <PlanCard />
        <EmptyState
          icon={<SignIn />}
          title={C.needLoginTitle}
          message={C.needLoginMessage}
          action={
            <Link
              href={`/entrar?next=${encodeURIComponent("/marketplace/membresia")}`}
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              {C.needLoginCta}
            </Link>
          }
          className="mt-6 py-12"
        />
      </>
    );
  }

  // Tiendas propias. Se incluyen las que no están `published` todavía: alguien
  // puede querer dejar la membresía lista antes de que su negocio se apruebe.
  const { data: stores, error } = await supabase
    .from("listings")
    .select("id, title, store_active, status")
    .eq("tenant_id", tenant.id)
    .eq("kind", "business")
    .eq("created_by", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("[marketplace:membresia] query de tiendas falló", { code: error.code });
  }

  const storeRows = stores ?? [];

  if (storeRows.length === 0) {
    return (
      <>
        <PlanCard />
        <EmptyState
          icon={<Storefront />}
          title={C.noStoresTitle}
          message={C.noStoresMessage}
          action={
            <Link
              // Mismo destino que usa el composer del Marketplace para
              // "¿Tenés un negocio? Creá tu tienda" — un solo camino de alta.
              href="/publicar?kind=business"
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              {C.noStoresCta}
            </Link>
          }
          className="mt-6 py-12"
        />
      </>
    );
  }

  // Membresías de esas tiendas, en una vuelta. La RLS ya limita a las propias;
  // el `.in()` evita N consultas para quien tiene varios negocios.
  const { data: membershipRows } = await supabase
    .from("store_memberships")
    .select("store_id, status, current_period_end, price_cents, currency, stripe_customer_id")
    .in(
      "store_id",
      storeRows.map((store) => store.id),
    );

  const byStore = new Map(
    (membershipRows ?? []).map((row) => [
      row.store_id,
      {
        row: {
          status: row.status,
          currentPeriodEnd: row.current_period_end,
          priceCents: row.price_cents,
          currency: row.currency,
        } satisfies MembershipRow,
        hasBilling: Boolean(row.stripe_customer_id),
      },
    ]),
  );

  return (
    <>
      <PlanCard />

      <section className="mt-6 flex flex-col gap-3">
        <h2 className="font-display text-lg font-bold text-foreground">{C.statusTitle}</h2>
        {storeRows.map((store) => {
          const entry = byStore.get(store.id) ?? null;
          const view = membershipPresentation(entry?.row ?? null, store.store_active);
          return (
            <MembershipStatusCard
              key={store.id}
              storeName={store.title}
              membership={entry?.row ?? null}
              storeActive={store.store_active}
              locale={tenant.locale}
            >
              <MembershipActions
                storeId={store.id}
                canActivate={view.canActivate}
                hasBilling={entry?.hasBilling ?? false}
              />
            </MembershipStatusCard>
          );
        })}
      </section>

      <p className="mt-4 text-sm leading-relaxed text-foreground-secondary">
        {C.billingNote}
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Qué se compra — precio, incluye, y (sobre todo) lo que NO cobramos
// ---------------------------------------------------------------------------

function PlanCard() {
  return (
    <BezelCard variant="featured" coreClassName="flex flex-col gap-5 p-6">
      <p className="flex items-baseline gap-2">
        <span className="numeric font-display text-4xl font-bold text-foreground">
          {formatMembershipPrice()}
        </span>
        <span className="text-sm text-foreground-secondary">{C.priceSuffix}</span>
      </p>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          {C.includesTitle}
        </h2>
        <ul className="mt-2.5 flex flex-col gap-2">
          {MEMBERSHIP_INCLUDES.map((item) => (
            <li key={item} className="flex gap-2.5 text-sm leading-relaxed text-foreground">
              <CheckCircle
                size={17}
                weight="fill"
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-success"
              />
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Lo que NO cobramos, con el mismo peso visual que lo que sí incluye.
          "Sin comisión por venta" y "cancelás cuando quieras" son parte de lo
          que se compra: esconderlos abajo sería vender otra cosa. */}
      <div className="border-t border-border-subtle pt-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          {C.excludesTitle}
        </h2>
        <ul className="mt-2.5 flex flex-col gap-2">
          {MEMBERSHIP_EXCLUDES.map((item) => (
            <li
              key={item}
              className="flex gap-2.5 text-sm leading-relaxed text-foreground-secondary"
            >
              <Prohibit
                size={17}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-foreground-muted"
              />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </BezelCard>
  );
}

function Header() {
  return (
    <header className="mb-1">
      <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
        {C.title}
      </h1>
      <p className="mt-1 text-sm text-foreground-secondary">{C.subtitle}</p>
    </header>
  );
}

function StoresSkeleton() {
  return (
    <div aria-busy="true" className="mt-4 flex flex-col gap-3">
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-44 w-full rounded-xl" />
    </div>
  );
}
