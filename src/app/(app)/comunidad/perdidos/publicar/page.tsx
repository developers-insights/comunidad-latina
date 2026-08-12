import Link from "next/link";
import { ArrowLeft, SignIn } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import { COMUNIDAD_COPY } from "@/lib/comunidad";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { CasoPublishForm } from "./publish-form";

export const metadata = { title: "Publicar un caso" };

const C = COMUNIDAD_COPY.publicar;

const RUTA = "/comunidad/perdidos/publicar";

/**
 * Server Component: resuelve tenant + sesión y le pasa al wizard sólo el id del
 * tenant, que hace falta para el path de Storage.
 *
 * Sin sesión no se renderiza el formulario. Publicar exige cuenta y la RLS lo
 * rechazaría igual — es mejor decirlo antes de que alguien escriba todo, no
 * después.
 */
export default async function PublicarCasoPage() {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <EmptyState
        icon={<SignIn />}
        title={C.needLogin}
        message="Publicar un caso necesita tu cuenta: así quien lo encuentre te puede escribir sin que tengas que dejar tu teléfono a la vista."
        action={
          <Link
            href={`/entrar?next=${encodeURIComponent(RUTA)}`}
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {C.needLogin}
          </Link>
        }
        className="py-20"
      />
    );
  }

  return (
    <>
      <Link
        href="/comunidad/perdidos"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-foreground-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {COMUNIDAD_COPY.perdidos.title}
      </Link>

      <header className="mb-6 mt-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {C.title}
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">{C.subtitle}</p>
      </header>

      <CasoPublishForm tenantId={tenant.id} />
    </>
  );
}
