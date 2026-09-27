import { NextResponse } from "next/server";
import { isStripeConfigured } from "@/lib/config/services";
import { syncAfterReturn } from "@/lib/creators/payout-onboarding";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTenantMatch } from "@/lib/tenant/guard";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const destino = new URL("/creadores/cobros", request.url);
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return NextResponse.redirect(new URL(`/entrar?next=${encodeURIComponent("/creadores/cobros")}`, request.url));
    }
    return NextResponse.redirect(destino);
  }
  if (!isStripeConfigured) return NextResponse.redirect(destino);

  try {
    await syncAfterReturn({ admin: createAdminClient(), stripe: getStripe(), profileId: guard.user.id });
    destino.searchParams.set("estado", "vuelta");
  } catch (error) {
    console.error("[creadores:cobros] no se pudo leer la cuenta al volver de Stripe", {
      message: error instanceof Error ? error.message : error,
    });
    destino.searchParams.set("estado", "error");
  }
  return NextResponse.redirect(destino);
}
