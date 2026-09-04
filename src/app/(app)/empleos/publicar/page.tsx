import Link from "next/link";
import { SignIn } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import { COPY } from "@/components/empleos/copy";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { requireIdentidadVerificada } from "@/lib/verificacion/gate";
import { PublishRouter } from "./publish-router";
import { SectionTopBar } from "@/components/shell";

export const metadata = { title: "Publicar un empleo o un servicio" };

const C = COPY.publish;

/**
 * /empleos/publicar — flujo dedicado para ofrecer un EMPLEO comunitario.
 *
 * Server Component: resuelve tenant + sesión y le pasa al wizard solo lo que
 * necesita (id del tenant para el path de Storage, la moneda para la vista
 * previa del salario y las fichas de negocio propias para el vínculo). Sin
 * sesión no se renderiza el form: publicar exige cuenta y la RLS lo rechazaría
 * igual — mejor decirlo antes de que escriba todo.
 *
 * POR QUÉ LAS FICHAS DE NEGOCIO SE BUSCAN ACÁ Y NO EN EL CLIENTE: es la misma
 * consulta con la misma RLS, pero desde el servidor viaja RESUELTA en el HTML —
 * el desplegable ya está lleno cuando la persona llega al último paso, sin un
 * estado de carga en medio del wizard. Y si la consulta falla, el campo
 * simplemente no aparece: publicar a nombre personal sigue funcionando.
 */
export default async function PublicarEmpleoPage() {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <>
        {/* Sin sesión también hay que poder salir. La barra la monta acá esta
            rama y no un layout porque las OTRAS ramas la montan adentro del
            wizard, donde Volver retrocede un paso en vez de irse. */}
        <SectionTopBar fallbackHref="/empleos" />
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
      </>
    );
  }

  /**
   * Identidad verificada: se RESUELVE acá y se DECIDE abajo, en el router.
   *
   * Antes esta rama cortaba la pantalla entera, y con el selector de Empleo /
   * Servicio arriba eso pasó a ser incorrecto: un servicio NO está en
   * VERTICALES_QUE_EXIGEN_IDENTIDAD ni en la policy `listings_insert` (0126), así
   * que bloquear la página completa le cerraría la puerta a quien viene a
   * ofrecer un servicio por un requisito que su aviso no tiene. El bloqueo sigue
   * apareciendo ANTES del formulario del empleo — ver `publish-router.tsx`.
   *
   * Es la misma función que usa la server action: una sola fuente para la regla,
   * dos momentos para preguntarla.
   */
  const identidad = await requireIdentidadVerificada(supabase, { kind: "job" });

  // Fichas de negocio PROPIAS y PUBLICADAS. Las dos condiciones son las mismas
  // que exige app.check_business_listing_link() (0107): ofrecer en el
  // desplegable algo que el trigger va a rechazar sería armar una trampa.
  // Un borrador todavía no es una ficha que alguien pueda visitar.
  const { data: businessRows } = await supabase
    .from("listings")
    .select("id, title")
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    .eq("kind", "business")
    .eq("status", "published")
    .order("title")
    .limit(20);

  // El encabezado ya no vive acá: lo dibuja el router, porque el título cambia
  // según lo que se elija ("Publicar un empleo" / "Publicar un servicio") y
  // antes de elegir el que manda es el del selector.
  return (
    <PublishRouter
      tenantId={tenant.id}
      currency={tenant.currency}
      businesses={businessRows ?? []}
      identidadVerificada={identidad.permitido}
    />
  );
}
