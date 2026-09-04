import Link from "next/link";
import { ArrowLeft, HandHeart, Plus, SignIn } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import { ComunidadHeading, MiPedidoCard } from "@/components/comunidad";
import { COMUNIDAD_COPY } from "@/lib/comunidad";
import { getAuthUserId } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { fetchMyHelpNotices } from "../../queries";

export const metadata = { title: "Mis pedidos" };

const C = COMUNIDAD_COPY.pedirAyuda.mios;

const RUTA = "/comunidad/pedir-ayuda/mios";

/**
 * =============================================================================
 * MIS PEDIDOS
 * =============================================================================
 *
 * Es la ÚNICA pantalla que muestra los pedidos ocultos por el equipo, los
 * legados sin publicar y los ya archivados: el tablón sólo lista lo aprobado.
 * Sin ella, que el equipo oculte un pedido sería una desaparición — la persona
 * escribió, se publicó, y un día no está más. El motivo de la moderación se
 * lee acá, en `<MiPedidoCard>`.
 *
 * El `eq("created_by")` de la consulta NO es la protección: la RLS ya limita
 * cada fila a su dueño (`created_by = auth.uid()` es una de las ramas de la
 * policy de SELECT de la 0120). Está para no traer de más.
 *
 * Sin paginado a propósito: son los pedidos de UNA persona y el cupo de la base
 * limita a cinco los que puede tener abiertos a la vez. Se traen hasta 60 —el
 * histórico con lo archivado— y se dibujan todos.
 */
export default async function MisPedidosPage() {
  const [tenant, viewerId] = await Promise.all([getTenant(), getAuthUserId()]);

  /**
   * Sin sesión no se pinta un error: mirar pedidos pide cuenta a propósito
   * (§5.4 — un listado abierto de nombre + barrio + "necesito esto" es un
   * padrón de gente vulnerable). Se dice por qué, con la puerta al lado.
   */
  if (!viewerId) {
    return (
      <EmptyState
        icon={<SignIn size={32} weight="light" aria-hidden="true" />}
        title={COMUNIDAD_COPY.escribirPedido.sinSesion.title}
        message={COMUNIDAD_COPY.escribirPedido.sinSesion.message}
        action={
          <Link
            href={`/entrar?next=${encodeURIComponent(RUTA)}`}
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {COMUNIDAD_COPY.escribirPedido.sinSesion.cta}
          </Link>
        }
        className="py-20"
      />
    );
  }

  const pedidos = await fetchMyHelpNotices({ tenantId: tenant.id, viewerId });

  return (
    <>
      <Link
        href="/comunidad/pedir-ayuda"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-foreground-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {COMUNIDAD_COPY.pedirAyuda.title}
      </Link>

      <ComunidadHeading
        className="mt-2"
        icon={<HandHeart size={30} weight="fill" aria-hidden="true" />}
        title={C.title}
        subtitle={C.subtitle}
      />

      {pedidos.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={<HandHeart size={32} weight="light" aria-hidden="true" />}
          title={C.vacioTitle}
          message={C.vacioMessage}
          action={
            <Link
              href="/comunidad/pedir-ayuda/publicar"
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              <Plus size={18} aria-hidden="true" />
              {COMUNIDAD_COPY.pedirAyuda.publicarCta}
            </Link>
          }
        />
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          {pedidos.map((pedido) => (
            <MiPedidoCard key={pedido.id} pedido={pedido} />
          ))}
        </div>
      )}
    </>
  );
}
