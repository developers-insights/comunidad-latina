import Link from "next/link";
import { SignIn, Storefront } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import { COPY } from "@/components/marketplace";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { PublishForm } from "./publish-form";

export const metadata = { title: "Publicar producto" };

export default async function MarketplacePublicarPage() {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <EmptyState
        icon={<SignIn />}
        title={COPY.publish.needLoginTitle}
        message={COPY.publish.needLoginMessage}
        action={
          // /entrar lee ?next= (ver src/app/(auth)/entrar/page.tsx) — NO ?redirect=.
          <Link
            href={`/entrar?next=${encodeURIComponent("/marketplace/publicar")}`}
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {COPY.publish.needLoginCta}
          </Link>
        }
        className="py-20"
      />
    );
  }

  // Negocios propios y publicados — sin uno de estos no hay "tienda" desde la
  // que publicar (attrs.store_listing_id necesita apuntar a un negocio real).
  const { data: stores } = await supabase
    .from("listings")
    .select("id, title")
    .eq("tenant_id", tenant.id)
    .eq("kind", "business")
    .eq("created_by", user.id)
    .eq("status", "published")
    .order("created_at", { ascending: false });

  if (!stores || stores.length === 0) {
    return (
      <EmptyState
        icon={<Storefront />}
        title={COPY.publish.needStoreTitle}
        message={COPY.publish.needStoreMessage}
        action={
          <Link href="/publicar" className={buttonVariants({ variant: "primary", size: "md" })}>
            {COPY.publish.needStoreCta}
          </Link>
        }
        className="py-20"
      />
    );
  }

  return (
    <>
      <h1 className="mb-1 font-display text-2xl font-bold tracking-tight text-foreground">
        {COPY.publish.title}
      </h1>
      <p className="mb-6 text-sm text-foreground-secondary">{COPY.publish.subtitle}</p>
      <PublishForm
        tenantId={tenant.id}
        stores={stores.map((store) => ({ id: store.id, title: store.title }))}
      />
    </>
  );
}
