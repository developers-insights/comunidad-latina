"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isStripeConfigured } from "@/lib/config/services";
import { isCreatorOfTenant, onboardingLink } from "@/lib/creators/payout-onboarding";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTenantMatch } from "@/lib/tenant/guard";

export type PayoutLinkResult = { ok: true; url: string } | { ok: false; error: string; needsAuth?: boolean };

const COPY = {
  needLogin: "Para configurar tus cobros necesitás entrar a tu cuenta.",
  notCreator: "Los cobros se configuran desde un perfil de creador.",
  unavailable: "Los cobros todavía no están habilitados en esta comunidad.",
  tooFast: "Esperá un momento y probá de nuevo.",
  generic: "No pudimos abrir Stripe. Probá de nuevo en un ratito.",
  notReady: "Primero completá la configuración de tus cobros.",
} as const;

async function creatorGuard() {
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return guard.reason === "unauthenticated"
      ? ({ ok: false, error: COPY.needLogin, needsAuth: true } as const)
      : ({ ok: false, error: guard.message } as const);
  }
  if (!isStripeConfigured) return { ok: false, error: COPY.unavailable } as const;
  const admin = createAdminClient();
  if (!(await isCreatorOfTenant(admin, guard.user.id, guard.tenant.id))) {
    return { ok: false, error: COPY.notCreator } as const;
  }
  return { ok: true, guard, admin } as const;
}

export async function startPayoutOnboarding(): Promise<PayoutLinkResult> {
  try {
    const g = await creatorGuard();
    if (!g.ok) return g;
    if (!limit(`payout-onboarding:${g.guard.user.id}`, 10, HOUR_MS).ok) return { ok: false, error: COPY.tooFast };
    const url = await onboardingLink({
      admin: g.admin,
      stripe: getStripe(),
      tenantId: g.guard.tenant.id,
      profileId: g.guard.user.id,
      email: g.guard.user.email ?? null,
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
    });
    return { ok: true, url };
  } catch (error) {
    console.error("[creadores:cobros] no se pudo abrir el onboarding de Stripe", {
      message: error instanceof Error ? error.message : error,
    });
    return { ok: false, error: COPY.generic };
  }
}

export async function openPayoutDashboard(): Promise<PayoutLinkResult> {
  try {
    const g = await creatorGuard();
    if (!g.ok) return g;
    const { data, error } = await (g.admin as unknown as SupabaseClient)
      .from("connected_accounts")
      .select("stripe_account_id, details_submitted")
      .eq("owner_type", "creator")
      .eq("owner_ref", g.guard.user.id)
      .maybeSingle();
    if (error) throw new Error(`select connected_accounts: ${error.code}`);
    const account = data as { stripe_account_id: string | null; details_submitted: boolean } | null;
    if (!account?.stripe_account_id || !account.details_submitted) return { ok: false, error: COPY.notReady };
    const link = await getStripe().accounts.createLoginLink(account.stripe_account_id);
    return { ok: true, url: link.url };
  } catch (error) {
    console.error("[creadores:cobros] no se pudo abrir el panel de Stripe", {
      message: error instanceof Error ? error.message : error,
    });
    return { ok: false, error: COPY.generic };
  }
}
