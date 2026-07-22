import Link from "next/link";
import { LinkBreak } from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/supabase/server";
import { EmptyState, buttonVariants } from "@/components/ui";
import { ActualizarClient } from "./actualizar-client";

export const metadata = { title: "Nueva contraseña" };

/**
 * Segundo paso de la recuperación. Al llegar acá desde el correo, el /callback
 * ya canjeó el enlace por una sesión de recuperación → getUser() devuelve el
 * usuario. Sin esa sesión (entró de más, el enlace venció o ya se usó) mostramos
 * un estado vacío que invita a pedir uno nuevo, en vez de un form que no anda.
 */
export default async function ActualizarPage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <EmptyState
        icon={<LinkBreak weight="regular" />}
        title="Ese enlace ya no sirve"
        message="El enlace para restablecer tu contraseña venció o ya se usó. Pedí uno nuevo y te lo mandamos de nuevo."
        action={
          <Link href="/recuperar" className={buttonVariants({ size: "lg" })}>
            Pedir un enlace nuevo
          </Link>
        }
      />
    );
  }

  return <ActualizarClient />;
}
