"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Server action genérica del flujo "Reportar más simple" (2 taps): un solo
 * punto de entrada a la RPC report_scam para cualquier superficie —
 * perfil, aviso o mensaje — en vez de repetir la llamada en cada módulo.
 * Calcada de reportScamAction (src/app/(app)/mensajes/actions.ts): mismo
 * cliente server (anon + cookies, RLS es la frontera real) y mismos códigos
 * de error.
 */

export type ReportTargetResult =
  | { ok: true }
  | { ok: false; code: "unauthenticated" | "invalid" | "error" };

const reportTargetSchema = z.object({
  // Los kinds válidos del RPC report_scam (0014_rpcs.sql): listing | profile | message.
  targetKind: z.enum(["profile", "listing", "message"]),
  targetId: z.string().uuid(),
  reason: z.string().trim().min(1).max(80),
  details: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(1000))
    .optional(),
});

export type ReportTargetInput = z.infer<typeof reportTargetSchema>;

export async function reportTargetAction(
  input: ReportTargetInput,
): Promise<ReportTargetResult> {
  const parsed = reportTargetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "unauthenticated" };

  const { error } = await supabase.rpc("report_scam", {
    p_target_kind: parsed.data.targetKind,
    p_target_id: parsed.data.targetId,
    p_reason: parsed.data.reason,
    ...(parsed.data.details ? { p_details: parsed.data.details } : {}),
  });
  if (error) {
    console.error("[reportes] report_scam falló", { code: error.code });
    return { ok: false, code: "error" };
  }

  return { ok: true };
}
