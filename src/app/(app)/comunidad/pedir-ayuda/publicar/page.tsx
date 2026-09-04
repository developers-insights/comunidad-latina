import Link from "next/link";
import { ArrowLeft, HandHeart, SignIn } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import { ComunidadHeading } from "@/components/comunidad";
import { COMUNIDAD_COPY } from "@/lib/comunidad";
import { getAuthUserId } from "@/lib/supabase/server";
import { PublishForm } from "./publish-form";

export const metadata = { title: "Escribir un pedido" };

const C = COMUNIDAD_COPY.escribirPedido;

const RUTA = "/comunidad/pedir-ayuda/publicar";

/**
 * El alta de un pedido. El formulario es de cliente (validación mientras se
 * escribe, incluido el detector de datos de contacto); esta capa sólo resuelve
 * el marco y la sesión.
 *
 * La sesión se chequea ACÁ y no sólo en la action: `publicarPedido` igual la
 * exige —es donde vive la garantía—, pero si se dejara sólo ahí, quien entra
 * sin cuenta completaría los cuatro campos antes de que alguien le diga que
 * hace falta entrar. Este chequeo no protege nada, evita escribir al pedo.
 */
export default async function PublicarPedidoPage() {
  const viewerId = await getAuthUserId();

  if (!viewerId) {
    return (
      <EmptyState
        icon={<SignIn size={32} weight="light" aria-hidden="true" />}
        title={C.needLogin}
        message={C.needLoginHint}
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

      <PublishForm />
    </>
  );
}
