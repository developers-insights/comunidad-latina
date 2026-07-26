import Link from "next/link";
import { SignIn } from "@phosphor-icons/react/dist/ssr";
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

  // Negocios propios y publicados. SPLIT TIENDAS/PARTICULARES (call con el
  // cliente 2026-07-24): tener uno ya NO es requisito para publicar — la lista
  // vacía es un caso normal, no un muro. Con tiendas, el form deja elegir desde
  // cuál se vende (o como particular); sin tiendas, publica a nombre de la
  // persona y ofrece crear el negocio como algo opcional.
  const { data: stores } = await supabase
    .from("listings")
    .select("id, title")
    .eq("tenant_id", tenant.id)
    .eq("kind", "business")
    .eq("created_by", user.id)
    .eq("status", "published")
    .order("created_at", { ascending: false });

  return (
    <>
      <h1 className="mb-1 font-display text-2xl font-bold tracking-tight text-foreground">
        {COPY.publish.title}
      </h1>
      <p className="mb-6 text-sm text-foreground-secondary">{COPY.publish.subtitle}</p>
      <PublishForm
        tenantId={tenant.id}
        stores={(stores ?? []).map((store) => ({ id: store.id, title: store.title }))}
      />
    </>
  );
}
