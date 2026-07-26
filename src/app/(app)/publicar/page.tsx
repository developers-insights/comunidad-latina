import Link from "next/link";
import { SignIn } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import { COPY } from "@/components/listings";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";
import { PublishForm, type Kind } from "./publish-form";

export const metadata = { title: "Publicar" };

// Next 16: searchParams llega como Promise (mismo contrato que src/app/(app)/feed/page.tsx).
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Duplicado deliberado de publish-form.tsx (mismo patrón que ya usan
// src/app/(app)/publicar/actions.ts y src/app/admin/dominio/page.tsx): es un
// literal de 5 strings, no vale la pena cruzar el límite "use client" por él.
const VALID_KINDS = ["property", "business", "professional", "event", "job"] as const;

/** ?kind= del menú crear-post (feed) → Kind válido, o null si falta/no matchea. */
function parseInitialKind(raw: string | string[] | undefined): Kind | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && (VALID_KINDS as readonly string[]).includes(value) ? (value as Kind) : null;
}

export default async function PublicarPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [tenant, supabase, sp] = await Promise.all([getTenant(), createClient(), searchParams]);
  const initialKind = parseInitialKind(sp.kind);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Conserva el ?kind= a través del login (si no, el preselect se pierde
    // apenas el usuario anónimo tiene que entrar primero).
    const next = initialKind ? `/publicar?kind=${initialKind}` : "/publicar";
    return (
      <EmptyState
        icon={<SignIn />}
        title={COPY.publish.needLoginTitle}
        message={COPY.publish.needLoginMessage}
        action={
          <Link
            href={`/entrar?next=${encodeURIComponent(next)}`}
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
      <PublishForm tenantId={tenant.id} initialKind={initialKind} />
    </>
  );
}
