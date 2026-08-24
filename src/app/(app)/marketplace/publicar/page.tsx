import Link from "next/link";
import { ShieldCheck, SignIn } from "@phosphor-icons/react/dist/ssr";
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

  // Negocios propios y publicados + identidad verificada, en paralelo — dos
  // lecturas independientes, ninguna depende de la otra.
  //
  // SPLIT TIENDAS/PARTICULARES (call con el cliente 2026-07-24): tener un
  // negocio ya NO es requisito para publicar — la lista vacía es un caso
  // normal, no un muro. Con tiendas, el form deja elegir desde cuál se vende
  // (o como particular); sin tiendas, publica a nombre de la persona y ofrece
  // crear el negocio como algo opcional.
  const [{ data: stores }, { data: profile }] = await Promise.all([
    supabase
      .from("listings")
      .select("id, title")
      .eq("tenant_id", tenant.id)
      .eq("kind", "business")
      .eq("created_by", user.id)
      .eq("status", "published")
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("identity_verified").eq("id", user.id).maybeSingle(),
  ]);

  // GATE DE IDENTIDAD (spec cliente: "todos los vendedores deben completar la
  // verificación de identidad antes de publicar" — tienda o particular, sin
  // excepción). Se corta ACÁ, antes de ofrecer el formulario: la UI no puede
  // prometer un botón "Publicar" que el servidor va a rechazar (createProductDraft
  // repite este mismo chequeo del lado del server, ver ./actions.ts — la UI
  // sola no es una defensa). El gate REUSABLE de la base (RLS/policies) lo
  // escribe otro agente en paralelo (src/lib/verificacion/gate.ts); esto es
  // sólo la superficie: leer profiles.identity_verified y explicarlo con
  // claridad, con el camino ya armado (/perfil/verificar).
  if (!profile?.identity_verified) {
    return (
      <EmptyState
        icon={<ShieldCheck />}
        title={COPY.publish.needIdentityTitle}
        message={COPY.publish.needIdentityMessage}
        action={
          <Link
            href="/perfil/verificar"
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {COPY.publish.needIdentityCta}
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
        stores={(stores ?? []).map((store) => ({ id: store.id, title: store.title }))}
      />
    </>
  );
}
