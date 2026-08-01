import "server-only";

import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import { isSentryConfigured } from "@/lib/config/services";

/**
 * Resolución de destinatarios: el email vive en auth.users, NO en profiles
 * (minimización de PII — la app nunca lo expone). Leerlo requiere el admin
 * client, y este helper es el ÚNICO camino sancionado para hacerlo en el
 * pipeline de emails (path privilegiado permitido por §6: despacho de
 * notificaciones del sistema).
 *
 * NUNCA lanza y NUNCA loguea el email — devuelve null si no se pudo resolver.
 * Un `null` acá deja al caller sin destinatario (el email nunca sale) — la
 * falla SÍ se reporta a Sentry (guardado por isSentryConfigured, sin PII: solo
 * el código de error) para que ese silencio no sea invisible también ahí.
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
        if (isSentryConfigured) {
          Sentry.captureException(
            new Error(`[email] getRecipientEmail: ${error.code ?? "error sin código"}`),
            { tags: { module: "email", reason: "recipient-lookup" } },
          );
        }
      }
      return null;
    }
    return data.user.email;
  } catch (error) {
    const message = error instanceof Error ? error.message : "error desconocido";
    console.warn("[email] fallo resolviendo destinatario", { message });
    if (isSentryConfigured) {
      Sentry.captureException(error instanceof Error ? error : new Error(message), {
        tags: { module: "email", reason: "recipient-lookup-exception" },
      });
    }
    return null;
  }
}
