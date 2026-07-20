import Link from "next/link";
import { SignIn } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import { COPY, GigPublishForm } from "@/components/creators";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";

export const metadata = { title: "Publicar un trabajo" };

export default async function PublicarGigPage() {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <EmptyState
        icon={<SignIn />}
        title={COPY.publish.needLoginTitle}
        message={COPY.publish.needLoginBody}
        action={
          <Link
            href={`/entrar?next=${encodeURIComponent("/creadores/publicar")}`}
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {COPY.publish.needLoginCta}
          </Link>
        }
        className="py-20"
      />
    );
  }

  return (
    <>
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {COPY.publish.title}
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">{COPY.publish.subtitle}</p>
      </header>
      <GigPublishForm tenantId={tenant.id} />
    </>
  );
}
