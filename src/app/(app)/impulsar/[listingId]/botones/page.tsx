import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ChatCircleDots, Sparkle } from "@phosphor-icons/react/dist/ssr";
import { Badge, BezelCard, buttonVariants } from "@/components/ui";
import {
  MONETIZATION_COPY,
  canUseActionButtons,
  parseListingTier,
} from "@/lib/monetization";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";
import { EditorBotones } from "./editor-botones";

export const metadata = { title: "Botones de acción" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const M = MONETIZATION_COPY;

type Params = Promise<{ listingId: string }>;

/**
 * Carga de los botones de acción — pantalla del DUEÑO.
 *
 * En un aviso gratuito esta página NO es un muro de pago disfrazado: explica en
 * una frase que el contacto es el chat, muestra qué suma premium y se va. No
 * pinta los campos deshabilitados ni difuminados — un formulario que no se
 * puede usar sólo sirve para frustrar, y el `tier` lo mueve el pago, no un
 * botón de acá (`app.protect_listing_counters`, 0048).
 */
export default async function BotonesPage({ params }: { params: Params }) {
  const { listingId } = await params;
  if (!UUID_RE.test(listingId)) notFound();

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/entrar?next=/impulsar/${listingId}/botones`);

  const { data: listing } = await supabase
    .from("listings")
    .select(
      "id, tenant_id, kind, title, tier, created_by, cta_phone, cta_whatsapp, cta_website, cta_purchase_url, cta_tickets_url, cta_booking_url, cta_address",
    )
    .eq("id", listingId)
    .maybeSingle();

  if (!listing || listing.tenant_id !== tenant.id || listing.created_by !== user.id) {
    notFound();
  }

  const tier = parseListingTier(listing.tier);
  const canEdit = canUseActionButtons(tier);

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
            {M.cta.formTitle}
          </h1>
          <Badge variant={canEdit ? "brand" : "neutral"} className="mt-1 shrink-0">
            {canEdit ? M.tier.premiumBadge : M.tier.freeBadge}
          </Badge>
        </div>
        <p className="mt-0.5 truncate text-xs text-foreground-muted">{listing.title}</p>
      </header>

      {canEdit ? (
        <EditorBotones
          listingId={listing.id}
          kind={listing.kind}
          initial={{
            phone: listing.cta_phone,
            whatsapp: listing.cta_whatsapp,
            website: listing.cta_website,
            purchase: listing.cta_purchase_url,
            tickets: listing.cta_tickets_url,
            booking: listing.cta_booking_url,
            directions: listing.cta_address,
          }}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <BezelCard coreClassName="flex items-start gap-3 p-4">
            <ChatCircleDots
              size={22}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-brand"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {M.tier.freeContactNote}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">
                {M.cta.formPremiumOnly}
              </p>
            </div>
          </BezelCard>

          <BezelCard variant="featured" coreClassName="flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2">
              <Sparkle size={20} weight="fill" aria-hidden="true" className="text-brand" />
              <h2 className="font-display text-lg font-bold text-foreground">
                {M.tier.premiumColumnTitle}
              </h2>
            </div>
            <ul className="flex flex-col gap-1.5">
              {M.tier.premiumPoints.map((point) => (
                <li key={point} className="text-sm text-foreground-secondary">
                  · {point}
                </li>
              ))}
            </ul>
            {/* Sin este link la tarjeta enumeraba lo que se compra y no decía dónde
                comprarlo: la persona se enteraba de que existe premium justo donde
                no podía contratarlo. */}
            <Link
              href={`/negocios/presencia/aviso/${listing.id}`}
              className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full")}
            >
              {M.tier.upgradeCta}
            </Link>
          </BezelCard>
        </div>
      )}
    </div>
  );
}
