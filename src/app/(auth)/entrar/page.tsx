import { redirect } from "next/navigation";
import { getAuthUserId } from "@/lib/supabase/server";
import { safeNextPath } from "@/components/auth/next-param";
import { LoginForm } from "@/components/auth/login-form";

export const metadata = { title: "Entrar" };

export default async function EntrarPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  // Ya logueado → directo a la app (o al destino pedido). Gating de LECTURA:
  // user id verificado localmente (sin round-trip al Auth server).
  const userId = await getAuthUserId();
  if (userId) redirect(safeNextPath(next));

  return <LoginForm next={next} urlError={error} />;
}
