"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantMatch } from "@/lib/tenant/guard";

/**
 * "Sigo acá" — marca a quien mira como activo (RPC `tocar_presencia`, 0145).
 *
 * SIN `revalidatePath` A PROPÓSITO. Es un latido que corre una vez por minuto
 * mientras la app está abierta: revalidar acá volvería a renderizar la pantalla
 * entera cada sesenta segundos para mover un timestamp que ni siquiera es el
 * que se está mirando. Las pantallas ya se refrescan solas (`ThreadRefresh`) y
 * es ahí donde la presencia ajena se reconcilia.
 *
 * Nunca lanza y nunca informa el motivo: quien la llama no puede hacer nada con
 * el error, y un toast de "no pudimos marcar tu presencia" sería ruido por algo
 * que a nadie le importa que falle.
 */
export async function tocarPresenciaAction(): Promise<void> {
  const guard = await requireTenantMatch();
  if (!guard.ok) return;

  const { error } = await (guard.supabase as SupabaseClient).rpc("tocar_presencia");

  if (error) {
    // 42883 = la 0145 todavía no corrió en este entorno.
    console.warn("[mensajes] no se pudo tocar la presencia", { code: error.code });
  }
}
