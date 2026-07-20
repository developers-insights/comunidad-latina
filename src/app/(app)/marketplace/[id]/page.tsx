import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Package, RocketLaunch, Tag } from "@phosphor-icons/react/dist/ssr";
import { Banner, Chip, buttonVariants } from "@/components/ui";
import {
  ContactCta,
  DetailTopBar,
  buildTrustSignals,
  firstNameOf,
  firstPhotoUrl,
  listingPhotoUrl,
  toTrustLevel,
} from "@/components/listings";
import {
  COPY,
  ProductGallery,
  StoreCard,
  categoryLabel,
  conditionLabel,
  formatProductPrice,
  parseProductAttrs,
  type StoreCardModel,
} from "@/components/marketplace";
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
      "id, tenant_id, kind, title, description, price_amount, price_currency, attrs, area_label, photos, status, created_by, publisher_name, created_at",
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

  // ---------------------------------------------------------------------
  // Tienda dueña: nombre/zona/foto + seguidores + trust de quien la publica.
  // Todo en un solo Promise.all — independiente entre sí.
  // ---------------------------------------------------------------------
  let storeCardModel: StoreCardModel | null = null;
  if (attrs.storeListingId) {
    const storeId = attrs.storeListingId;
    const [{ data: store }, { count: followerCount }, { data: myFollow }] = await Promise.all([
      supabase
        .from("listings")
        .select("id, title, area_label, photos, created_by")
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
        followerCount: followerCount ?? 0,
        initialFollowing: Boolean(myFollow),
        trust,
      };
    }
  }

  return (
    // pb-40: mismo footprint que propiedades/[id] — el CTA "Contactar" de
    // ContactCta es `fixed` sobre el bottom-nav, este padding evita que tape
    // la card de la tienda ni la descripción.
    <div className="pb-40">
      <DetailTopBar title={product.title} listingId={product.id} />

      <ProductGallery photos={photos} title={product.title} />

      {product.status !== "published" && isOwner && (
        <Banner variant="info" className="mt-4 rounded-lg">
          {COPY.detail.pendingBanner}
        </Banner>
      )}

      <h1 className="mt-4 font-display text-xl font-bold leading-snug text-foreground">
        {product.title}
      </h1>

      {priceLabel && <p className="numeric mt-1 text-3xl font-bold text-brand">{priceLabel}</p>}

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

      {storeCardModel && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-foreground-secondary">
            {COPY.detail.storeTitle}
          </h2>
          <StoreCard store={storeCardModel} />
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

      {/* Flujo de contacto protegido existente (mismo componente que Propiedades
          — genérico por listingId, ver ContactCta + request_contact RPC). */}
      <ContactCta
        listingId={product.id}
        isLoggedIn={Boolean(user)}
        isExternal={!product.created_by}
        externalName={product.publisher_name}
      />
    </div>
  );
}
