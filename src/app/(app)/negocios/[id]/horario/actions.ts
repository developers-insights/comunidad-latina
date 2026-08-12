"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { HORARIO_COPY as C, validarHorario, type DiaSemana, type Tramo } from "@/lib/horarios";
import { supabaseSinTipar } from "@/lib/resenas";
import { isKnownTimeZone } from "@/lib/time/timezone";
import { requireTenantMatch } from "@/lib/tenant/guard";
import type { HorarioState } from "./estado";

/**
 * =============================================================================
 * GUARDAR EL HORARIO DE ATENCIÓN (migración 0093)
 * =============================================================================
 *
 * Toda la escritura pasa por la RPC `guardar_horario_de_aviso`, que reemplaza la
 * semana entera en UNA transacción y vuelve a verificar el permiso adentro. Esta
 * action no autoriza nada: valida la forma para que el error se lea en español
 * en vez de volver como un 23514 de Postgres, y nada más.
 *
 * La zona horaria se acota al catálogo de `lib/time/timezone` (el mismo que usa
 * el ajuste de zona del usuario) antes de mandarla. La base igual la valida
 * contra su propia tabla de zonas: son dos capas, no una repetida.
 */



const tramoSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  opensAt: z.string().regex(/^([01][0-9]|2[0-4]):[0-5][0-9]$/),
  closesAt: z.string().regex(/^([01][0-9]|2[0-4]):[0-5][0-9]$/),
});

const guardarSchema = z.object({
  listingId: z.uuid(),
  timeZone: z.string().refine(isKnownTimeZone),
  tramos: z
    .string()
    .max(4000)
    .transform((crudo, ctx) => {
      try {
        return JSON.parse(crudo) as unknown;
      } catch {
        // No es un `catch {}` mudo: el error viaja como issue de zod y termina
        // siendo el mensaje genérico del formulario.
        ctx.addIssue({ code: "custom", message: "json_invalido" });
        return z.NEVER;
      }
    })
    .pipe(z.array(tramoSchema).max(21)),
});

export async function guardarHorarioAction(
  _prevState: HorarioState,
  formData: FormData,
): Promise<HorarioState> {
  const parsed = guardarSchema.safeParse({
    listingId: formData.get("listingId"),
    timeZone: formData.get("timeZone"),
    tramos: formData.get("tramos"),
  });

  if (!parsed.success) {
    const campos = new Set(parsed.error.issues.map((issue) => String(issue.path[0])));
    if (campos.has("timeZone")) return { status: "invalid", message: C.errores.zona };
    if (campos.has("tramos")) return { status: "invalid", message: C.errores.tramoInvalido };
    return { status: "invalid", message: C.errores.generico };
  }

  const { listingId, timeZone } = parsed.data;
  const tramos: Tramo[] = parsed.data.tramos.map((tramo) => ({
    weekday: tramo.weekday as DiaSemana,
    opensAt: tramo.opensAt,
    closesAt: tramo.closesAt,
  }));

  // La misma vara que los CHECK de la base, adelantada para poder explicarla.
  const errores = validarHorario(tramos);
  if (errores.length > 0) {
    const codigos = new Set(errores.map((error) => error.codigo));
    if (codigos.has("solapado")) return { status: "invalid", message: C.errores.solapado };
    if (codigos.has("demasiados_tramos")) {
      return { status: "invalid", message: C.errores.demasiados };
    }
    return { status: "invalid", message: C.errores.tramoInvalido };
  }

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return {
      status: "error",
      message: guard.reason === "unauthenticated" ? C.errores.sinPermiso : guard.message,
    };
  }

  const { error } = await supabaseSinTipar(guard.supabase).rpc("guardar_horario_de_aviso", {
    p_listing: listingId,
    p_time_zone: timeZone,
    p_tramos: tramos,
  });

  if (error) {
    if (error.message.includes("SIN_PERMISO") || error.message.includes("AUTH_REQUIRED")) {
      return { status: "error", message: C.errores.sinPermiso };
    }
    if (error.message.includes("TARGET_NOT_FOUND")) {
      return { status: "error", message: C.errores.sinPermiso };
    }
    console.error("[horarios] no se pudo guardar la semana:", error.code, error.message);
    return { status: "error", message: C.errores.generico };
  }

  revalidatePath(`/negocios/${listingId}`);
  revalidatePath(`/profesionales/${listingId}`);
  revalidatePath(`/negocios/${listingId}/horario`);

  return { status: "success", message: C.guardado };
}
