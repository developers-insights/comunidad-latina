import Link from "next/link";
import { ArrowLeft, HandHeart, Plus, SignIn } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import { ComunidadHeading, MiAvisoCard } from "@/components/comunidad";
import { COMUNIDAD_COPY } from "@/lib/comunidad";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { fetchMyHelpNotices } from "../../queries";

export const metadata = { title: "Mis avisos de ayuda" };

const C = COMUNIDAD_COPY.ayudaMutua.mios;

const RUTA = "/comunidad/ayuda-mutua/mios";

/**
 * =============================================================================
 * MIS AVISOS DE AYUDA
 * =============================================================================
 *
 * La contracara de "nada se publica solo": si una persona manda su aviso y
 * después no ve ni el aviso ni una explicación, lo que aprende es que la
 * sección no funciona. Esta pantalla es donde vive esa explicación —el estado
 * de cada uno y, cuando hubo rechazo, el motivo que escribió quien lo revisó—.
 *
 * Es la ÚNICA pantalla que muestra borradores y rechazos: el tablón sólo lista
 * lo aprobado. La RLS hace lo mismo desde la base (`created_by = auth.uid()`
 * es una de las tres ramas de su policy de SELECT), así que no hace falta
 * ningún filtro de seguridad acá — el `eq("created_by")` de la consulta está
 * para no traer de más, no para proteger.
 *
 * Sin paginado a propósito: son los avisos de UNA persona y el cupo de la base
 * limita a cinco los que puede tener abiertos. Se traen hasta 60 (el histórico
 * con lo archivado) y se dibujan todos.
 */
export default async function MisAvisosDeAyudaPage() {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <EmptyState
        icon={<SignIn />}
        title={COMUNIDAD_COPY.ofrecerse.needLogin}
        message={COMUNIDAD_COPY.ofrecerse.needLoginHint}
        action={
          <Link
            href={`/entrar?next=${encodeURIComponent(RUTA)}`}
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {COMUNIDAD_COPY.ofrecerse.needLogin}
          </Link>
        }
        className="py-20"
      />
    );
  }

  const avisos = await fetchMyHelpNotices({ tenantId: tenant.id, viewerId: user.id });

  return (
    <>
      <Link
        href="/comunidad/ayuda-mutua"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-foreground-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {COMUNIDAD_COPY.ayudaMutua.title}
      </Link>

      <ComunidadHeading
        className="mt-2"
        icon={<HandHeart size={30} weight="fill" aria-hidden="true" />}
        title={C.title}
        subtitle={C.subtitle}
      />

      {avisos.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={<HandHeart size={32} weight="light" aria-hidden="true" />}
          title={C.vacioTitle}
          message={C.vacioMessage}
          action={
            <Link
              href="/comunidad/ayuda-mutua/publicar"
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              <Plus size={18} aria-hidden="true" />
              {COMUNIDAD_COPY.ayudaMutua.publicarCta}
            </Link>
          }
        />
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          {avisos.map((aviso) => (
            <MiAvisoCard key={aviso.id} aviso={aviso} />
          ))}
        </div>
      )}
    </>
  );
}
