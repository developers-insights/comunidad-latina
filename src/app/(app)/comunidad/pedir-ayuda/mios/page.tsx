import Link from "next/link";
import { HandHeart, Plus, SignIn } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import { ComunidadHeading, MiPedidoCard } from "@/components/comunidad";
import { COMUNIDAD_COPY } from "@/lib/comunidad";
import { createClient } from "@/lib/supabase/server";
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
 * Dos cosas que no viven en ningún otro lado:
 *
 *  · MARCAR RESUELTO. Es la acción que mantiene sano al tablón: un pedido que
 *    ya se resolvió y sigue arriba hace que el siguiente que entre lea cosas
 *    que ya no hacen falta. Y libera cupo (5 abiertos por persona, 0130).
 *  · EL MOTIVO DE LA MODERACIÓN. Si el equipo oculta un pedido, acá está el
 *    porqué. Sin esto, ocultar sería una desaparición: la persona volvería a
 *    escribir lo mismo indefinidamente.
 *
 * Es la ÚNICA pantalla que muestra los pedidos ocultos y los resueltos: el
 * tablón sólo lista lo publicado. La RLS hace lo mismo desde la base
 * (`created_by = auth.uid()` es una de las tres ramas de su policy de SELECT),
 * así que el `eq("created_by")` de la consulta está para no traer de más, no
 * para proteger.
 *
 * Sin paginado a propósito: son los pedidos de UNA persona y el cupo de la base
 * limita a cinco los que puede tener abiertos. Se traen hasta 60 (el histórico
 * con lo resuelto) y se dibujan todos.
 */
export default async function MisPedidosPage() {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <EmptyState
        icon={<SignIn />}
        title={COMUNIDAD_COPY.escribirPedido.needLogin}
        message={COMUNIDAD_COPY.escribirPedido.needLoginHint}
        action={
          <Link
            href={`/entrar?next=${encodeURIComponent(RUTA)}`}
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {COMUNIDAD_COPY.escribirPedido.needLogin}
          </Link>
        }
        className="py-20"
      />
    );
  }

  const pedidos = await fetchMyHelpNotices({ tenantId: tenant.id, viewerId: user.id });

  return (
    <>
      <ComunidadHeading
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
