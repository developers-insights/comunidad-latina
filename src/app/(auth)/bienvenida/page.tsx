import { createClient } from "@/lib/supabase/server";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export const metadata = { title: "Bienvenida" };

/**
 * Onboarding "Recién Llegado" (§3.1 / §4.a del design brief): 5 pasos, <60s,
 * cero campos de texto libre en los pasos 1-2, escape route siempre visible.
 * Si ya hay sesión, el paso 3 (registro) se saltea solo.
 */
export default async function BienvenidaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <OnboardingWizard isLoggedIn={Boolean(user)} />;
}
