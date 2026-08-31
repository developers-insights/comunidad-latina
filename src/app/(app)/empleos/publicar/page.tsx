import Link from "next/link";
import { SealCheck, SignIn } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import { COPY } from "@/components/empleos/copy";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { requireIdentidadVerificada } from "@/lib/verificacion/gate";
import { JobPublishForm } from "./publish-form";

export const metadata = { title: "Publicar un empleo" };

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

  // Identidad verificada, ANTES de mostrar el formulario. Publicar un empleo
  // siempre la exige (`job` ∈ VERTICALES_QUE_EXIGEN_IDENTIDAD) y la policy
  // `listings_insert` (0126) la va a exigir igual, así que ofrecer los cuatro
  // pasos a quien no puede publicar es hacerle escribir el puesto, el sueldo y
  // las preguntas para rechazarlo al final. Es la misma función que usa la
  // action — una sola fuente para la regla, dos momentos para preguntarla.
  const identidad = await requireIdentidadVerificada(supabase, { kind: "job" });
  if (!identidad.permitido) {
    return (
      <EmptyState
        icon={<SealCheck />}
        title={C.needIdentityTitle}
        message={C.needIdentityBody}
        action={
          <Link
            href={`/perfil/verificar?next=${encodeURIComponent("/empleos/publicar")}`}
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {C.needIdentityCta}
          </Link>
        }
        className="py-20"
      />
    );
  }

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

  return (
    <>
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {C.title}
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">{C.subtitle}</p>
      </header>
      <JobPublishForm
        tenantId={tenant.id}
        currency={tenant.currency}
        businesses={businessRows ?? []}
      />
    </>
  );
}
