import Link from "next/link";
import { SignIn } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import { COPY } from "@/components/listings";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";
import { PublishForm } from "./publish-form";

export const metadata = { title: "Publicar" };

export default async function PublicarPage() {
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
          <Link
            href={`/entrar?redirect=${encodeURIComponent("/publicar")}`}
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
      <h1 className={cn("mb-6 font-display text-2xl font-bold tracking-tight text-foreground")}>
        {COPY.publish.title}
      </h1>
      <PublishForm tenantId={tenant.id} />
    </>
  );
}
