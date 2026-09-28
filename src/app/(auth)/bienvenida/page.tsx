import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export const metadata = { title: "Bienvenida" };

/**
 * Onboarding "Recién Llegado" (§3.1 / §4.a del design brief): 5 pasos, <60s,
 * cero campos de texto libre en los pasos 1-2, escape route siempre visible.
 * Si ya hay sesión, el paso 3 (registro) se saltea solo.
 *
 * Se exige sesión: el alta vive en /registro (que al confirmar el correo o al
 * volver de Google aterriza acá), así que el paso 3 del wizard nunca crea cuentas.
 */
export default async function BienvenidaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?next=/bienvenida");

  return <OnboardingWizard isLoggedIn />;
}
