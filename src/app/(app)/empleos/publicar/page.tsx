import Link from "next/link";
import { SignIn } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import { COPY } from "@/components/empleos/copy";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { JobPublishForm } from "./publish-form";

export const metadata = { title: "Publicar un empleo" };

const C = COPY.publish;

/**
 * /empleos/publicar — flujo dedicado para ofrecer un EMPLEO comunitario.
 *
 * Server Component: resuelve tenant + sesión y le pasa al wizard solo lo que
 * necesita (id del tenant para el path de Storage y la moneda para la vista
 * previa del salario). Sin sesión no se renderiza el form: publicar exige
 * cuenta y la RLS lo rechazaría igual — mejor decirlo antes de que escriba todo.
 */
export default async function PublicarEmpleoPage() {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <EmptyState
        icon={<SignIn />}
        title={C.needLoginTitle}
        message={C.needLoginBody}
        action={
          <Link
            href={`/entrar?next=${encodeURIComponent("/empleos/publicar")}`}
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {C.needLoginCta}
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
          {C.title}
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">{C.subtitle}</p>
      </header>
      <JobPublishForm tenantId={tenant.id} currency={tenant.currency} />
    </>
  );
}
