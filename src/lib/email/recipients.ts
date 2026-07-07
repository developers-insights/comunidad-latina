import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";

/**
 * Resolución de destinatarios: el email vive en auth.users, NO en profiles
 * (minimización de PII — la app nunca lo expone). Leerlo requiere el admin
 * client, y este helper es el ÚNICO camino sancionado para hacerlo en el
 * pipeline de emails (path privilegiado permitido por §6: despacho de
 * notificaciones del sistema).
 *
 * NUNCA lanza y NUNCA loguea el email — devuelve null si no se pudo resolver.
 */
export async function getRecipientEmail(
  admin: SupabaseClient<Database>,
  profileId: string,
): Promise<string | null> {
  try {
    const { data, error } = await admin.auth.admin.getUserById(profileId);
    if (error || !data?.user?.email) {
      if (error) {
        console.warn("[email] no se pudo resolver el destinatario", {
          code: error.code,
        });
      }
      return null;
    }
    return data.user.email;
  } catch (error) {
    console.warn("[email] fallo resolviendo destinatario", {
      message: error instanceof Error ? error.message : "error desconocido",
    });
    return null;
  }
}
