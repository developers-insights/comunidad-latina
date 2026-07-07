import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RegistroClient } from "./registro-client";

export const metadata = { title: "Sumate" };

export default async function RegistroPage() {
  // Ya logueado → no tiene sentido registrarse de nuevo.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/feed");

  return <RegistroClient />;
}
