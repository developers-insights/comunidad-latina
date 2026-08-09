import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { availableOAuthProviders } from "../oauth-actions";
import { RegistroClient } from "./registro-client";

export const metadata = { title: "Sumate" };

export default async function RegistroPage() {
  // Ya logueado → no tiene sentido registrarse de nuevo.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/feed");

  // Sin credenciales el array viene vacío y el bloque de Google/Apple no se
  // dibuja: la pantalla queda igual a como estaba (§7).
  const oauthProviders = await availableOAuthProviders();

  return <RegistroClient oauthProviders={oauthProviders} />;
}
