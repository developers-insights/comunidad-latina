import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Package, RocketLaunch, Tag, User } from "@phosphor-icons/react/dist/ssr";
import { Avatar, Banner, BezelCard, Chip, buttonVariants } from "@/components/ui";
import {
  DetailTopBar,
  PublisherTrust,
  allPhotoUrls,
  buildTrustSignals,
  firstNameOf,
  firstPhotoUrl,
  listingPhotoUrl,
  toTrustLevel,
} from "@/components/listings";
import { InlineMessageCta } from "@/components/listings/inline-message-cta";
import {
  COPY,
  ExternalPurchaseCta,
  ListingCommentsRow,
  ProductGallery,
  ReportProductRow,
  SellerChip,
  StoreCard,
  StoreOffNotice,
  categoryLabel,
  conditionLabel,
  formatProductPrice,
  parseProductAttrs,
  type SellerView,
  type StoreCardModel,
} from "@/components/marketplace";
import { fetchListingSaved } from "@/components/marketplace/engagement-queries";
import { visibleCtasFor } from "@/lib/monetization/tier";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";

type Params = Promise<{ id: string }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lectura del producto, cache()-eada por request (patrón propiedades/[id]):
 * generateMetadata y el cuerpo comparten la misma fila. RLS ya limita qué
 * filas existen para este usuario (published | propias | staff).
 */
const fetchProductById = cache(async (id: string) => {
  const supabase = await createClient();
  return supabase
    .from("listings")
    .select(
      // `tier` y `cta_purchase_url` son del contrato de monetización (0048):
      // el botón "Comprar" EXISTE sólo en premium — lo garantiza el CHECK
      // `listings_cta_premium_only`, así que un aviso free no puede ni siquiera
      // guardar la URL. Acá se consume, no se decide.
      "id, tenant_id, kind, title, description, price_amount, price_currency, attrs, area_label, photos, status, created_by, publisher_name, created_at, comment_count, tier, cta_purchase_url",
    )
    .eq("id", id)
    .eq("kind", "product")
    .maybeSingle();
});

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: "Producto" };
  const { data } = await fetchProductById(id);
  return { title: data?.title ?? "Producto" };
}

