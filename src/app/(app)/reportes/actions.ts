"use server";

import { z } from "zod";
import { DAY_MS, limit } from "@/lib/rate-limit";
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
  | { ok: false; code: "unauthenticated" | "invalid" | "error" | "rate-limited" };

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

  // Mismo presupuesto y MISMA key que /escudo/reportar: 10 reportes por día y
  // por persona, compartidos entre TODAS las superficies. Que el namespace sea
  // el mismo es lo importante — un tope por pantalla sería un tope por cuatro,
  // y quien quiere brigadear a alguien no elige el botón, elige la víctima.
  // El peso real de cada reporte lo sigue decidiendo el Trust Score en la DB.
  if (!limit(`reporte:${user.id}`, 10, DAY_MS).ok) {
    return { ok: false, code: "rate-limited" };
  }

  const { error } = await supabase.rpc("report_scam", {
    p_target_kind: parsed.data.targetKind,
    p_target_id: parsed.data.targetId,
    p_reason: parsed.data.reason,
    ...(parsed.data.details ? { p_details: parsed.data.details } : {}),
  });
  if (error) {
    // Tope diario del lado de la base (0118): mismo código que el limitador
    // in-memory de arriba — la UI ya sabe mostrarlo. El de la base es el que
    // vale con varias instancias; el de acá solo ahorra el viaje.
    if (error.message.includes("RATE_LIMITED")) {
      return { ok: false, code: "rate-limited" };
    }
    console.error("[reportes] report_scam falló", { code: error.code });
    return { ok: false, code: "error" };
  }

  return { ok: true };
}
