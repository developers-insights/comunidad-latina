import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isStripeConfigured } from "@/lib/config/services";
import { runEscrowSweep } from "@/lib/creators/escrow-sweep";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[creadores:cron] CRON_SECRET no está configurado: la liberación automática no corre.");
    return NextResponse.json({ error: "Cron no configurado" }, { status: 503 });
  }
  if (!authorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const result = await runEscrowSweep({
      admin: createAdminClient(),
      stripe: isStripeConfigured ? getStripe() : null,
      now: new Date(),
    });
    if (result.failed > 0) {
      console.error(`[creadores:cron] barrida con ${result.failed} contrato(s) que fallaron`, result);
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error(
      `[creadores:cron] la barrida se cortó: ${error instanceof Error ? error.message : "error desconocido"}`,
    );
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
