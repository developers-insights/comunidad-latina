import { redirect } from "next/navigation";
import { getAuthUserId } from "@/lib/supabase/server";
import { safeInternalPath } from "@/lib/url/safe-href";
import { LoginForm } from "@/components/auth/login-form";

export const metadata = { title: "Entrar" };

export default async function EntrarPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next: rawNext, error } = await searchParams;

  // El `next` se sanea ACÁ, una sola vez, y lo que baja al formulario ya es una
  // ruta interna normalizada. Importa que sea acá: el destino post-login lo
  // navega el cliente, y `/<TAB>/evil.com` sobrevivía al filtro por string que
  // había antes (ver safe-href.ts) — o sea, alguien logueaba de verdad y
  // terminaba en un sitio ajeno con toda la pinta de ser el nuestro.
  const next = safeInternalPath(rawNext, "/feed");

  // Ya logueado → directo a la app (o al destino pedido). Gating de LECTURA:
  // user id verificado localmente (sin round-trip al Auth server).
  const userId = await getAuthUserId();
  if (userId) redirect(next);

  return <LoginForm next={next} urlError={error} />;
}
