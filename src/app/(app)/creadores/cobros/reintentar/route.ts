import { NextResponse } from "next/server";
import { isStripeConfigured } from "@/lib/config/services";
import { isCreatorOfTenant, onboardingLink } from "@/lib/creators/payout-onboarding";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTenantMatch } from "@/lib/tenant/guard";

export const runtime = "nodejs";

// Stripe manda acá cuando el link de onboarding venció o ya se usó: se genera
// uno nuevo y se reenvía, sin que la persona tenga que volver a tocar nada.
export async function GET(request: Request) {
  const fallback = new URL("/creadores/cobros", request.url);
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return NextResponse.redirect(new URL(`/entrar?next=${encodeURIComponent("/creadores/cobros")}`, request.url));
    }
    return NextResponse.redirect(fallback);
  }
  if (!isStripeConfigured) return NextResponse.redirect(fallback);

  try {
    const admin = createAdminClient();
    if (!(await isCreatorOfTenant(admin, guard.user.id, guard.tenant.id))) return NextResponse.redirect(fallback);
    const url = await onboardingLink({
      admin,
      stripe: getStripe(),
      tenantId: guard.tenant.id,
      profileId: guard.user.id,
      email: guard.user.email ?? null,
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin,
    });
    return NextResponse.redirect(url);
  } catch (error) {
    console.error("[creadores:cobros] no se pudo regenerar el link de onboarding", {
      message: error instanceof Error ? error.message : error,
    });
    fallback.searchParams.set("estado", "error");
    return NextResponse.redirect(fallback);
  }
}
