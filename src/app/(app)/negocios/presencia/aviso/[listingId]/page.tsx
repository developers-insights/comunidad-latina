import { notFound, redirect } from "next/navigation";
import {
  Check,
  SealCheck,
  Sparkle,
  ShieldCheck,
} from "@phosphor-icons/react/dist/ssr";
import { Badge, Banner, BezelCard } from "@/components/ui";
import { MONETIZATION_COPY, parseListingTier } from "@/lib/monetization";
import { premiumPresentation, type PremiumTone } from "@/lib/monetization/premium";
import { selectPremiumByListing } from "@/lib/monetization/premium-db";
import { formatCents } from "@/lib/pricing";
import { getPrice } from "@/lib/pricing/read";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { getViewerFormatDate } from "@/lib/time/viewer-zone";
import { PremiumActions } from "./premium-actions";

export const metadata = { title: "Publicación premium" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const M = MONETIZATION_COPY;

type Params = Promise<{ listingId: string }>;
type Search = Promise<{ estado?: string }>;

/**
 * PASAR UNA PUBLICACIÓN A PREMIUM — pantalla del dueño.
 *
 * Es la pantalla que COBRA, así que el orden no es decorativo: primero en qué
 * estado está la persona, después el precio con su frecuencia, después qué
 * incluye, y recién al final el botón. La promesa de "si cancelás no perdés tu
 * aviso" va ANTES del botón y no en una letra chica debajo: el miedo real de
 * quien paga no es el precio, es perder lo que ya publicó.
 *
 * El tier lo mueve el PAGO, nunca esta pantalla: `app.protect_listing_counters()`
 * (0048) se lo prohíbe al dueño y `app.mirror_listing_tier()` (0054) lo escribe
 * desde el estado de la suscripción. Acá sólo se lee.
 */
export default async function PremiumAvisoPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { listingId } = await params;
  if (!UUID_RE.test(listingId)) notFound();
  const { estado } = await searchParams;

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/entrar?next=/negocios/presencia/aviso/${listingId}`);

  const { data: listing } = await supabase
    .from("listings")
    .select("id, tenant_id, title, tier, created_by")
    .eq("id", listingId)
    .maybeSingle();

  if (!listing || listing.tenant_id !== tenant.id || listing.created_by !== user.id) {
    notFound();
  }

  const { data: premium } = await selectPremiumByListing(supabase, listingId, user.id);
  // El precio que se muestra sale de la MISMA lectura que después cobra
  // `activarPremiumAviso` (mismo tenant, mismo producto). Nunca lanza: sin fila
  // configurada devuelve la constante del código.
  const precio = await getPrice(supabase, tenant.id, "listing_premium", "estandar", "mensual");
  // "Premium hasta el …": el vencimiento se lee con el reloj de quien lo paga.
  const formatDate = await getViewerFormatDate();
  const presentation = premiumPresentation(premium, (iso) =>
    formatDate(new Date(iso), { style: "long" }),
  );
  const isPremium = parseListingTier(listing.tier) === "premium";

  return (
    <div className="flex flex-col gap-5 pb-8">
      {estado === "exito" && (
        <Banner
          variant="info"
          className="rounded-lg"
          icon={<SealCheck size={20} className="text-success" />}
        >
          {M.premium.checkoutSuccess}
        </Banner>
      )}
      {estado === "cancelado" && (
        <Banner variant="offline" className="rounded-lg">
          {M.premium.checkoutCanceled}
        </Banner>
      )}

      <header>
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            {M.premium.pageTitle}
          </h1>
          <Badge variant={isPremium ? "brand" : "neutral"} className="mt-1 shrink-0">
            {isPremium ? M.tier.premiumBadge : M.tier.freeBadge}
          </Badge>
        </div>
        <p className="mt-0.5 truncate text-xs text-foreground-muted">{listing.title}</p>
        <p className="mt-2 text-sm text-foreground-secondary">{M.premium.pageIntro}</p>
      </header>

      {/* Estado actual. En `none` no hay tarjeta: no se le anuncia a alguien que
          "no tiene nada" — se le muestra directamente la oferta. */}
      {presentation.title && (
        <BezelCard coreClassName="flex flex-col gap-1 p-4">
          <p className={`text-sm font-semibold ${toneClass(presentation.tone)}`}>
            {presentation.title}
          </p>
          {presentation.body && (
            <p className="text-sm leading-relaxed text-foreground-secondary">
              {presentation.body}
            </p>
          )}
        </BezelCard>
      )}

      <BezelCard variant="featured" coreClassName="flex flex-col gap-4 p-6">
        <div className="flex items-center gap-2">
          <Sparkle size={20} weight="fill" aria-hidden="true" className="text-brand" />
          <h2 className="font-display text-lg font-bold text-foreground">
            {M.premium.includesTitle}
          </h2>
        </div>

        {precio && (
          <div>
            <p className="flex items-baseline gap-1.5">
              <span className="numeric font-display text-4xl font-bold text-foreground">
                {formatCents(precio.amountCents, precio.currency)}
              </span>
              <span className="text-sm text-foreground-secondary">
                {M.premium.priceSuffix}
              </span>
            </p>
            <p className="mt-1 text-xs text-foreground-muted">{M.premium.priceNote}</p>
          </div>
        )}

        <ul className="flex flex-col gap-2.5">
          {M.tier.premiumPoints.map((point) => (
            <li key={point} className="flex items-start gap-2.5 text-sm">
              <Check
                size={18}
                weight="bold"
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-success"
              />
              <span className="text-foreground">{point}</span>
            </li>
          ))}
        </ul>
      </BezelCard>

      {/* La promesa que saca el miedo de encima. Va ANTES del botón, siempre. */}
      <BezelCard coreClassName="flex items-start gap-3 p-4">
        <ShieldCheck
          size={22}
          weight="fill"
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-success"
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{M.premium.safetyTitle}</p>
          <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">
            {M.premium.safetyBody}
          </p>
        </div>
      </BezelCard>

      <PremiumActions
        listingId={listing.id}
        canActivate={presentation.canActivate}
        canManage={presentation.canManage}
        activateLabel={presentation.activateLabel}
      />
    </div>
  );
}

/** Color del título de estado. El texto ya dice qué pasa; esto sólo lo acompaña. */
function toneClass(tone: PremiumTone): string {
  switch (tone) {
    case "success":
      return "text-success";
    case "warning":
      return "text-foreground";
    case "danger":
      return "text-danger-ink";
    case "neutral":
      return "text-foreground";
  }
}
