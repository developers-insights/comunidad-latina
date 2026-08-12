import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  BookmarkSimple,
  ChatCircleDots,
  ChatText,
  Eye,
  Heart,
  LockKey,
  Megaphone,
  ShareNetwork,
  Sparkle,
  UsersThree,
} from "@phosphor-icons/react/dist/ssr";
import { Badge, BezelCard, buttonVariants } from "@/components/ui";
import { BOOST_SCOPE_COPY, normalizeBoostScope } from "@/lib/boosts";
import { fetchBoostImpressions } from "@/lib/boosts/select";
import { MONETIZATION_COPY, parseListingTier } from "@/lib/monetization";
import { STATS_WINDOW_DAYS, fetchListingStats } from "@/lib/monetization/stats";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";

export const metadata = { title: "Estadísticas de tu aviso" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const M = MONETIZATION_COPY;

/** Copy local de las impresiones del impulso (0092). */
const COPY = {
  impresionesTitulo: "Veces que se mostró tu impulso",
  impresionesAyuda:
    "Cada vez que tu aviso ocupó el lugar pago en un listado. No es lo mismo que las vistas: ahí se cuenta a quien lo abrió.",
  impresionesAlcance: (alcance: string) => `Alcance vigente: ${alcance.toLowerCase()}.`,
  impresionesSinDato:
    "No pudimos traer este número ahora mismo. Volvé a entrar en un rato — tu impulso sigue corriendo igual.",
} as const;

type Params = Promise<{ listingId: string }>;

/**
 * ESTADÍSTICAS DEL AVISO — dos niveles, sin muro.
 *
 * La decisión de producto que gobierna toda esta pantalla: el panel gratuito
 * MUESTRA SUS NÚMEROS COMPLETOS. Lo premium se agrega abajo, con su lista de
 * lo que suma, y nunca tapando ni difuminando lo que la persona vino a ver.
 * Un blur sobre los propios datos no vende premium: vende desconfianza, y en
 * un producto cuyo eje es no estafar a nadie eso cuesta más caro que la
 * suscripción.
 *
 * Vive bajo /impulsar/[listingId] a propósito: el lugar donde se decide gastar
 * es el mismo donde se ve si sirvió, y así el estado del boost, el de la
 * campaña y el de los botones se leen sin cambiar de contexto.
 */
export default async function EstadisticasPage({ params }: { params: Params }) {
  const { listingId } = await params;
  if (!UUID_RE.test(listingId)) notFound();

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/entrar?next=/impulsar/${listingId}/estadisticas`);

  const { data: listing } = await supabase
    .from("listings")
    // comment_count y view_count los mantienen sus triggers en esta misma fila:
    // pedirlos acá le ahorra dos queries a fetchListingStats.
    .select("id, tenant_id, kind, title, tier, status, created_by, comment_count, view_count")
    .eq("id", listingId)
    .maybeSingle();

  if (!listing || listing.tenant_id !== tenant.id || listing.created_by !== user.id) {
    notFound();
  }

  const tier = parseListingTier(listing.tier);
  const isPremiumListing = tier === "premium";

  const stats = await fetchListingStats(supabase, {
    listingId: listing.id,
    tenantId: tenant.id,
    kind: listing.kind,
    tier: listing.tier,
    commentCount: listing.comment_count,
    viewCount: listing.view_count,
  });

  // -------------------------------------------------------------------------
  // IMPRESIONES DEL IMPULSO (0092) — la métrica que faltaba justo donde se
  // decide si el impulso valió la pena.
  //
  // Va acá y no en `fetchListingStats` porque no es una estadística DEL AVISO:
  // es de lo que se COMPRÓ. Un aviso sin impulso no tiene impresiones que
  // mostrar, y un cero en esa tarjeta se leería como "no te vio nadie" cuando
  // en realidad nunca se pagó nada.
  //
  // Y no es lo mismo que "Vistas": vistas son personas-día que ABRIERON el
  // aviso; una impresión es que el lugar pago se MOSTRÓ. Por eso la tarjeta
  // lleva su línea de ayuda: dos números sobre lo mismo, sin explicación, se
  // leen como un error.
  const { data: boostsDelAviso } = await supabase
    .from("boosts")
    .select("id, scope, status, ends_at")
    .eq("listing_id", listing.id)
    .order("created_at", { ascending: false })
    .limit(12);
  const boostRows = boostsDelAviso ?? [];
  const impresiones =
    boostRows.length > 0
      ? await fetchBoostImpressions(
          supabase,
          boostRows.map((row) => row.id),
        )
      : null;
  // El alcance del impulso vigente, si hay uno — es lo que da sentido al
  // número: 300 impresiones con alcance "Tu zona" y con "Todas las
  // comunidades" no significan lo mismo.
  const boostVigente = boostRows.find(
    (row) => row.status === "active" && row.ends_at !== null && new Date(row.ends_at) > new Date(),
  );

  const hasAnything =
    stats.basic.views +
      stats.basic.likes +
      stats.basic.comments +
      stats.basic.shares +
      stats.basic.saves +
      stats.basic.chats >
    0;

  return (
    <div className="flex flex-col gap-5 pb-8">
      <Link
        href={`/impulsar/${listing.id}`}
        className="flex min-h-11 w-fit items-center gap-1.5 text-sm font-medium text-foreground-secondary transition-colors hover:text-foreground"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Volver a promocionar
      </Link>

      <header>
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            {M.stats.title}
          </h1>
          <Badge variant={isPremiumListing ? "brand" : "neutral"} className="mt-1 shrink-0">
            {isPremiumListing ? M.tier.premiumBadge : M.tier.freeBadge}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-foreground-secondary">
          {isPremiumListing ? M.stats.subtitlePremium : M.stats.subtitleFree}
        </p>
        <p className="mt-0.5 truncate text-xs text-foreground-muted">{listing.title}</p>
      </header>

      {!hasAnything ? (
        <BezelCard coreClassName="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <p className="font-display text-lg font-semibold text-foreground">
            {M.stats.emptyTitle}
          </p>
          <p className="max-w-[40ch] text-sm text-foreground-secondary">
            {M.stats.emptyBody}
          </p>
        </BezelCard>
      ) : (
        /* El orden es el del contrato (§3): vistas · me gusta · comentarios ·
           compartidos · chats. "Guardados" va último porque es el único que la
           spec no pide y no queremos que desplace a los que sí. */
        <section aria-label={M.stats.subtitleFree} className="grid grid-cols-2 gap-2.5">
          <MetricCard
            icon={<Eye size={20} weight="fill" aria-hidden="true" />}
            label={M.stats.views}
            value={stats.basic.views}
          />
          <MetricCard
            icon={<Heart size={20} weight="fill" aria-hidden="true" />}
            label={M.stats.likes}
            value={stats.basic.likes}
          />
          <MetricCard
            icon={<ChatText size={20} weight="fill" aria-hidden="true" />}
            label={M.stats.comments}
            value={stats.basic.comments}
          />
          <MetricCard
            icon={<ShareNetwork size={20} weight="fill" aria-hidden="true" />}
            label={M.stats.shares}
            value={stats.basic.shares}
          />
          <MetricCard
            icon={<ChatCircleDots size={20} weight="fill" aria-hidden="true" />}
            label={M.stats.chats}
            value={stats.basic.chats}
          />
          <MetricCard
            icon={<BookmarkSimple size={20} weight="fill" aria-hidden="true" />}
            label="Guardados"
            value={stats.basic.saves}
          />
        </section>
      )}

      {/* IMPRESIONES DEL IMPULSO — sólo si hubo impulso. No está detrás del
          muro premium: quien pagó el impulso ya pagó, y esconderle el
          resultado de su compra detrás de OTRA compra sería cobrar dos veces
          por el mismo dato. */}
      {boostRows.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h2 className="font-display text-lg font-bold text-foreground">
            {COPY.impresionesTitulo}
          </h2>
          <BezelCard coreClassName="flex items-center gap-4 p-4">
            <span className="shrink-0 text-sponsored-ink" aria-hidden="true">
              <Megaphone size={28} weight="fill" />
            </span>
            <div className="min-w-0">
              {impresiones === null ? (
                /* `null` es "no se pudo leer", no "cero". Un cero acá sería una
                   afirmación falsa sobre lo que alguien pagó. */
                <p className="text-sm text-foreground-secondary">{COPY.impresionesSinDato}</p>
              ) : (
                <>
                  <p className="numeric font-display text-2xl font-bold text-foreground">
                    {impresiones.toLocaleString("es-US")}
                  </p>
                  <p className="text-xs text-foreground-secondary">
                    {COPY.impresionesAyuda}
                    {boostVigente
                      ? ` ${COPY.impresionesAlcance(
                          BOOST_SCOPE_COPY[normalizeBoostScope(boostVigente.scope)].label,
                        )}`
                      : ""}
                  </p>
                </>
              )}
            </div>
          </BezelCard>
        </section>
      )}

      {isPremiumListing ? (
        <>
          {/* ALCANCE — lo que la premium agrega sobre "Vistas": aquélla cuenta
              personas-día (volver mañana suma otra), ésta cuenta PERSONAS. Por
              eso lleva su línea de ayuda al lado y no es una tarjeta más de la
              grilla de arriba: sin la explicación, dos números distintos sobre
              lo mismo se leen como un error.

              Se oculta si vino `null` (no se pudo leer). Un alcance en cero
              debajo de 300 vistas no sería un dato pobre: sería imposible. */}
          {stats.reach !== null && (
            <section className="flex flex-col gap-2.5">
              <h2 className="font-display text-lg font-bold text-foreground">
                {M.stats.reach}
              </h2>
              <BezelCard coreClassName="flex items-center gap-4 p-4">
                <span className="shrink-0 text-brand" aria-hidden="true">
                  <UsersThree size={28} weight="fill" />
                </span>
                <div className="min-w-0">
                  <p className="numeric font-display text-2xl font-bold text-foreground">
                    {stats.reach.toLocaleString("es-US")}
                  </p>
                  <p className="text-xs text-foreground-secondary">{M.stats.reachHelp}</p>
                </div>
              </BezelCard>
            </section>
          )}

          <section className="flex flex-col gap-2.5">
            <h2 className="font-display text-lg font-bold text-foreground">
              {M.stats.ctaSectionTitle}
            </h2>
            <p className="-mt-1.5 text-xs text-foreground-muted">
              {M.stats.since(STATS_WINDOW_DAYS)}
            </p>
            {stats.totalCtaClicks === 0 ? (
              <p className="rounded-lg bg-surface-subtle px-4 py-3 text-sm text-foreground-secondary">
                {M.stats.ctaEmpty}
              </p>
            ) : (
              <BezelCard coreClassName="flex flex-col gap-1 p-4">
                {stats.ctaClicks.map((row) => (
                  <ClickRow
                    key={row.kind}
                    label={M.cta.label[row.kind]}
                    clicks={row.clicks}
                    total={stats.totalCtaClicks}
                  />
                ))}
              </BezelCard>
            )}
          </section>

          <section className="flex flex-col gap-2.5">
            <h2 className="font-display text-lg font-bold text-foreground">
              {M.stats.promoSectionTitle}
            </h2>
            {stats.promotions.length === 0 ? (
              <p className="rounded-lg bg-surface-subtle px-4 py-3 text-sm text-foreground-secondary">
                {M.stats.promoEmpty}
              </p>
            ) : (
              <BezelCard coreClassName="flex flex-col gap-2.5 p-4">
                {stats.promotions.map((promo, index) => (
                  <div
                    key={`${promo.type}-${index}`}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span className="min-w-0 truncate text-sm text-foreground">
                      {promo.label}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {promo.amountCents != null && (
                        <span className="numeric text-sm font-semibold text-foreground">
                          USD {Math.round(promo.amountCents / 100)}
                        </span>
                      )}
                      <Badge variant="neutral">
                        {M.campaign.statusLabel[promo.status] ?? promo.status}
                      </Badge>
                    </span>
                  </div>
                ))}
              </BezelCard>
            )}
          </section>
        </>
      ) : (
        /* Lo que se desbloquea, DEBAJO de los números propios y sin taparlos. */
        <BezelCard variant="featured" coreClassName="flex flex-col gap-3 p-5">
          <div className="flex items-center gap-2">
            <Sparkle size={20} weight="fill" aria-hidden="true" className="text-brand" />
            <h2 className="font-display text-lg font-bold text-foreground">
              {M.stats.lockedTitle}
            </h2>
          </div>
          <ul className="flex flex-col gap-2">
            {M.stats.lockedPoints.map((point) => (
              <li key={point} className="flex items-start gap-2.5 text-sm text-foreground">
                <LockKey
                  size={16}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-foreground-muted"
                />
                {point}
              </li>
            ))}
          </ul>
          <p className="text-xs leading-relaxed text-foreground-muted">
            {M.stats.lockedNote}
          </p>
          {/* Iba a `/impulsar/…`, que es Impulsar — otro producto, de pago único.
              El botón dice "Ver qué incluye premium" y llevaba a la pantalla
              equivocada: quien lo tocaba terminaba mirando algo que no era lo
              que le ofrecieron. */}
          <Link
            href={`/negocios/presencia/aviso/${listing.id}`}
            className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full")}
          >
            {M.stats.lockedCta}
          </Link>
        </BezelCard>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <BezelCard coreClassName="flex flex-col gap-1 p-4">
      <span className="text-brand" aria-hidden="true">
        {icon}
      </span>
      {/* `numeric` = tabular-nums: 1.234 no mueve la tarjeta de al lado al pasar
          a 1.235 (§2.2 del design system). */}
      <span className="numeric font-display text-2xl font-bold text-foreground">
        {value.toLocaleString("es-US")}
      </span>
      <span className="text-xs text-foreground-secondary">{label}</span>
    </BezelCard>
  );
}

/**
 * Fila de clics con barra proporcional. La barra es un `div` y no un `<meter>`
 * porque el dato ya se anuncia en el texto de al lado: duplicarlo en la
 * semántica haría que el lector de pantalla lea el mismo número dos veces.
 */
function ClickRow({
  label,
  clicks,
  total,
}: {
  label: string;
  clicks: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((clicks / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1 py-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium text-foreground">{label}</span>
        <span className="numeric shrink-0 text-sm font-semibold text-foreground">
          {clicks.toLocaleString("es-US")}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-subtle">
        <div
          aria-hidden="true"
          className="h-full rounded-full bg-brand transition-[width] duration-(--duration-slow) ease-(--ease-out-premium)"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
