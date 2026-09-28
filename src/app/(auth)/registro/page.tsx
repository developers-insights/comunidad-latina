import { redirect } from "next/navigation";
import { getAuthUserId } from "@/lib/supabase/server";
import { AuthCard } from "@/components/auth/auth-card";
import { availableOAuthProviders } from "../oauth-actions";
import { RegistroClient } from "./registro-client";

export const metadata = { title: "Crear cuenta" };

export default async function RegistroPage() {
  const userId = await getAuthUserId();
  if (userId) redirect("/feed");

  // Resuelto en el SERVIDOR: el flag sale de env vars fuera del bundle. Sin
  // credenciales viene vacío y los botones no se dibujan.
  const providers = await availableOAuthProviders();

  return (
    <AuthCard>
      <RegistroClient oauthProviders={providers} />
    </AuthCard>
  );
}