export default async function ProductoDetallePage({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const [tenant, supabase, { data: product }] = await Promise.all([
    getTenant(),
    createClient(),
    fetchProductById(id),
  ]);

  if (!product || product.tenant_id !== tenant.id) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const attrs = parseProductAttrs(product.attrs);
  const priceLabel = formatProductPrice(product.price_amount, product.price_currency, tenant.locale);
  const photos = (product.photos ?? []).map(listingPhotoUrl);
  const isOwner = Boolean(user && product.created_by === user.id);

  // Engagement del aviso (0038): el conteo viaja en el select de arriba
  // (listings.comment_count, mantenido por trigger); "¿ya lo guardé?" es una
  // lectura propia del visitante y degrada a false — ver engagement-queries.
  const commentCount = Math.max(0, product.comment_count ?? 0);
  const initialSaved = await fetchListingSaved(supabase, tenant.id, product.id, user?.id);

  // ---------------------------------------------------------------------
  // Quién vende. Con tienda: nombre/zona/foto + seguidores + trust del dueño +
  // Presencia Verificada. Sin tienda (particular, § split 2026-07-24): perfil
  // de quien publicó, con su Trust Score — la persona ES el vendedor.
  // Todo en un solo Promise.all — independiente entre sí.
  // ---------------------------------------------------------------------
  let storeCardModel: StoreCardModel | null = null;
  let seller: SellerView = { kind: "private", name: product.publisher_name ?? null };
  let privateSeller: {
    displayName: string;
    avatarUrl: string | null;
    trust: NonNullable<StoreCardModel["trust"]>;
  } | null = null;

  // La tienda dueña, cuando la hay. `storeOff` marca que su membresía venció:
  // el producto sigue existiendo en la base, pero no se muestra a nadie salvo
  // a su dueño (§7).
  let storeOff = false;

  if (attrs.storeListingId) {
    const storeId = attrs.storeListingId;
    const [{ data: store }, { count: followerCount }, { data: myFollow }] =
      await Promise.all([
        supabase
          .from("listings")
          // store_verified: espejo de Presencia Verificada (0039).
          // store_active: espejo de la membresía de tienda (0048).
          .select("id, title, area_label, photos, created_by, store_verified, store_active")
          .eq("id", storeId)
          .eq("tenant_id", tenant.id)
          .eq("kind", "business")
          .maybeSingle(),
        supabase
          .from("follows")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id)
          .eq("target_kind", "listing")
          .eq("target_id", storeId),
        user
          ? supabase
              .from("follows")
              .select("id")
              .eq("tenant_id", tenant.id)
              .eq("follower_id", user.id)
              .eq("target_kind", "listing")
              .eq("target_id", storeId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

    const verified = Boolean(store?.store_verified);
    // Sin fila de tienda (borrada, o invisible para este usuario) también se
    // considera apagada: sin poder verificar que está activa, no se muestra.
    storeOff = !store || store.store_active !== true;

    if (store) {
      let trust: StoreCardModel["trust"] = null;
      if (store.created_by) {
        const [{ data: profile }, { data: trustScore }] = await Promise.all([
          supabase
            .from("profiles")
            .select("display_name, avatar_url, identity_verified")
            .eq("id", store.created_by)
            .maybeSingle(),
          supabase
            .from("trust_scores")
            .select("score, level, signals")
            .eq("profile_id", store.created_by)
            .maybeSingle(),
        ]);
        const displayName = profile?.display_name ?? COPY.detail.communityMember;
        trust = {
          displayName,
          firstName: firstNameOf(displayName),
          score: trustScore?.score ?? 0,
          level: toTrustLevel(trustScore?.level),
          signals: buildTrustSignals(trustScore?.signals ?? {}, profile?.identity_verified ?? false),
        };
      }

      storeCardModel = {
        id: store.id,
        name: store.title,
        areaLabel: store.area_label,
        photoUrl: firstPhotoUrl(store.photos),
        // Tocar la foto de la tienda la abre en el visor (feedback 2026-07-26).
        photos: allPhotoUrls(store.photos),
        followerCount: followerCount ?? 0,
        initialFollowing: Boolean(myFollow),
        trust,
        verified,
      };
    }

    seller = {
      kind: "store",
      name: store?.title ?? null,
      storeId,
      verified,
    };
  } else if (product.created_by) {
    const [{ data: profile }, { data: trustScore }] = await Promise.all([
      supabase
        .from("profiles")
        .select("display_name, avatar_url, identity_verified")
        .eq("id", product.created_by)
        .maybeSingle(),
      supabase
        .from("trust_scores")
        .select("score, level, signals")
        .eq("profile_id", product.created_by)
        .maybeSingle(),
    ]);
    const displayName = profile?.display_name ?? COPY.detail.communityMember;
    privateSeller = {
      displayName,
      avatarUrl: profile?.avatar_url ?? null,
      trust: {
        displayName,
        firstName: firstNameOf(displayName),
        score: trustScore?.score ?? 0,
        level: toTrustLevel(trustScore?.level),
        signals: buildTrustSignals(trustScore?.signals ?? {}, profile?.identity_verified ?? false),
      },
    };
    seller = { kind: "private", name: displayName };
  }

  // Tienda apagada: el producto deja de existir para la comunidad. Se corta
  // ANTES de renderizar nada del aviso — mostrar precio y botón de compra de un
  // negocio que no está en el Marketplace es exactamente lo que hay que evitar.
  // El dueño sí lo ve (con el aviso de que nadie más lo ve).
  if (storeOff && !isOwner) {
    return <StoreOffNotice isOwner={false} />;
  }

  // "Comprar": el botón EXISTE sólo si el módulo lo ofrece, el tier lo habilita
  // y hay URL cargada. La regla la resuelve `visibleCtasFor` (src/lib/
  // monetization) — este módulo la CONSUME, no la duplica.
  const showPurchase = visibleCtasFor({
    kind: product.kind,
    tier: product.tier,
    values: { purchase: product.cta_purchase_url },
  }).includes("purchase");

  return (
    // pb-24: el contacto dejó de ser una barra `fixed` (ahora el mensaje se
    // escribe EN la página, ver InlineMessageCta), así que sólo hace falta aire
    // sobre el bottom-nav.
    <div className="pb-24">
      <DetailTopBar title={product.title} listingId={product.id} initialSaved={initialSaved} />

      <ProductGallery photos={photos} title={product.title} />

      {product.status !== "published" && isOwner && (
        <Banner variant="info" className="mt-4 rounded-lg">
          {COPY.detail.pendingBanner}
        </Banner>
      )}

      {/* Dueño de una tienda apagada: su producto sigue acá, pero nadie más lo
          ve. Se lo decimos arriba de todo, con el camino de vuelta. */}
      {storeOff && isOwner && (
        <div className="mt-4">
          <StoreOffNotice isOwner />
        </div>
      )}

      <h1 className="mt-4 font-display text-xl font-bold leading-snug text-foreground">
        {product.title}
      </h1>

      {priceLabel && <p className="numeric mt-1 text-3xl font-bold text-brand">{priceLabel}</p>}

      {/* Tienda o particular, arriba de todo: quién vende cambia cómo se lee
          el precio (§ split tiendas/particulares). */}
      <SellerChip seller={seller} className="mt-3" />

      {(attrs.category || attrs.condition) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {attrs.category && <Chip icon={<Tag />}>{categoryLabel(attrs.category)}</Chip>}
          {attrs.condition && <Chip icon={<Package />}>{conditionLabel(attrs.condition)}</Chip>}
        </div>
      )}

      {/* Boost: solo el dueño de un producto publicado puede impulsarlo (misma
          ruta /impulsar/[listingId] que usa Propiedades — funciona para
          cualquier listing). La promoción en sí la construye otro agente. */}
      {isOwner && product.status === "published" && (
        <div className="mt-4 flex flex-col items-center gap-1.5">
          <Link
            href={`/impulsar/${product.id}`}
            className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full")}
          >
            <RocketLaunch size={18} aria-hidden="true" />
            {COPY.detail.boostCta}
          </Link>
          <p className="text-center text-xs text-foreground-muted">{COPY.detail.boostHint}</p>
        </div>
      )}

      {/* COMPRAR — el checkout ocurre AFUERA (§7). Va arriba de la ficha de la
          tienda y del chat porque es la acción principal cuando existe; y lleva
          pegado, en el mismo bloque, quién cobra y quién responde por el envío.
          Ese aviso NO puede quedar debajo del pliegue: es lo que evita que
          alguien crea que Comunidad Latina está en el medio de la compra. */}
      {showPurchase && (
        <section className="mt-5">
          <ExternalPurchaseCta
            purchaseUrl={product.cta_purchase_url}
            storeName={seller.kind === "store" ? seller.name : null}
          />
        </section>
      )}

      {storeCardModel && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-foreground-secondary">
            {COPY.detail.storeTitle}
          </h2>
          <StoreCard store={storeCardModel} />
        </section>
      )}

      {/* Particular: la persona ES el vendedor, con su Trust Score a la vista. */}
      {privateSeller && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-foreground-secondary">
            {COPY.detail.storeTitle}
          </h2>
          <BezelCard coreClassName="flex items-center gap-3 p-4">
            <Avatar src={privateSeller.avatarUrl} name={privateSeller.displayName} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-display text-base font-bold text-foreground">
                {privateSeller.displayName}
              </p>
              {/* `profileId` va suelto y no adentro de `privateSeller.trust`:
                  ese objeto está tipado como el `trust` de StoreCardModel y
                  sumarle un campo lo desalinearía de la tarjeta de tienda, que
                  no tiene una persona detrás. */}
              <PublisherTrust
                {...privateSeller.trust}
                size="inline"
                profileId={product.created_by}
              />
              <p className="mt-1 flex items-center gap-1.5 text-xs text-foreground-muted">
                <User size={13} aria-hidden="true" className="shrink-0" />
                {COPY.detail.privateSellerNote}
              </p>
            </div>
          </BezelCard>
        </section>
      )}

      {product.description && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-foreground-secondary">
            {COPY.detail.descriptionTitle}
          </h2>
          <p className="whitespace-pre-line text-base leading-relaxed text-foreground">
            {product.description}
          </p>
        </section>
      )}

      {/* Comentarios del aviso: se abren en la hoja del feed, sin navegar. */}
      <ListingCommentsRow listingId={product.id} commentCount={commentCount} className="mt-6" />

      {/* Contacto: el mensaje se escribe ACÁ (call cliente 2026-07-24). Por
          debajo sigue siendo request_contact — la conversación nace pendiente y
          quien vende decide si la acepta. Sin dueño con cuenta (producto de
          fuente externa) no hay a quién escribirle: se dice de frente. */}
      {product.created_by ? (
        !isOwner && (
          <section className="mt-6">
            <InlineMessageCta
              listingId={product.id}
              isLoggedIn={Boolean(user)}
              nextPath={`/marketplace/${product.id}`}
            />
          </section>
        )
      ) : (
        <section className="mt-6">
          <BezelCard coreClassName="p-4">
            <p className="text-sm font-semibold text-foreground">
              {COPY.detail.externalSellerTitle}
            </p>
            <p className="mt-1 text-sm text-foreground-secondary">
              {COPY.detail.externalSellerBody(
                product.publisher_name ?? COPY.detail.externalSellerFallback,
              )}
            </p>
          </BezelCard>
        </section>
      )}

      {/* Reportar + Reglas del Marketplace, al pie: quien duda de un aviso
          quiere las dos cosas —qué está prohibido y cómo avisar— juntas. No es
          otro sistema de reportes: es el <ReportSheet> de siempre con los
          motivos del Marketplace. Al dueño no se le ofrece reportar lo suyo. */}
      {!isOwner && (
        <ReportProductRow
          productId={product.id}
          productTitle={product.title}
          className="mt-8"
        />
      )}
    </div>
  );
}
