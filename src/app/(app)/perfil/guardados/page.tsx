import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CloudSlash } from "@phosphor-icons/react/dist/ssr";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { Banner, buttonVariants } from "@/components/ui";
import { decodeCursor } from "@/components/listings";
import { fetchSavedItems } from "./saved-items";
import { SavedList } from "./saved-list";

export const metadata: Metadata = { title: "Guardados" };

const COPY = {
  title: "Guardados",
  hint: "Publicaciones y avisos que guardaste, para volver a verlos cuando quieras.",
  errorTitle: "No pudimos cargar tus guardados",
  errorBody: "Puede ser la conexión — no es nada que hayas hecho. Volvé a intentar.",
  retry: "Reintentar",
} as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * /perfil/guardados — lista privada de guardados del dueño de la sesión.
 *
 * Ruta dedicada (no tab dentro de /perfil): mismo patrón de navegación que
 * /perfil/bloqueados. Nunca recibe un id externo — todo lo que lee sale de
 * `auth.getUser()` de ESTA sesión, así que no existe un parámetro "de quién"
 * que desviar. No hay equivalente en /perfil/[id]: el perfil público de otra
 * persona jamás expone esta pantalla ni sus datos.
 */
export default async function GuardadosPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [tenant, supabase, sp] = await Promise.all([getTenant(), createClient(), searchParams]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?next=/perfil/guardados");

  const cursor = decodeCursor(firstValue(sp.cursor) || undefined);
  const result = await fetchSavedItems(supabase, {
    tenantId: tenant.id,
    viewerId: user.id,
    cursor,
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {COPY.title}
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">{COPY.hint}</p>
      </div>

      {result.ok ? (
        <SavedList
          items={result.page.items}
          nextHref={
            result.page.nextCursor ? `/perfil/guardados?cursor=${result.page.nextCursor}` : null
          }
        />
      ) : (
        // Distinto del vacío A PROPÓSITO: "no guardaste nada" y "no pudimos
        // cargar tus guardados" no pueden confundirse en una pantalla que es
        // el único lugar donde existe este contenido.
        <Banner
          variant="warning"
          icon={<CloudSlash size={20} aria-hidden="true" />}
          action={
            <Link
              href="/perfil/guardados"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {COPY.retry}
            </Link>
          }
        >
          <p className="font-semibold text-foreground">{COPY.errorTitle}</p>
          <p className="text-foreground-secondary">{COPY.errorBody}</p>
        </Banner>
      )}
    </div>
  );
}
