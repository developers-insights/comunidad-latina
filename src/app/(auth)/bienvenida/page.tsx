import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export const metadata = { title: "Bienvenida" };

/**
 * Onboarding "Recién Llegado" (§3.1 / §4.a del design brief): 5 pasos, <60s,
 * cero campos de texto libre en los pasos 1-2, escape route siempre visible.
 * Si ya hay sesión, el paso 3 (registro) se saltea solo.
 *
 * Sin sesión el paso 3 ES el alta de cuenta — y el alta está en pausa. Por eso
 * acá SÍ se exige sesión (a diferencia de /propiedades o /guias): sin ella no
 * hay ningún paso 3 honesto al que llegar, así que se manda a /entrar antes de
 * dibujar el paso 1.
 */
export default async function BienvenidaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?next=/bienvenida");

  return <OnboardingWizard isLoggedIn />;
}
